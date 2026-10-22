import { Router } from "express";
import { z } from "zod";
import { ITEM_IDS, JUNCTIONS, MAX_PRICE_MULT, ITEM_PRICE, STORAGE_CAP, TRAY_CAP } from "../game/data.js";
import { ApiError, db, rpc } from "../lib/supabase.js";

export const player = Router();
const itemId = z.enum(ITEM_IDS as [string, ...string[]]);
const counts = z.record(itemId, z.number().int().min(0).max(1000));

async function snapshot(uid: string) {
  const [p, s, pot] = await Promise.all([
    db.from("players").select("id,name,avatar,money,junction,stock,storage").eq("id", uid).single(),
    db.from("player_sellers").select("seller_id,since").eq("player_id", uid),
    db.from("pots").select("*").eq("player_id", uid).maybeSingle(),
  ]);
  if (p.error) throw new ApiError(404, "No player");
  return { ...p.data, sellers: s.data ?? [], pot: pot.data ?? null };
}

/** Create the player on first visit (idempotent) and return the full state. */
player.post("/init", async (req, res) => {
  const b = z.object({ name: z.string().max(40).optional(), avatar: z.record(z.string(), z.any()).optional() }).parse(req.body ?? {});
  await rpc("ensure_player", { p_id: req.uid, p_name: b.name ?? "", p_avatar: b.avatar ?? {} });
  res.json(await snapshot(req.uid));
});

player.get("/", async (req, res) => res.json(await snapshot(req.uid)));

player.post("/junction", async (req, res) => {
  const { junction } = z.object({ junction: z.enum(JUNCTIONS) }).parse(req.body);
  await rpc("set_junction", { p_id: req.uid, p_junction: junction });
  res.json({ junction });
});

/** Move stock between home storage and the tray. Total is conserved, so nothing can be created. */
player.post("/tray", async (req, res) => {
  const { toTray } = z.object({ toTray: z.record(itemId, z.number().int().min(-TRAY_CAP).max(TRAY_CAP)) }).parse(req.body);
  const neg = Object.fromEntries(Object.entries(toTray).map(([k, v]) => [k, -v]));
  const p = await rpc("apply_delta", { p_id: req.uid, p_stock: toTray, p_storage: neg });
  res.json({ stock: p.stock, storage: p.storage });
});

// Sales: the server bounds price per item and how fast sales can happen. Stock and money are enforced by DB constraints.
const lastSale = new Map<string, { t: number; budget: number }>();
const SALE_EVERY_MS = 1500, BURST = 8;

player.post("/sales", async (req, res) => {
  const { sales } = z.object({
    sales: z.array(z.object({ item: itemId, price: z.number().int().min(10).max(5000) })).min(1).max(25),
  }).parse(req.body);

  const now = Date.now(), st = lastSale.get(req.uid) ?? { t: now, budget: BURST };
  st.budget = Math.min(BURST, st.budget + (now - st.t) / SALE_EVERY_MS); st.t = now;
  if (sales.length > st.budget + 1) throw new ApiError(429, "Too many sales");
  st.budget -= sales.length; lastSale.set(req.uid, st);

  let money = 0; const stock: Record<string, number> = {};
  for (const s of sales) {
    if (s.price > ITEM_PRICE[s.item as keyof typeof ITEM_PRICE] * MAX_PRICE_MULT) throw new ApiError(400, "Invalid price");
    money += s.price; stock[s.item] = (stock[s.item] ?? 0) - 1;
  }
  const p = await rpc("apply_delta", { p_id: req.uid, p_money: money, p_stock: stock });
  res.json({ money: p.money, stock: p.stock });
});

/** Officer hits and items lost on the junction: the fine is fixed on the server. */
player.post("/hit", async (req, res) => {
  const b = z.object({ hits: z.number().int().min(0).max(5).default(0), items: z.record(itemId, z.number().int().min(0).max(5)).default({}) }).parse(req.body);
  if (Object.values(b.items).reduce((a, n) => a + n, 0) > 10) throw new ApiError(400, "Invalid");
  const { data } = await db.from("players").select("money").eq("id", req.uid).single();
  const loss = Math.min(data?.money ?? 0, 50 * b.hits);
  const stock = Object.fromEntries(Object.entries(b.items).map(([k, n]) => [k, -n]));
  const p = await rpc("apply_delta", { p_id: req.uid, p_money: -loss, p_stock: stock });
  res.json({ money: p.money, stock: p.stock });
});

export { STORAGE_CAP };
