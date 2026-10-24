import { Router } from "express";
import { env } from "../config/env.js";
import { ApiError } from "../lib/supabase.js";

/**
 * Nigerian radio stations for the cars at the lights.
 *
 * The Naija Radio API key lives only here, on the server. The browser asks this route for the list and then plays the
 * broadcaster's stream directly, so no audio ever goes through this server. The list is cached in memory, so a crowd of
 * players costs one upstream request every few minutes instead of one each, and it never touches the upstream rate limit.
 */
export const radio = Router();

export type Station = { id: string; name: string; streamUrl: string };

const TTL_MS = 15 * 60_000;       // how long a list stays fresh
const RETRY_MS = 60_000;          // after a failed refresh, wait this long before asking upstream again
let cache: { at: number; stations: Station[] } | null = null;
let blockedUntil = 0;
let inflight: Promise<Station[]> | null = null;

/** Keep only the three fields the game needs, and drop anything without a usable stream address. */
function clean(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  const out: Station[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, name, streamUrl } = r as Record<string, unknown>;
    if (typeof name !== "string" || typeof streamUrl !== "string" || id == null) continue;
    try {
      const u = new URL(streamUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    } catch { continue; }
    out.push({ id: String(id), name: name.trim().slice(0, 60), streamUrl });
  }
  return out;
}

async function fetchStations(): Promise<Station[]> {
  const key = env.NAIJA_RADIO_API_KEY, base = env.NAIJA_RADIO_API_BASE_URL;
  if (!key || !base) throw new ApiError(503, "Radio is not configured");
  const r = await fetch(`${base.replace(/\/$/, "")}/stations?countryCode=NG&limit=100`, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new ApiError(503, "Radio is unavailable");
  const body = (await r.json()) as { data?: unknown };
  const stations = clean(body.data);
  if (!stations.length) throw new ApiError(503, "Radio is unavailable");
  return stations;
}

async function stations(): Promise<Station[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.stations;
  // Upstream is struggling: serve the old list if there is one, rather than hammering it.
  if (now < blockedUntil) { if (cache) return cache.stations; throw new ApiError(503, "Radio is unavailable"); }
  try {
    const list = await (inflight ??= fetchStations().finally(() => { inflight = null; }));
    cache = { at: Date.now(), stations: list };
    return list;
  } catch (e) {
    blockedUntil = Date.now() + RETRY_MS;
    if (cache) return cache.stations;
    throw e instanceof ApiError ? e : new ApiError(503, "Radio is unavailable");
  }
}

/** Public, like the leaderboard: the homepage demo has no signed-in player. The app-wide rate limit still applies. */
radio.get("/stations", async (_req, res) => {
  const list = await stations();
  res.set("Cache-Control", "public, max-age=600");
  res.json({ data: list });
});
