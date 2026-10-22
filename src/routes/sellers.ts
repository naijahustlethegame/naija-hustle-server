import { Router } from "express";
import { z } from "zod";
import { MAX_AWAY_MIN, SELLERS } from "../game/data.js";
import { rpc } from "../lib/supabase.js";

export const sellers = Router();

sellers.post("/hire", async (req, res) => {
  const { id } = z.object({ id: z.string().refine((k) => k in SELLERS) }).parse(req.body);
  const p = await rpc("hire_seller", { p_id: req.uid, p_seller: id, p_price: SELLERS[id]!.price });
  res.status(201).json({ money: p.money });
});

/** Earnings are computed in SQL from the server clock and the server rate table. */
sellers.post("/collect", async (req, res) => {
  const rates = Object.fromEntries(Object.entries(SELLERS).map(([k, v]) => [k, v.perMin]));
  const rows = await rpc<{ collected: number; money: number }[]>("collect_earnings", { p_id: req.uid, p_rates: rates, p_max_min: MAX_AWAY_MIN });
  res.json(rows[0] ?? { collected: 0, money: 0 });
});
