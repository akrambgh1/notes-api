import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const COLORS = ["default", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- small helpers ----------
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const now = () => new Date().toISOString();

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const t = Date.now();
    const list = (hits.get(req.ip) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) return next(new HttpError(429, "Too many attempts. Please try again in a few minutes."));
    list.push(t);
    hits.set(req.ip, list);
    next();
  };
}

const toNote = (row) => ({
  id: Number(row.id),
  title: row.title,
  content: row.content,
  color: row.color,
  tags: JSON.parse(row.tags),
  pinned: Boolean(Number(row.pinned)),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toUser = (row) => ({ id: Number(row.id), name: row.name, email: row.email, createdAt: row.created_at });

function validateNote(body, { partial = false } = {}) {
  const errors = {};
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) errors.title = "Title is required";
    else if (title.length > 120) errors.title = "Title must be 120 characters or less";
    out.title = title;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string") errors.content = "Content must be text";
    else if (body.content.length > 10000) errors.content = "Content must be 10,000 characters or less";
    else out.content = body.content;
  }
  if (body.color !== undefined) {
    if (!COLORS.includes(body.color)) errors.color = `Color must be one of: ${COLORS.join(", ")}`;
    else out.color = body.color;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string")) errors.tags = "Tags must be a list of text";
    else out.tags = [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 24));
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") errors.pinned = "Pinned must be true or false";
    else out.pinned = body.pinned;
  }
  if (Object.keys(errors).length) throw new HttpError(400, "Validation failed", errors);
  return out;
}

const SQL = {
  userByEmail: "SELECT * FROM users WHERE email = ?",
  userById: "SELECT * FROM users WHERE id = ?",
  insertUser: "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING *",
  deleteUser: "DELETE FROM users WHERE id = ?",
  notesByUser: "SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC, id DESC",
  noteById: "SELECT * FROM notes WHERE id = ? AND user_id = ?",
  insertNote:
    "INSERT INTO notes (user_id, title, content, color, tags, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
  updateNote:
    "UPDATE notes SET title = ?, content = ?, color = ?, tags = ?, pinned = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *",
  deleteNote: "DELETE FROM notes WHERE id = ? AND user_id = ?",
  stats: "SELECT COUNT(*) AS total, COALESCE(SUM(pinned), 0) AS pinned FROM notes WHERE user_id = ?",
};

// ---------- app ----------
// `database` may be a ready db or a promise of one (serverless cold starts connect lazily)
export function createApp({ database, jwtSecret, tokenTtl = "7d" }) {
  if (!jwtSecret) throw new Error("jwtSecret is required");
  const dbReady = Promise.resolve(database);
  dbReady.catch(() => {}); // errors are reported per request below

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));

  // Basic security headers
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
    });
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api", wrap(async (req, _res, next) => {
    try {
      req.db = await dbReady;
    } catch (err) {
      console.error("Database connection failed:", err);
      throw new HttpError(503, "The database is not available right now");
    }
    next();
  }));

  const sign = (user) => jwt.sign({ sub: String(user.id) }, jwtSecret, { expiresIn: tokenTtl });

  const auth = wrap(async (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw new HttpError(401, "Missing or invalid Authorization header");
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
      throw new HttpError(401, "Your session has expired. Please log in again.");
    }
    const user = await req.db.get(SQL.userById, [Number(payload.sub)]);
    if (!user) throw new HttpError(401, "Account no longer exists");
    req.user = user;
    next();
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

  // ----- auth -----
  app.post("/api/auth/register", authLimiter, wrap(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const errors = {};
    if (name.length < 2 || name.length > 40) errors.name = "Name must be 2–40 characters";
    if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address";
    if (password.length < 8) errors.password = "Password must be at least 8 characters";
    else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) errors.password = "Password needs at least one letter and one number";
    if (Object.keys(errors).length) throw new HttpError(400, "Validation failed", errors);
    if (await req.db.get(SQL.userByEmail, [email])) {
      throw new HttpError(409, "An account with this email already exists", { email: "Already registered" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await req.db.get(SQL.insertUser, [name, email, hash, now()]);
    res.status(201).json({ token: sign(user), user: toUser(user) });
  }));

  app.post("/api/auth/login", authLimiter, wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const user = await req.db.get(SQL.userByEmail, [email]);
    // Same message for wrong email and wrong password, so attackers can't tell which accounts exist
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, "Wrong email or password");
    }
    res.json({ token: sign(user), user: toUser(user) });
  }));

  app.get("/api/auth/me", auth, wrap(async (req, res) => {
    const stats = await req.db.get(SQL.stats, [req.user.id]);
    res.json({ user: toUser(req.user), stats: { total: Number(stats.total), pinned: Number(stats.pinned) } });
  }));

  app.delete("/api/auth/me", auth, wrap(async (req, res) => {
    await req.db.all(SQL.deleteUser, [req.user.id]); // notes are removed by ON DELETE CASCADE
    res.status(204).end();
  }));

  // ----- notes -----
  app.get("/api/notes", auth, wrap(async (req, res) => {
    const search = String(req.query.search ?? "").trim().toLowerCase();
    const tag = String(req.query.tag ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let notes = (await req.db.all(SQL.notesByUser, [req.user.id])).map(toNote);
    if (search) notes = notes.filter((n) => n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search));
    if (tag) notes = notes.filter((n) => n.tags.includes(tag));
    res.json({ total: notes.length, limit, offset, notes: notes.slice(offset, offset + limit) });
  }));

  app.get("/api/notes/tags", auth, wrap(async (req, res) => {
    const counts = {};
    for (const n of await req.db.all(SQL.notesByUser, [req.user.id])) {
      for (const t of JSON.parse(n.tags)) counts[t] = (counts[t] ?? 0) + 1;
    }
    res.json({ tags: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) });
  }));

  const findNote = async (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Note id must be a number");
    const row = await req.db.get(SQL.noteById, [id, req.user.id]);
    if (!row) throw new HttpError(404, "Note not found");
    return row;
  };

  app.get("/api/notes/:id", auth, wrap(async (req, res) => res.json({ note: toNote(await findNote(req)) })));

  app.post("/api/notes", auth, wrap(async (req, res) => {
    const data = validateNote(req.body ?? {});
    const t = now();
    const row = await req.db.get(SQL.insertNote, [
      req.user.id, data.title, data.content ?? "", data.color ?? "default", JSON.stringify(data.tags ?? []), data.pinned ? 1 : 0, t, t,
    ]);
    res.status(201).json({ note: toNote(row) });
  }));

  // PUT and PATCH both update only the fields that are sent
  const update = wrap(async (req, res) => {
    const current = toNote(await findNote(req));
    const data = validateNote(req.body ?? {}, { partial: true });
    const next = { ...current, ...data };
    const row = await req.db.get(SQL.updateNote, [
      next.title, next.content, next.color, JSON.stringify(next.tags), next.pinned ? 1 : 0, now(), current.id, req.user.id,
    ]);
    res.json({ note: toNote(row) });
  });
  app.put("/api/notes/:id", auth, update);
  app.patch("/api/notes/:id", auth, update);

  app.delete("/api/notes/:id", auth, wrap(async (req, res) => {
    const note = await findNote(req);
    await req.db.all(SQL.deleteNote, [note.id, req.user.id]);
    res.status(204).end();
  }));

  // Unknown API routes return JSON, everything else serves the frontend
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Route not found")));
  app.use(express.static(PUBLIC_DIR));

  // Central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") err = new HttpError(400, "Request body must be valid JSON");
    const status = err.status ?? 500;
    if (status >= 500 && status !== 503) console.error(err);
    res.status(status).json({ error: status >= 500 && status !== 503 ? "Something went wrong" : err.message, ...(err.details && { details: err.details }) });
  });

  return app;
}
