import "dotenv/config";
import app from "./app.js";

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`server on :${port}`));
}

export default app; // Vercel picks this up