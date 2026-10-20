import type { IncomingMessage, ServerResponse } from "node:http";

type Entry = { name: string; score: number; at: number };
const MAX_SCORE = 5000;           // plausible cap for a 90s round; tune as balance changes
const board: Entry[] = [];        // in-memory; swap save()/top() for Supabase later
const lastPost = new Map<string, number>();

const top = (n = 20) => [...board].sort((a, b) => b.score - a.score).slice(0, n);
function save(e: Entry) { board.push(e); board.sort((a, b) => b.score - a.score); board.length = Math.min(board.length, 100); }

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.WEB_ORIGIN ?? "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage & { body?: unknown }): Promise<any> {
  if (req.body) return req.body; // already parsed by Express
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 2000) throw new Error("big"); }
  return JSON.parse(raw || "{}");
}

/** Framework-neutral. Returns true if the request was a /leaderboard route. */
export function handleLeaderboard(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url?.startsWith("/leaderboard")) return false;
  if (req.method === "OPTIONS") { send(res, 204, {}); return true; }
  if (req.method === "GET") { send(res, 200, { top: top() }); return true; }
  if (req.method === "POST") {
    (async () => {
      const ip = String(req.socket.remoteAddress);
      if (Date.now() - (lastPost.get(ip) ?? 0) < 20_000) return send(res, 429, { error: "Slow down" });
      try {
        const b = await readJson(req);
        const score = Math.floor(Number(b.score));
        const name = String(b.name ?? "").replace(/[^\w .-]/g, "").trim().slice(0, 16);
        if (!name || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) return send(res, 400, { error: "Invalid" });
        lastPost.set(ip, Date.now());
        save({ name, score, at: Date.now() });
        send(res, 201, { top: top() });
      } catch { send(res, 400, { error: "Bad request" }); }
    })();
    return true;
  }
  send(res, 405, { error: "Method not allowed" });
  return true;
}
