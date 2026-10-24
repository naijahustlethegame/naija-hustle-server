import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { ApiError } from "./lib/supabase.js";
import { requireAuth } from "./middleware/auth.js";
import { player } from "./routes/player.js";
import { runs } from "./routes/runs.js";
import { sellers } from "./routes/sellers.js";
import { unlocks } from "./routes/unlocks.js";
import { leaderboard } from "./routes/leaderboard.js";
import { referrals } from "./routes/referrals.js";
import { radio } from "./routes/radio.js";
import { admin } from "./routes/admin.js";
import { requireAdmin } from "./middleware/admin.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "20kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, validate: false }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/leaderboard", leaderboard);
app.use("/radio", radio);
app.use("/admin", rateLimit({ windowMs: 60_000, limit: 30, validate: false }), requireAdmin, admin);
app.use("/player", requireAuth, player);
app.use("/runs", requireAuth, runs);
app.use("/sellers", requireAuth, sellers);
app.use("/unlocks", requireAuth, unlocks);
app.use("/referrals", requireAuth, referrals);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: "Invalid request" });
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

export default app;
