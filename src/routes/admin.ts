import { Router } from "express";
import { JUNCTION_UNLOCKS, SELLERS } from "../game/data.js";
import { rpc } from "../lib/supabase.js";
import { onlineCount } from "../presence.js";
import { liveStats } from "../rooms.js";

/** Admin only (see middleware/admin.ts). One document with everything the /stats page shows. */
export const admin = Router();

type Counted<K extends string> = Record<K, string> & { n: number };
const TTL_MS = 10_000; // the page polls; many open tabs still cost the database one query per 10 seconds
let cache: { at: number; body: unknown } | null = null;

admin.get("/stats", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (cache && Date.now() - cache.at < TTL_MS) return res.json(cache.body);

  const s = await rpc<Record<string, any>>("admin_stats", {});

  // The price list lives in game/data.ts, not the database, so spending is worked out here.
  const bySeller = (s.sellers.by_seller as Counted<"seller">[]).map((x) => {
    const def = SELLERS[x.seller];
    return { ...x, price: def?.price ?? 0, perMin: def?.perMin ?? 0 };
  });
  const sellerSpend = bySeller.reduce((a, x) => a + x.n * x.price, 0);
  const incomePerMin = bySeller.reduce((a, x) => a + x.n * x.perMin, 0);
  const junctionUnlocks = (s.junction_unlocks as Counted<"junction">[]).map((x) => ({
    ...x, price: (JUNCTION_UNLOCKS as Record<string, { price: number } | undefined>)[x.junction]?.price ?? 0,
  }));
  const junctionSpend = junctionUnlocks.reduce((a, x) => a + x.n * x.price, 0);

  const body = {
    ...s,
    sellers: { ...s.sellers, by_seller: bySeller, spent: sellerSpend, income_per_min: incomePerMin },
    junction_unlocks: junctionUnlocks,
    spend: { sellers: sellerSpend, junctions: junctionSpend, total: sellerSpend + junctionSpend },
    live: { online: onlineCount(), ...liveStats() }, // this server only: if you run several, each one counts its own
  };
  cache = { at: Date.now(), body };
  res.json(body);
});
