/** Authoritative economy. The client copy is for display only; these numbers decide what is paid. */
export type ItemId = "water" | "drink" | "snack" | "gadget" | "fruit" | "bread" | "charger" | "shades" | "perfume";
export const ITEM_IDS: ItemId[] = ["water", "drink", "snack", "gadget", "fruit", "bread", "charger", "shades", "perfume"];
export const ITEM_PRICE: Record<ItemId, number> = {
  water: 50, drink: 150, snack: 120, gadget: 800, fruit: 70, bread: 100, charger: 500, shades: 650, perfume: 1200,
};
/** Highest sale price possible: jeep 1.8x, +15% offer spread, +30% push, +50% streak. */
export const MAX_PRICE_MULT = 1.8 * 1.15 * 1.3 * 1.5;
export const TRAY_CAP = 14;
export const STORAGE_CAP = 60;
export const MAX_LEVEL = 4;

export const JUNCTIONS = ["ojuelegba", "obalende", "lekki"] as const;
export type JunctionId = (typeof JUNCTIONS)[number];

/** What a new player starts with. Everything else is bought. Keep in step with the client (game/engine/progression.ts). */
export const STARTER_JUNCTIONS: JunctionId[] = ["ojuelegba"];
export const STARTER_ITEMS: ItemId[] = ["water", "drink", "snack", "fruit", "bread"];
export const JUNCTION_UNLOCKS: Partial<Record<JunctionId, { price: number; requires?: JunctionId }>> = {
  obalende: { price: 15000 },
  lekki: { price: 50000, requires: "obalende" },
};
export const ITEM_PACKS: Record<string, { price: number; items: ItemId[]; requiresJunction?: JunctionId }> = {
  tech: { price: 6000, items: ["charger", "gadget"] },
  luxury: { price: 25000, items: ["shades", "perfume"], requiresJunction: "lekki" },
};
/** Better junctions have faster roads, so a run there can pick things up a little faster. */
export const TIER: Record<JunctionId, 1 | 2 | 3> = { ojuelegba: 1, obalende: 2, lekki: 3 };
export const PICKUPS_PER_SEC: Record<1 | 2 | 3, number> = { 1: 1.5, 2: 1.6, 3: 1.8 };

export const SELLERS: Record<string, { price: number; perMin: number }> = {
  tunde: { price: 1500, perMin: 60 },
  amaka: { price: 4000, perMin: 180 },
  chidi: { price: 9500, perMin: 420 },
  bisi: { price: 22000, perMin: 900 },
};
export const MAX_AWAY_MIN = 180;

export type Market = { id: string; junction: JunctionId; fee: number; items: ItemId[]; maxCash: number };
export const MARKETS: Market[] = [
  { id: "mushin", junction: "ojuelegba", fee: 100, items: ["water", "fruit", "snack", "bread"], maxCash: 120 },
  { id: "oshodi", junction: "ojuelegba", fee: 140, items: ["water", "drink", "snack", "bread", "fruit"], maxCash: 120 },
  { id: "yaba", junction: "ojuelegba", fee: 200, items: ["drink", "snack", "water", "bread", "charger"], maxCash: 120 },
  { id: "balogun", junction: "obalende", fee: 230, items: ["drink", "snack", "water", "bread", "charger"], maxCash: 300 },
  { id: "idumota", junction: "obalende", fee: 340, items: ["snack", "drink", "charger", "gadget", "bread"], maxCash: 300 },
  { id: "computer", junction: "obalende", fee: 490, items: ["charger", "gadget", "drink", "snack", "bread"], maxCash: 300 },
  { id: "craft", junction: "lekki", fee: 600, items: ["drink", "shades", "snack", "perfume", "gadget"], maxCash: 800 },
  { id: "ikate", junction: "lekki", fee: 760, items: ["drink", "gadget", "shades", "perfume", "snack"], maxCash: 800 },
  { id: "vimall", junction: "lekki", fee: 930, items: ["perfume", "gadget", "shades", "drink", "snack"], maxCash: 800 },
];
export const marketById = (id: string) => MARKETS.find((m) => m.id === id);
export const fineFor = (m: Market) => m.fee * 2;

/** The server picks the market, so the client cannot choose the cheapest or richest. */
export function rollMarket(j: JunctionId, avoid?: string): Market {
  const pool = MARKETS.filter((m) => m.junction === j);
  const opts = pool.filter((m) => m.id !== avoid);
  return opts[Math.floor(Math.random() * opts.length)]!;
}
