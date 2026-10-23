import { Router } from "express";
import { z } from "zod";
import { ITEM_PACKS, JUNCTIONS, JUNCTION_UNLOCKS, type JunctionId } from "../game/data.js";
import { ApiError, db, rpc } from "../lib/supabase.js";

export const unlocks = Router();

async function owned(uid: string) {
  const { data } = await db.from("players").select("money,unlocked_junctions,unlocked_items").eq("id", uid).single();
  if (!data) throw new ApiError(404, "No player");
  return data as { money: number | string; unlocked_junctions: string[]; unlocked_items: string[] };
}

/** Buy a better junction. The price and the order (Obalende before Lekki) are decided here, never by the client. */
unlocks.post("/junction", async (req, res) => {
  const { id } = z.object({ id: z.enum(JUNCTIONS) }).parse(req.body);
  const def = JUNCTION_UNLOCKS[id as JunctionId];
  if (!def) throw new ApiError(400, "Not for sale");
  const pl = await owned(req.uid);
  if (pl.unlocked_junctions.includes(id)) throw new ApiError(409, "Already unlocked");
  if (def.requires && !pl.unlocked_junctions.includes(def.requires)) throw new ApiError(409, "Unlock the earlier junction first");
  if (Number(pl.money) < def.price) throw new ApiError(402, "Not enough money");
  const p = await rpc("unlock_junction", { p_id: req.uid, p_junction: id, p_price: def.price });
  res.status(201).json({ money: p.money, junctions: p.unlocked_junctions });
});

/** Buy a pack of dearer stock (chargers and gadgets, or sunglasses and perfume). */
unlocks.post("/pack", async (req, res) => {
  const { id } = z.object({ id: z.string().refine((k) => k in ITEM_PACKS) }).parse(req.body);
  const def = ITEM_PACKS[id]!;
  const pl = await owned(req.uid);
  if (def.items.every((i) => pl.unlocked_items.includes(i))) throw new ApiError(409, "Already unlocked");
  if (def.requiresJunction && !pl.unlocked_junctions.includes(def.requiresJunction)) throw new ApiError(409, "Unlock the junction first");
  if (Number(pl.money) < def.price) throw new ApiError(402, "Not enough money");
  const p = await rpc("unlock_items", { p_id: req.uid, p_items: def.items, p_price: def.price });
  res.status(201).json({ money: p.money, items: p.unlocked_items });
});
