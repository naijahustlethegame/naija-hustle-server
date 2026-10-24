import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { addClient, handleRoomMessage, removeClient } from "./rooms.js";

/** Call once with your existing http server: attachPresence(server). Presence count plus game rooms. */
let current: WebSocketServer | null = null;
/** How many browsers are connected right now (players and people watching the homepage). */
export const onlineCount = () => current?.clients.size ?? 0;

export function attachPresence(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  current = wss;
  const broadcast = () => {
    const msg = JSON.stringify({ type: "presence", online: wss.clients.size });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };
  wss.on("connection", (ws) => {
    const client = addClient(ws);
    broadcast();
    ws.on("message", (d) => handleRoomMessage(client, d.toString()));
    ws.on("close", () => { removeClient(client); broadcast(); });
    ws.on("error", () => ws.close());
  });
  return wss;
}
