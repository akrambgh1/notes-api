# 🗒️ NoteVault — REST API + JWT Auth

NoteVault is a full-stack notes app built around a clean, tested **REST API**. Users sign up and log in with **JWT authentication**, then create, search, tag, color and pin their notes. Each user can only ever see their own data.

**Backend:** Node.js, Express, **Postgres** (Neon) in production and **SQLite** (built-in `node:sqlite`) locally, bcrypt, JSON Web Tokens
**Frontend:** vanilla JavaScript, HTML and CSS (no framework)
**Tests:** 18 integration tests with `node:test`, run on both SQLite and Postgres (via PGlite)
**Hosting:** Vercel (serverless) + Neon Postgres

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/akrambgh1/notes-api&env=JWT_SECRET&envDescription=Any%20long%20random%20string%20used%20to%20sign%20login%20tokens)

## ✨ Features

### API
- 🔐 **Register / login** with **bcrypt** password hashing and **JWT** Bearer tokens (expire after 7 days)
- 🛡️ **Authorization**: every note query is scoped to the logged-in user, so others get a 404
- ✅ **Input validation** with clear, per-field error messages
- 🔎 **Search**, **tag filter** and **pagination** (`limit` / `offset`)
- 📌 Pin, color and tag notes; partial updates with `PATCH`
- 🚦 **Rate limiting** on login and sign-up (20 attempts per 15 min per IP)
- 🧱 **Security headers** (CSP, nosniff, frame-deny) and a central JSON error handler
- 🗑️ Delete your account, which also removes all your notes (`ON DELETE CASCADE`)

### Frontend
- Login / sign-up tabs with inline validation errors
- Google Keep–style note grid with **pinned** section, **colors**, tags and live search
- Quick add, edit dialog, delete, and a user menu with your note stats
- Stays logged in after a refresh; follows your system light/dark theme

## 🚀 Run Locally

Requires **Node.js 22.13 or newer** (for the built-in SQLite module).

```bash
git clone https://github.com/akrambgh1/notes-api.git
cd notes-api
npm install
npm start        # http://localhost:4000
npm test         # run the API tests
```

Optional environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | Server port |
| `JWT_SECRET` | random in dev | Secret for signing tokens (**required** in production) |
| `DATABASE_URL` | none | A `postgres://` URL uses Postgres (e.g. Neon) |
| `DB_PATH` | `data/notevault.db` | SQLite file used when there's no `DATABASE_URL` (`:memory:` for a temporary DB) |

## 📖 API Reference

All endpoints return JSON. Protected routes need `Authorization: Bearer <token>`.

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| POST | `/api/auth/register` | | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | 🔒 | Current user + note stats |
| DELETE | `/api/auth/me` | 🔒 | Delete account and all notes |
| GET | `/api/notes?search=&tag=&limit=&offset=` | 🔒 | List notes (pinned first) |
| GET | `/api/notes/tags` | 🔒 | Tags with counts |
| GET | `/api/notes/:id` | 🔒 | One note |
| POST | `/api/notes` | 🔒 | `{ title, content?, tags?, color?, pinned? }` |
| PUT / PATCH | `/api/notes/:id` | 🔒 | Update any of the fields |
| DELETE | `/api/notes/:id` | 🔒 | Delete a note |

### Example with curl

```bash
# Sign up and save the token
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alex","email":"alex@example.com","password":"secret123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

# Create a note
curl -X POST http://localhost:4000/api/notes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Hello","content":"My first note","tags":["demo"],"color":"yellow"}'

# List notes
curl http://localhost:4000/api/notes -H "Authorization: Bearer $TOKEN"
```

Errors look like this:

```json
{ "error": "Validation failed", "details": { "password": "Password must be at least 8 characters" } }
```

## ☁️ Deploy for free (Vercel + Neon)

1. Click **Deploy with Vercel** above (or import the repo at vercel.com/new) and set `JWT_SECRET` to any long random string.
2. In the Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it. This adds `DATABASE_URL` automatically.
3. **Redeploy**. The tables are created automatically on the first request.

Static files in `public/` are served by Vercel's CDN, and `/api/*` runs as a serverless function (`api/index.js`, routed by `vercel.json`).

## 🗄️ One codebase, two databases

`src/db.js` exposes a tiny `all()` / `get()` interface. Queries are written once with `?` placeholders and converted to `$1, $2…` for Postgres. You get SQLite with zero setup locally, and Postgres in production. The test suite runs against **both** (Postgres via [PGlite](https://pglite.dev), a real Postgres compiled to WebAssembly).

## 📂 Project Structure

```
notes-api/
├── server.js            # Local server, reads env vars
├── api/index.js         # Vercel serverless entry
├── vercel.json          # Routes /api/* to the function
├── src/
│   ├── app.js           # Express app: routes, auth middleware, validation, errors
│   └── db.js            # SQLite / Postgres adapter + schema
├── test/
│   └── api.test.js      # Integration tests on SQLite and Postgres
└── public/              # Frontend (HTML, CSS, JS)
```

## 📚 What I Learned

- Designing a RESTful API with proper status codes (201, 204, 400, 401, 404, 409, 429)
- Hashing passwords with bcrypt and issuing and verifying JWTs
- Writing auth middleware and scoping every query to the current user
- Using prepared SQL statements (safe from SQL injection)
- Testing an API end to end with Node's built-in test runner

## 📄 License

MIT. Free to use and modify.
