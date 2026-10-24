// One small database interface, two engines:
//   • SQLite (Node's built-in node:sqlite) for local development and tests
//   • Postgres (e.g. Neon) in production, chosen when the URL starts with postgres://
// Queries are written once with "?" placeholders and converted for Postgres.

const SCHEMA = {
  sqlite: `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      color      TEXT NOT NULL DEFAULT 'default',
      tags       TEXT NOT NULL DEFAULT '[]',
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, pinned, updated_at);
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      color      TEXT NOT NULL DEFAULT 'default',
      tags       TEXT NOT NULL DEFAULT '[]',
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, pinned, updated_at);
  `,
};

// "SELECT ... WHERE a = ? AND b = ?" -> "SELECT ... WHERE a = $1 AND b = $2"
const toPostgres = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

function wrap(dialect, exec, execScript, close) {
  const db = {
    dialect,
    /** All rows */
    all: (sql, params = []) => exec(sql, params),
    /** First row or undefined */
    get: async (sql, params = []) => (await exec(sql, params))[0],
    close,
  };
  db.ready = execScript(SCHEMA[dialect]).then(() => db);
  return db;
}

async function sqlite(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const raw = new DatabaseSync(path);
  const cache = new Map();
  const statement = (sql) => {
    if (!cache.has(sql)) cache.set(sql, raw.prepare(sql));
    return cache.get(sql);
  };
  return wrap(
    "sqlite",
    async (sql, params) => statement(sql).all(...params),
    async (script) => raw.exec(script),
    async () => raw.close()
  );
}

async function postgres(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  return wrap(
    "postgres",
    async (sql, params) => (await pool.query(toPostgres(sql), params)).rows,
    async (script) => pool.query(script),
    () => pool.end()
  );
}

/** Wrap any client with a pg-style `query(sql, params) -> { rows }` (used for PGlite in tests). */
export function fromPgClient(client) {
  return wrap(
    "postgres",
    async (sql, params) => (await client.query(toPostgres(sql), params)).rows,
    async (script) => client.exec(script),
    () => client.close()
  );
}

/** Opens Postgres for postgres:// URLs, otherwise SQLite at the given path (":memory:" works). */
export async function openDb(url = ":memory:") {
  const db = /^postgres(ql)?:\/\//.test(url) ? await postgres(url) : await sqlite(url);
  return db.ready;
}
