import { Router } from "express";
import { z } from "zod";
import { REFERRAL } from "../game/data.js";
import { ApiError, db, rpc } from "../lib/supabase.js";

export const referrals = Router();

/** Your invite code, the rules, and how each friend you invited is getting on. */
referrals.get("/me", async (req, res) => {
  const code = await rpc<string | null>("get_referral_code", { p_id: req.uid });
  if (!code) throw new ApiError(404, "No player");
  const { data } = await db.from("referrals").select("invitee_id,sales,qualified_at,inviter_paid").eq("inviter_id", req.uid).order("created_at", { ascending: false }).limit(200);
  const rows = data ?? [];
  const names = rows.length ? (await db.from("players").select("id,name").in("id", rows.map((r) => r.invitee_id))).data ?? [] : [];
  const nameOf = new Map(names.map((n) => [n.id as string, (n.name as string) || "A friend"]));
  const friends = rows.map((r) => ({ name: nameOf.get(r.invitee_id) ?? "A friend", sales: Math.min(r.sales, REFERRAL.salesToQualify), done: !!r.qualified_at, reward: Number(r.inviter_paid) }));
  res.json({
    code, reward: REFERRAL.inviterReward, friendReward: REFERRAL.inviteeReward, salesToQualify: REFERRAL.salesToQualify, maxPaid: REFERRAL.maxPaid,
    paid: friends.filter((f) => f.reward > 0).length, earned: friends.reduce((a, f) => a + f.reward, 0), friends,
  });
});

/** Say who invited you. Quietly returns ok:false for a bad, own or repeat code, so it cannot be used to probe for codes. */
referrals.post("/redeem", async (req, res) => {
  const { code } = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,10}$/) }).parse(req.body);
  const ok = await rpc<boolean>("redeem_referral", { p_invitee: req.uid, p_code: code });
  res.json({ ok: !!ok });
});
