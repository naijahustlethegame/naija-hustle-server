import express from "express";
import cors from "cors";
import helmet from "helmet";


const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
// app.use("/sync", requireAuth, syncRouter);  // add as you build routes

export default app;