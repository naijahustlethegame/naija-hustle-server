import { createServer } from "node:http";
import app from "./app.js";
import { handleLeaderboard } from "./leaderboard.js";
import { attachPresence } from "./presence.js";

// Leaderboard, express routes and the multiplayer rooms (/ws) on one port.
const server = createServer((req, res) => {
  if (handleLeaderboard(req, res)) return;
  app(req, res);
});
attachPresence(server);
const port = Number(process.env.PORT) || 4000;
server.listen(port, () => console.log(`naija-hustle-server (rooms on) listening on :${port}`));
