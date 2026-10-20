// Minimal presence server: counts connected players and broadcasts it.
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, online: wss.clients.size }));
});
const wss = new WebSocketServer({ server });
const broadcast = () => {
  const msg = JSON.stringify({ type: "presence", online: wss.clients.size });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
};
wss.on("connection", (ws) => { broadcast(); ws.on("close", broadcast); });
server.listen(process.env.PORT || 4000, () => console.log("naija-hustle-server up"));
