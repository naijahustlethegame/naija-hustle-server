import type { WebSocket } from "ws";

/**
 * Multiplayer rooms. Each junction has many rooms; a room seats at most ROOM_CAP players.
 * When every room of a junction is full, a new one is created. Spectators (the homepage) never take a seat.
 * The server relays positions and arbitrates buyers: if several players reach the same buyer
 * inside CLAIM_WINDOW_MS, one is picked at random and the rest get turned down.
 */
export const ROOM_CAP = Number(process.env.ROOM_CAP ?? 6);
const CLAIM_WINDOW_MS = 350;
const TICK_MS = 100;
const JUNCTIONS = ["ojuelegba", "obalende", "lekki"] as const;
type Junction = (typeof JUNCTIONS)[number];

type Client = {
  id: string; ws: WebSocket; room: Room | null; seated: boolean;
  avatar: unknown; name: string;
  x: number; y: number; s: string; lastPos: number;
};
type Claim = { open: Map<string, true>; winner: string | null; at: number; timer?: NodeJS.Timeout };
type Room = { id: string; junction: Junction; clients: Set<Client>; claims: Map<string, Claim>; dirty: boolean };

const rooms = new Map<string, Room>();
let seq = 0;
const uid = () => Math.random().toString(36).slice(2, 8);
const clamp = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(n)) ? Number(n) : lo));
const seats = (r: Room) => [...r.clients].filter((c) => c.seated);
const send = (c: Client, m: unknown) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
const cast = (r: Room, m: unknown) => { const s = JSON.stringify(m); for (const c of r.clients) if (c.ws.readyState === 1) c.ws.send(s); };

function roster(r: Room) {
  return seats(r).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }));
}
function announce(r: Room) {
  cast(r, { type: "roster", room: r.id, junction: r.junction, cap: ROOM_CAP, players: roster(r) });
}

/** Fullest room with a free seat keeps rooms lively. Otherwise open a fresh one. */
function findRoom(j: Junction, prefer?: Room | null): Room {
  if (prefer && prefer.junction === j && seats(prefer).length < ROOM_CAP) return prefer;
  let best: Room | null = null;
  for (const r of rooms.values()) {
    if (r.junction !== j) continue;
    const n = seats(r).length;
    if (n < ROOM_CAP && (!best || n > seats(best).length)) best = r;
  }
  if (best) return best;
  const r: Room = { id: `${j}-${++seq}`, junction: j, clients: new Set(), claims: new Map(), dirty: false };
  rooms.set(r.id, r);
  return r;
}
/** Homepage: watch the busiest room anywhere. Null when nobody is playing. */
function busiest(): Room | null {
  let best: Room | null = null;
  for (const r of rooms.values()) if (seats(r).length > 0 && (!best || seats(r).length > seats(best).length)) best = r;
  return best;
}

function detach(c: Client) {
  const r = c.room; if (!r) return;
  r.clients.delete(c); c.room = null; c.seated = false;
  if (r.clients.size === 0) { for (const k of r.claims.values()) clearTimeout(k.timer); rooms.delete(r.id); }
  else announce(r);
}

function join(c: Client, m: any) {
  const wantsSeat = !!m.play;
  const j: Junction | null = JUNCTIONS.includes(m.junction) ? m.junction : null;
  if (m.avatar && JSON.stringify(m.avatar).length < 400) c.avatar = m.avatar;
  if (typeof m.name === "string") c.name = m.name.replace(/[^\w .-]/g, "").trim().slice(0, 16);
  const prev = c.room;
  let target: Room | null;
  if (j) target = findRoom(j, prev);
  else target = busiest(); // spectate-anywhere
  if (!target) { detach(c); send(c, { type: "roster", room: null, junction: null, cap: ROOM_CAP, players: [] }); return; }
  if (prev !== target) { detach(c); target.clients.add(c); c.room = target; }
  c.seated = wantsSeat;
  announce(target);
}

function claim(c: Client, key: string) {
  const r = c.room; if (!r || !c.seated || typeof key !== "string" || key.length > 24) return;
  let k = r.claims.get(key);
  if (k?.winner) { send(c, { type: "claimResult", key, winner: k.winner }); return; } // too late
  if (!k) {
    k = { open: new Map(), winner: null, at: Date.now() };
    r.claims.set(key, k);
    const kk = k;
    kk.timer = setTimeout(() => resolve(r, key, kk), CLAIM_WINDOW_MS);
  }
  k.open.set(c.id, true);
  if (seats(r).length === 1) { clearTimeout(k.timer); resolve(r, key, k); } // alone: no waiting
}
function resolve(r: Room, key: string, k: Claim) {
  if (k.winner) return;
  const ids = [...k.open.keys()].filter((id) => [...r.clients].some((c) => c.id === id));
  if (!ids.length) { r.claims.delete(key); return; }
  k.winner = ids[Math.floor(Math.random() * ids.length)];
  cast(r, { type: "claimResult", key, winner: k.winner, losers: ids.filter((i) => i !== k.winner) });
  // forget old claims so the map never grows
  const now = Date.now();
  for (const [kk, v] of r.claims) if (now - v.at > 60_000) r.claims.delete(kk);
}

export function handleRoomMessage(c: Client, raw: string) {
  if (raw.length > 600) return;
  let m: any; try { m = JSON.parse(raw); } catch { return; }
  switch (m.type) {
    case "join": return join(c, m);
    case "pos": {
      const now = Date.now(); if (!c.room || !c.seated || now - c.lastPos < 60) return;
      c.lastPos = now; c.x = clamp(m.x, 0, 960); c.y = clamp(m.y, 0, 540);
      c.s = ["idle", "running", "haggle", "pause", "walk"].includes(m.s) ? m.s : "idle";
      c.room.dirty = true; return;
    }
    case "claim": return claim(c, String(m.key));
    case "settle": {
      const r = c.room; if (!r || !c.seated) return;
      const k = r.claims.get(String(m.key));
      if (!k || k.winner !== c.id) return; // only the chosen seller can settle
      cast(r, { type: "settled", key: String(m.key), by: c.id, sold: !!m.sold, price: clamp(m.price, 0, 5000) });
    }
  }
}

export function addClient(ws: WebSocket): Client {
  const c: Client = { id: uid(), ws, room: null, seated: false, avatar: null, name: "", x: 300, y: 470, s: "idle", lastPos: 0 };
  send(c, { type: "welcome", id: c.id, cap: ROOM_CAP });
  return c;
}
export const removeClient = detach;

/** 10 snapshots a second, only for rooms where somebody moved. */
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.dirty) continue; r.dirty = false;
    cast(r, { type: "snap", p: seats(r).map((c) => [c.id, Math.round(c.x), Math.round(c.y), c.s]) });
  }
}, TICK_MS).unref();
