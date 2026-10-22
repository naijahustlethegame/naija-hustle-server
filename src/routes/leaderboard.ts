import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, rpc } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const leaderboard = Router();
const MAX_SCORE = 5000; // plausible cap for a 90s round; tune as balance changes

let cache: { at: number; top: unknown[] } | null = null;
async function top() {
  if (cache && Date.now() - cache.at < 10_000) return cache.top;
  const { data } = await db.from("scores").select("name,score").order("score", { ascending: false }).order("updated_at").limit(20);
  cache = { at: Date.now(), top: data ?? [] };
  return cache.top;
}

leaderboard.get("/", async (_req, res) => res.json({ top: await top() }));

leaderboard.post("/", requireAuth, rateLimit({ windowMs: 20_000, limit: 1, keyGenerator: (r) => r.uid, validate: false }), async (req, res) => {
  const b = z.object({ name: z.string(), score: z.number().min(0).max(MAX_SCORE) }).parse(req.body);
  const name = b.name.replace(/[^\w .-]/g, "").trim().slice(0, 16);
  if (!name) return res.status(400).json({ error: "Invalid" });
  await rpc("submit_score", { p_id: req.uid, p_name: name, p_score: Math.floor(b.score) });
  cache = null;
  res.status(201).json({ top: await top() });
});
