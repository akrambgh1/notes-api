// Vercel entry point. Static files in public/ are served by Vercel's CDN;
// API calls are rewritten here (see vercel.json).
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) console.error("DATABASE_URL is not set. Connect a Neon Postgres database in the Vercel dashboard.");
if (!process.env.JWT_SECRET) console.error("JWT_SECRET is not set. Add it in Vercel → Settings → Environment Variables.");

const app = createApp({
  database: url ? openDb(url) : Promise.reject(new Error("DATABASE_URL is not set")),
  jwtSecret: process.env.JWT_SECRET || "missing-secret-set-JWT_SECRET",
});

// vercel.json passes the original path as ?__path=..., restore it so Express routes match
export default function handler(req, res) {
  const parsed = new URL(req.url, "http://localhost");
  const original = parsed.searchParams.get("__path");
  if (original) {
    parsed.searchParams.delete("__path");
    const query = parsed.searchParams.toString();
    req.url = `${original}${query ? `?${query}` : ""}`;
  }
  return app(req, res);
}
