import { Router } from "express";
import { z } from "zod";
import { ITEM_IDS, MAX_LEVEL, PICKUPS_PER_SEC, STORAGE_CAP, TIER, fineFor, marketById, rollMarket, type ItemId } from "../game/data.js";
import { ApiError, db, rpc } from "../lib/supabase.js";
import { logRun } from "../lib/runLog.js";

export const runs = Router();
const MIN_RUN_SECS = 25;     // fastest a real run can finish (about 46 seconds normally, a bit under 35 at the highest risk level)
// generous upper bound on pickups per second: see PICKUPS_PER_SEC in game/data.ts (faster roads allow a few more)

/** Pay the entry fee and get a market. The server chooses it. */
runs.post("/start", async (req, res) => {
  const { data: pl } = await db.from("players").select("junction,money,unlocked_junctions").eq("id", req.uid).single();
  if (!pl) throw new ApiError(404, "No player");
  if (!pl.unlocked_junctions?.includes(pl.junction)) throw new ApiError(409, "Junction not unlocked");
  const m = rollMarket(pl.junction);
  if (pl.money < m.fee) throw new ApiError(402, "Not enough money");
  const p = await rpc("start_run", { p_id: req.uid, p_market: m.id, p_fee: m.fee }); // creates the pot: running, started now
  logRun(req.uid, m.id, 1, "started");
  res.json({ market: m.id, fee: m.fee, money: p.money, room: Math.max(0, STORAGE_CAP - Object.values<number>(p.storage).reduce((a, b) => a + b, 0)) });
});

/** Run the same market again at the next level. */
runs.post("/push", async (req, res) => {
  const pot = await rpc("push_on", { p_id: req.uid });
  if (!pot?.player_id) throw new ApiError(409, "Nothing to push");
  logRun(req.uid, pot.market, pot.level + 1, "started");
  res.json({ level: pot.level + 1 });
});

const result = z.object({
  items: z.record(z.enum(ITEM_IDS as [string, ...string[]]), z.number().int().min(0).max(1000)),
  cash: z.number().int().min(0).max(200000),
});

/** Record a finished run, clamped to what this market and run time can possibly give. */
runs.post("/finish", async (req, res) => {
  const { items, cash } = result.parse(req.body);
  const { data: pot } = await db.from("pots").select("*").eq("player_id", req.uid).eq("running", true).maybeSingle();
  if (!pot) throw new ApiError(409, "No run in progress");
  const m = marketById(pot.market)!;
  const { data: pl } = await db.from("players").select("unlocked_items").eq("id", req.uid).single();
  const mine: string[] = pl?.unlocked_items ?? [];
  const level = Math.min(MAX_LEVEL, Math.max(1, pot.level + 1));
  const secs = (Date.now() - new Date(pot.started_at).getTime()) / 1000;
  if (secs < MIN_RUN_SECS) throw new ApiError(400, "Run too short");

  const maxPickups = Math.ceil(secs * PICKUPS_PER_SEC[TIER[m.junction]]) + 3;
  let units = 0;
  for (const [k, n] of Object.entries(items)) {
    if (n > 0 && (!m.items.includes(k as ItemId) || !mine.includes(k))) throw new ApiError(400, "Invalid item");
    units += n;
  }
  if (units > maxPickups * level || cash > maxPickups * m.maxCash * level) throw new ApiError(400, "Invalid result");

  const p = await rpc("finish_run", { p_id: req.uid, p_items: items, p_cash: cash, p_level: level });
  if (!p?.player_id) throw new ApiError(409, "No run in progress");
  logRun(req.uid, m.id, level, "completed", cash);
  res.json({ pot: p });
});

/** Caught, or the page closed mid-run: pot is lost and the fine is fixed by the market. */
runs.post("/fail", async (req, res) => {
  const { data: pot } = await db.from("pots").select("market,level,running").eq("player_id", req.uid).maybeSingle();
  if (!pot) throw new ApiError(409, "No run");
  const p = await rpc("fail_run", { p_id: req.uid, p_fine: fineFor(marketById(pot.market)!) });
  // caught or abandoned mid-run, or a finished pot thrown away
  logRun(req.uid, pot.market, pot.running ? pot.level + 1 : pot.level, pot.running ? "failed" : "forfeited");
  res.json({ money: p.money });
});

runs.post("/bank", async (req, res) => {
  const { data: pot } = await db.from("pots").select("market,level,cash").eq("player_id", req.uid).maybeSingle(); // read first: banking deletes it
  const p = await rpc("bank_pot", { p_id: req.uid });
  if (pot) logRun(req.uid, pot.market, pot.level, "banked", Number(pot.cash));
  res.json({ money: p.money, storage: p.storage });
});
