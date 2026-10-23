import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ApiError, db } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Ranked by money in hand (players.money). Stock, unbanked pots and sellers' pending earnings do not count,
 * so the board moves when you bank, sell, pay a fine or buy something. Every player gets a generated name like
 * "Player0417" when they first join, and can change it on the leaderboard page.
 */
export const leaderboard = Router();
const TOP_N = 50;

type Row = { name: string; money: number };

/** "Player" plus four digits taken from the player's id, so the same player always gets the same name. Not unique. */
export function defaultName(uid: string) {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) { h ^= uid.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `Player${String((h >>> 0) % 10000).padStart(4, "0")}`;
}

/** Give a player the generated name if they have none yet. Never throws: a missing name must not break signing in. */
export async function ensureDefaultName(uid: string): Promise<string> {
  try {
    const { data } = await db.from("players").select("name").eq("id", uid).maybeSingle();
    if (!data) return "";
    if (data.name) return data.name;
    const name = defaultName(uid);
    await db.from("players").update({ name }).eq("id", uid);
    cache = null;
    return name;
  } catch { return ""; }
}
let cache: { at: number; top: Row[] } | null = null;

async function top(): Promise<Row[]> {
  if (cache && Date.now() - cache.at < 10_000) return cache.top;
  const { data, error } = await db.from("players").select("name,money").neq("name", "")
    .order("money", { ascending: false }).order("id").limit(TOP_N);
  if (error) throw new ApiError(500, "Server error");
  cache = { at: Date.now(), top: (data ?? []).map((r) => ({ name: r.name, money: Number(r.money) })) };
  return cache.top;
}

/** The public top list. */
leaderboard.get("/", async (_req, res) => res.json({ top: await top() }));

/** Your own name, money and position (ties share a place). `rank` is null until you have picked a name. */
leaderboard.get("/me", requireAuth, async (req, res) => {
  const { data: me, error } = await db.from("players").select("name,money").eq("id", req.uid).maybeSingle();
  if (error) throw new ApiError(500, "Server error");
  if (!me) throw new ApiError(404, "No player");
  const money = Number(me.money), name: string = me.name || (await ensureDefaultName(req.uid)); // players from before names existed get one here
  let rank: number | null = null;
  if (name) {
    const { count, error: e2 } = await db.from("players").select("id", { count: "exact", head: true }).neq("name", "").gt("money", money);
    if (e2) throw new ApiError(500, "Server error");
    rank = (count ?? 0) + 1;
  }
  res.json({ name, money, rank });
});

/** Pick or change the name shown on the board. */
leaderboard.post("/name", requireAuth, rateLimit({ windowMs: 60_000, limit: 6, keyGenerator: (r) => r.uid, validate: false }), async (req, res) => {
  const b = z.object({ name: z.string().max(40) }).parse(req.body);
  const name = b.name.replace(/[^\w .-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (name.length < 2) throw new ApiError(400, "Pick a name with at least 2 letters or numbers");
  const { data, error } = await db.from("players").update({ name }).eq("id", req.uid).select("id");
  if (error) throw new ApiError(500, "Server error");
  if (!data?.length) throw new ApiError(404, "No player");
  cache = null;
  res.json({ name });
});
