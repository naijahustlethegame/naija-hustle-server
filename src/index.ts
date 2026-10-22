import "dotenv/config";
import { createServer } from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { attachPresence } from "./presence.js";

const server = createServer(app);
attachPresence(server);
server.listen(env.PORT, () => console.log(`server on :${env.PORT}`));