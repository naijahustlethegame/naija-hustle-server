import type { Server } from "node:http";
import { WebSocketServer } from "ws";

/** Call once with your existing http server: attachPresence(server). */
export function attachPresence(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const broadcast = () => {
    const msg = JSON.stringify({ type: "presence", online: wss.clients.size });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };
  wss.on("connection", (ws) => {
    broadcast();
    ws.on("close", broadcast);
  });
  return wss;
}
