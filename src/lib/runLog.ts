import { db } from "./supabase.js";

export type RunOutcome = "started" | "completed" | "failed" | "banked" | "forfeited";

/**
 * Record what happened to a market run, for the admin stats. Fire and forget: a logging problem must never
 * slow down or break the game, so errors are printed and swallowed.
 */
export function logRun(playerId: string, market: string, level: number, outcome: RunOutcome, cash = 0) {
  void db.from("run_events")
    .insert({ player_id: playerId, market, level: Math.max(1, Math.min(4, level)), outcome, cash: Math.max(0, Math.floor(cash)) })
    .then(({ error }) => { if (error) console.error("run_events:", error.message); });
}
