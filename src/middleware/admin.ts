import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Guards the admin routes with a shared secret (ADMIN_STATS_KEY), sent in the x-admin-key header.
 * Players sign in anonymously, so there is no stable "admin account" to check; a secret only you know is the safe option.
 * With no key configured the routes stay switched off. Both sides are hashed first so the comparison is constant time.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const want = env.ADMIN_STATS_KEY;
  if (!want) return res.status(503).json({ error: "Stats are not enabled" });
  const got = String(req.headers["x-admin-key"] ?? "");
  const a = createHash("sha256").update(got).digest(), b = createHash("sha256").update(want).digest();
  if (!timingSafeEqual(a, b)) return res.status(401).json({ error: "Unauthorized" });
  next();
}
