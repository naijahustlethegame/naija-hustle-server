import "dotenv/config";
import app from "./app.js";
import { env } from "./config/env.js";

if (!process.env.VERCEL) app.listen(env.PORT, () => console.log(`server on :${env.PORT}`));

export default app; // Vercel picks this up
