import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { addClient, handleRoomMessage, removeClient } from "./rooms";

/** Call once with your existing http server: attachPresence(server). Presence count plus game rooms. */
export function attachPresence(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
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
