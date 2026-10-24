import type { WebSocket } from "ws";

/**
 * Multiplayer rooms. Each junction has many rooms; a room seats at most ROOM_CAP players.
 * When every room of a junction is full, a new one is created. Spectators (the homepage) never take a seat.
 * The server relays positions and arbitrates buyers: if several players reach the same buyer
 * inside CLAIM_WINDOW_MS, one is picked at random and the rest get turned down.
 *
 * Power-ups live here too, so nobody can fake them: the server spawns pickups on the road, picks who grabs one
 * (the same random pick as buyers), holds one item per player, and decides every effect.
 * Shield is passive (does not occupy the held slot) so a player can still grab boost/pothole/horn while blessed.
 */
export const ROOM_CAP = Number(process.env.ROOM_CAP ?? 6);
const CLAIM_WINDOW_MS = 350;
const TICK_MS = 100;
const JUNCTIONS = ["ojuelegba", "obalende", "lekki"] as const;
type Junction = (typeof JUNCTIONS)[number];

type Kind = "shield" | "boost" | "pothole" | "horn";
type Pickup = { id: string; kind: Kind; x: number; y: number; born: number };
type Trap = { id: string; x: number; y: number; by: string; until: number };

type Client = {
  id: string; ws: WebSocket; room: Room | null; seated: boolean;
  avatar: unknown; name: string;
  x: number; y: number; s: string; lastPos: number;
  held: Kind | null; shielded: boolean;
  inv: { room: string; by: string } | null; invUsed: boolean;
};
type Claim = { open: Map<string, true>; winner: string | null; at: number; timer?: NodeJS.Timeout };
type Room = {
  id: string; junction: Junction; clients: Set<Client>; claims: Map<string, Claim>; dirty: boolean;
  pickups: Map<string, Pickup>; traps: Map<string, Trap>; nextSpawn: number;
};

const rooms = new Map<string, Room>();
let seq = 0;
const uid = () => Math.random().toString(36).slice(2, 8);
const clamp = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(n)) ? Number(n) : lo));
const seats = (r: Room) => [...r.clients].filter((c) => c.seated);
const send = (c: Client, m: unknown) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
const cast = (r: Room, m: unknown) => { const s = JSON.stringify(m); for (const c of r.clients) if (c.ws.readyState === 1) c.ws.send(s); };

function roster(r: Room) {
  return seats(r).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, shield: c.shielded }));
}

// ---------- power-ups ----------
// Rare and rewarding: sparse spawns, shield uncommon, longer horn/pothole.
const PICKUP_TTL_MS = 10000;
const SPAWN_MIN_MS = 16000;
const SPAWN_MAX_MS = 28000;
const MAX_PICKUPS = 1;
const TRAP_TTL_MS = 25000, TRAP_RX = 30, TRAP_RY = 22;
const HORN_RADIUS = 230;
const STUN_MS = 2500;
const BOOST_MS = 8000;
const SLOW_MS = 5500;
const WEIGHTS: [Kind, number][] = [
  ["shield", 8],
  ["boost", 34],
  ["pothole", 29],
  ["horn", 29],
];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickKind = (): Kind => {
  let n = Math.random() * WEIGHTS.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of WEIGHTS) { if ((n -= w) < 0) return k; }
  return "boost";
};

/** Held item (boost / pothole / horn only). Shield never occupies this slot. */
function setHeld(c: Client, kind: Kind | null) {
  if (kind === "shield") return;
  c.held = kind;
  send(c, { type: "held", kind });
}

/** God's Blessing: passive, public, does not block the held slot. */
function setShield(c: Client, on: boolean) {
  if (!!c.shielded === on) return;
  c.shielded = on;
  if (c.room) cast(c.room, { type: "shield", id: c.id, on });
  // Clear the held banner on the owner so they can grab another pickup.
  if (on) send(c, { type: "held", kind: null });
}

function spawnPickup(r: Room) {
  const p: Pickup = { id: uid(), kind: pickKind(), x: Math.round(rnd(100, 780)), y: Math.round(rnd(195, 350)), born: Date.now() };
  r.pickups.set(p.id, p);
  cast(r, { type: "pickup", op: "spawn", p: { id: p.id, kind: p.kind, x: p.x, y: p.y, ttl: PICKUP_TTL_MS / 1000 } });
}

function usePower(c: Client) {
  const r = c.room;
  if (!r || !c.seated || !c.held || c.held === "shield") { send(c, { type: "deny" }); return; }
  const kind = c.held;
  setHeld(c, null);
  if (kind === "boost") cast(r, { type: "fx", kind: "boost", by: c.id, ms: BOOST_MS });
  else if (kind === "pothole") {
    const t: Trap = { id: uid(), x: Math.round(clamp(c.x, 40, 880)), y: Math.round(clamp(c.y, 174, 362)), by: c.id, until: Date.now() + TRAP_TTL_MS };
    r.traps.set(t.id, t);
    cast(r, { type: "trap", op: "add", t: { id: t.id, x: t.x, y: t.y, by: t.by } });
  } else if (kind === "horn") {
    const hit: string[] = [], blocked: string[] = [];
    for (const o of seats(r)) {
      if (o === c || Math.hypot(o.x - c.x, o.y - c.y) > HORN_RADIUS) continue;
      if (o.shielded) { setShield(o, false); blocked.push(o.id); } else hit.push(o.id);
    }
    cast(r, { type: "fx", kind: "horn", by: c.id, x: Math.round(c.x), y: Math.round(c.y), hit, blocked, ms: STUN_MS });
  }
}

/** 10 times a second: spawn and expire pickups, expire potholes, and see who walked into one. */
function powerTick() {
  const now = Date.now();
  for (const r of rooms.values()) {
    const sit = seats(r);
    for (const p of r.pickups.values()) {
      if (now - p.born < PICKUP_TTL_MS) continue;
      r.pickups.delete(p.id); r.claims.delete("pk:" + p.id);
      cast(r, { type: "pickup", op: "gone", id: p.id, by: "" });
    }
    if (sit.length > 0 && r.pickups.size < MAX_PICKUPS && now >= r.nextSpawn) {
      spawnPickup(r);
      r.nextSpawn = now + rnd(SPAWN_MIN_MS, SPAWN_MAX_MS);
    }
    for (const t of r.traps.values()) {
      if (now >= t.until) { r.traps.delete(t.id); cast(r, { type: "trap", op: "remove", id: t.id }); continue; }
      const v = sit.find((o) => o.id !== t.by && Math.abs(o.x - t.x) < TRAP_RX && Math.abs(o.y - t.y) < TRAP_RY);
      if (!v) continue;
      r.traps.delete(t.id);
      const blocked = v.shielded;
      if (blocked) setShield(v, false);
      cast(r, { type: "trap", op: "remove", id: t.id });
      cast(r, { type: "fx", kind: "trap", victim: v.id, x: t.x, y: t.y, blocked, ms: SLOW_MS });
    }
  }
}
setInterval(powerTick, 100).unref();

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
  const r: Room = {
    id: `${j}-${++seq}`, junction: j, clients: new Set(), claims: new Map(), dirty: false,
    pickups: new Map(), traps: new Map(), nextSpawn: Date.now() + 8000,
  };
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
  if (c.held) setHeld(c, null);
  if (c.shielded) setShield(c, false);
  r.clients.delete(c); c.room = null; c.seated = false;
  if (r.clients.size === 0) { for (const k of r.claims.values()) clearTimeout(k.timer); rooms.delete(r.id); }
  else announce(r);
}

function join(c: Client, m: any) {
  const wantsSeat = !!m.play;
  const j: Junction | null = JUNCTIONS.includes(m.junction) ? m.junction : null;
  if (m.avatar && JSON.stringify(m.avatar).length < 400) c.avatar = m.avatar;
  if (typeof m.name === "string") c.name = m.name.replace(/[^\w .-]/g, "").trim().slice(0, 16);
  if (!c.inv && typeof m.room === "string" && m.room.length <= 24) c.inv = { room: m.room, by: typeof m.by === "string" ? m.by.slice(0, 12) : "" };
  if (!wantsSeat && c.held) setHeld(c, null);
  if (!wantsSeat && c.shielded) setShield(c, false);
  const prev = c.room;
  let target: Room | null = null, bonus = false;
  // An invite link drops a new player into the inviter's room, and both start with a God's Blessing shield.
  if (wantsSeat && c.inv && !c.invUsed) {
    const ir = rooms.get(c.inv.room);
    if (ir && (ir === prev || seats(ir).length < ROOM_CAP)) { target = ir; bonus = true; }
    c.invUsed = true;
  }
  if (!target) target = j ? findRoom(j, prev) : busiest();
  if (!target) { detach(c); send(c, { type: "roster", room: null, junction: null, cap: ROOM_CAP, players: [] }); return; }
  if (prev !== target) { detach(c); target.clients.add(c); c.room = target; }
  c.seated = wantsSeat;
  announce(target);
  if (bonus && c.inv) {
    if (!c.shielded) setShield(c, true);
    const inviter = [...target.clients].find((o) => o.id === c.inv!.by && o.seated && o !== c);
    if (inviter && !inviter.shielded) setShield(inviter, true);
  }
}

function claim(c: Client, key: string) {
  const r = c.room; if (!r || !c.seated || typeof key !== "string" || key.length > 24) return;
  if (key.startsWith("pk:")) {
    // Shield is passive and does not block grabs; only a usable held item does.
    if (c.held) return;
    if (!r.pickups.has(key.slice(3))) { send(c, { type: "claimResult", key, winner: "" }); return; }
  }
  let k = r.claims.get(key);
  if (k?.winner) { send(c, { type: "claimResult", key, winner: k.winner }); return; }
  if (!k) {
    k = { open: new Map(), winner: null, at: Date.now() };
    r.claims.set(key, k);
    const kk = k;
    kk.timer = setTimeout(() => resolve(r, key, kk), CLAIM_WINDOW_MS);
  }
  k.open.set(c.id, true);
  if (seats(r).length === 1) { clearTimeout(k.timer); resolve(r, key, k); }
}

function resolve(r: Room, key: string, k: Claim) {
  if (k.winner) return;
  const ids = [...k.open.keys()].filter((id) => [...r.clients].some((c) => c.id === id));
  if (!ids.length) { r.claims.delete(key); return; }
  const winner = ids[Math.floor(Math.random() * ids.length)];
  if (!winner) { r.claims.delete(key); return; }
  k.winner = winner;
  cast(r, { type: "claimResult", key, winner: k.winner, losers: ids.filter((i) => i !== k.winner) });
  if (key.startsWith("pk:")) {
    const p = r.pickups.get(key.slice(3)), w = [...r.clients].find((c) => c.id === winner);
    if (p) {
      r.pickups.delete(p.id);
      cast(r, { type: "pickup", op: "gone", id: p.id, by: winner });
      if (w) {
        if (p.kind === "shield") setShield(w, true);
        else if (!w.held) setHeld(w, p.kind);
      }
    }
  }
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
    case "use": return usePower(c);
    case "shieldhit": {
      const r = c.room; if (!r || !c.seated || !c.shielded) return;
      setShield(c, false);
      cast(r, { type: "fx", kind: "shieldpop", id: c.id });
      return;
    }
    case "settle": {
      const r = c.room; if (!r || !c.seated) return;
      const k = r.claims.get(String(m.key));
      if (!k || k.winner !== c.id) return;
      cast(r, { type: "settled", key: String(m.key), by: c.id, sold: !!m.sold, price: clamp(m.price, 0, 5000) });
    }
  }
}

export function addClient(ws: WebSocket): Client {
  const c: Client = {
    id: uid(), ws, room: null, seated: false, avatar: null, name: "",
    x: 300, y: 470, s: "idle", lastPos: 0,
    held: null, shielded: false, inv: null, invUsed: false,
  };
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

/** A snapshot for the admin page: how many rooms are open, who is seated, who is only watching. */
export function liveStats() {
  const byJunction: Record<string, { rooms: number; seated: number }> = Object.fromEntries(JUNCTIONS.map((j) => [j, { rooms: 0, seated: 0 }]));
  let seated = 0, watching = 0;
  const list: { id: string; junction: string; seated: number; watching: number }[] = [];
  for (const r of rooms.values()) {
    const n = seats(r).length, w = r.clients.size - n;
    seated += n; watching += w;
    byJunction[r.junction]!.rooms++; byJunction[r.junction]!.seated += n;
    list.push({ id: r.id, junction: r.junction, seated: n, watching: w });
  }
  list.sort((a, b) => b.seated - a.seated);
  return { rooms: rooms.size, seated, watching, cap: ROOM_CAP, byJunction, list: list.slice(0, 20) };
}