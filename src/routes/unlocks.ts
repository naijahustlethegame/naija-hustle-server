import { Router } from "express";
import { z } from "zod";
import { JUNCTIONS, JUNCTION_ITEMS, JUNCTION_UNLOCKS, type JunctionId } from "../game/data.js";
import { ApiError, db, rpc } from "../lib/supabase.js";

export const unlocks = Router();

async function owned(uid: string) {
  const { data } = await db.from("players").select("money,unlocked_junctions,unlocked_items").eq("id", uid).single();
  if (!data) throw new ApiError(404, "No player");
  return data as { money: number | string; unlocked_junctions: string[]; unlocked_items: string[] };
}

/**
 * Buy a better junction. The price and the order (Obalende before Lekki) are decided here, never by the client.
 * The junction's items come with it: the database grants them in the same transaction as the payment.
 */
unlocks.post("/junction", async (req, res) => {
  const { id } = z.object({ id: z.enum(JUNCTIONS) }).parse(req.body);
  const def = JUNCTION_UNLOCKS[id as JunctionId];
  if (!def) throw new ApiError(400, "Not for sale");
  const pl = await owned(req.uid);
  if (pl.unlocked_junctions.includes(id)) throw new ApiError(409, "Already unlocked");
  if (def.requires && !pl.unlocked_junctions.includes(def.requires)) throw new ApiError(409, "Unlock the earlier junction first");
  if (Number(pl.money) < def.price) throw new ApiError(402, "Not enough money");
  const p = await rpc("unlock_junction", { p_id: req.uid, p_junction: id, p_price: def.price, p_items: JUNCTION_ITEMS[id as JunctionId] });
  res.status(201).json({ money: p.money, junctions: p.unlocked_junctions, items: p.unlocked_items });
});
