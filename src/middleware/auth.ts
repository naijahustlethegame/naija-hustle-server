import type { NextFunction, Request, Response } from "express";
import { db } from "../lib/supabase.js";

declare global { namespace Express { interface Request { uid: string } } }

/** Verifies the Supabase access token locally (cached JWKS), so no round trip per request. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /i, "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const { data, error } = await db.auth.getClaims(token);
  if (error || !data?.claims?.sub) return res.status(401).json({ error: "Unauthorized" });
  req.uid = data.claims.sub;
  next();
}
