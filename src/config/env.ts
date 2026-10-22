import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WEB_ORIGIN: z.string().optional(),
  PORT: z.coerce.number().default(4000),
});

export const env = schema.parse(process.env);
