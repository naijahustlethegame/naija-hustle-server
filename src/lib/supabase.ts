import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

/** Service-role client. Server only: every game RPC is executable by this role alone. */
export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Run an RPC and map Postgres errors to client errors. */
export async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    console.error(`rpc ${fn} failed:`, error.message);
    const m = error.message ?? "";
    if (/check constraint|violates|pot_exists|storage_full|no_pot|no_player|duplicate key|locked|already_unlocked|not_enough_money/i.test(m)) throw new ApiError(409, "Not allowed");
    throw new ApiError(500, "Server error");
  }
  return data as T;
}