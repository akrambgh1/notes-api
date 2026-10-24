import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/app.js";
import { openDb } from "./src/db.js";

const PORT = process.env.PORT || 4000;
// A postgres:// URL uses Postgres (e.g. Neon); otherwise a local SQLite file
const DB_URL =
  process.env.DATABASE_URL || process.env.DB_PATH || fileURLToPath(new URL("./data/notevault.db", import.meta.url));

let secret = process.env.JWT_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === "production") {
    console.error("JWT_SECRET must be set in production.");
    process.exit(1);
  }
  // Fine for local development: tokens stop working when the server restarts
  secret = randomBytes(32).toString("hex");
  console.warn("JWT_SECRET is not set, using a random development secret.");
}

const app = createApp({ database: openDb(DB_URL), jwtSecret: secret });

app.listen(PORT, () => {
  console.log(`NoteVault API running on http://localhost:${PORT}`);
});
