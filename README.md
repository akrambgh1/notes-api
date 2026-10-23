# 🗒️ NoteVault — REST API + JWT Auth

NoteVault is a full-stack notes app built around a clean, tested **REST API**. Users sign up and log in with **JWT authentication**, then create, search, tag, color and pin their notes. Each user can only ever see their own data.

**Backend:** Node.js, Express, SQLite (Node's built-in `node:sqlite`), bcrypt, JSON Web Tokens
**Frontend:** vanilla JavaScript, HTML and CSS (no framework)
**Tests:** 9 integration tests with the built-in `node:test` runner

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
| `DB_PATH` | `data/notevault.db` | SQLite file location (`:memory:` for a temporary DB) |

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

## ☁️ Deploy for free (Render)

1. Create a free account at [render.com](https://render.com) and connect your GitHub.
2. Choose **New → Blueprint** and pick this repository. `render.yaml` sets Node 22, production mode and a random `JWT_SECRET` for you.
3. The free plan has no persistent disk, so the database resets on each redeploy. For permanent data, attach a disk (paid) or switch to a hosted database.

## 📂 Project Structure

```
notes-api/
├── server.js            # Starts the server, reads env vars
├── src/
│   ├── app.js           # Express app: routes, auth middleware, validation, errors
│   └── db.js            # SQLite schema
├── test/
│   └── api.test.js      # Integration tests (node:test + fetch)
├── public/              # Frontend (HTML, CSS, JS)
└── render.yaml          # Free hosting config
```

## 📚 What I Learned

- Designing a RESTful API with proper status codes (201, 204, 400, 401, 404, 409, 429)
- Hashing passwords with bcrypt and issuing and verifying JWTs
- Writing auth middleware and scoping every query to the current user
- Using prepared SQL statements (safe from SQL injection)
- Testing an API end to end with Node's built-in test runner

## 📄 License

MIT. Free to use and modify.
