import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WEB_ORIGIN: z.string().optional(),
  PORT: z.coerce.number().default(4000),
  ADMIN_STATS_KEY: z.string().min(20).optional(),
  NAIJA_RADIO_API_KEY: z.string().min(1).optional(),
  NAIJA_RADIO_API_BASE_URL: z.url().optional(),
});

export const env = schema.parse(process.env);
