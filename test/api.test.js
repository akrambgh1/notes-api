import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.js";
import { fromPgClient, openDb } from "../src/db.js";

// The same tests run twice: on SQLite (local dev) and on Postgres (production), using PGlite
const ENGINES = {
  sqlite: () => openDb(":memory:"),
  postgres: () => fromPgClient(new PGlite()).ready,
};

for (const [engine, makeDb] of Object.entries(ENGINES)) {
  describe(`NoteVault API on ${engine}`, () => {
    let server;
    let base;

    before(async () => {
      const app = createApp({ database: await makeDb(), jwtSecret: "test-secret" });
      await new Promise((resolve) => {
        server = app.listen(0, resolve);
      });
      base = `http://127.0.0.1:${server.address().port}/api`;
    });

    after(() => server.close());

    async function api(path, { method = "GET", body, token } = {}) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body && { "Content-Type": "application/json" }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body && JSON.stringify(body),
      });
      const data = res.status === 204 ? null : await res.json();
      return { status: res.status, data };
    }

    const alice = { name: "Alice", email: "alice@example.com", password: "secret123" };
    const bob = { name: "Bob", email: "bob@example.com", password: "hunter22" };

    describe("auth", () => {
      test("rejects weak or invalid sign-ups", async () => {
        const { status, data } = await api("/auth/register", { method: "POST", body: { name: "A", email: "nope", password: "short" } });
        assert.equal(status, 400);
        assert.ok(data.details.name && data.details.email && data.details.password);
      });

      test("registers, blocks duplicates and logs in", async () => {
        const reg = await api("/auth/register", { method: "POST", body: alice });
        assert.equal(reg.status, 201);
        assert.equal(reg.data.user.email, alice.email);
        assert.ok(reg.data.token);
        assert.equal(reg.data.user.password_hash, undefined, "never leak the hash");

        const dup = await api("/auth/register", { method: "POST", body: { ...alice, email: "ALICE@example.com" } });
        assert.equal(dup.status, 409);

        const bad = await api("/auth/login", { method: "POST", body: { email: alice.email, password: "wrong-pass1" } });
        assert.equal(bad.status, 401);

        const ok = await api("/auth/login", { method: "POST", body: { email: alice.email, password: alice.password } });
        assert.equal(ok.status, 200);

        const me = await api("/auth/me", { token: ok.data.token });
        assert.equal(me.data.user.name, "Alice");
      });

      test("protects routes", async () => {
        assert.equal((await api("/notes")).status, 401);
        assert.equal((await api("/notes", { token: "not-a-real-token" })).status, 401);
      });
    });

    describe("notes", () => {
      let aliceToken;
      let bobToken;
      let noteId;

      before(async () => {
        aliceToken = (await api("/auth/login", { method: "POST", body: { email: alice.email, password: alice.password } })).data.token;
        bobToken = (await api("/auth/register", { method: "POST", body: bob })).data.token;
      });

      test("creates and validates notes", async () => {
        const empty = await api("/notes", { method: "POST", token: aliceToken, body: { title: "  " } });
        assert.equal(empty.status, 400);

        const res = await api("/notes", {
          method: "POST",
          token: aliceToken,
          body: { title: "Groceries", content: "Milk, eggs", tags: ["Home", "home", "todo"], color: "yellow" },
        });
        assert.equal(res.status, 201);
        assert.deepEqual(res.data.note.tags, ["home", "todo"]);
        noteId = res.data.note.id;
      });

      test("lists, searches and filters by tag", async () => {
        await api("/notes", { method: "POST", token: aliceToken, body: { title: "Ideas", content: "Build a portfolio", tags: ["work"] } });
        const all = await api("/notes", { token: aliceToken });
        assert.equal(all.data.total, 2);
        assert.equal((await api("/notes?search=portfolio", { token: aliceToken })).data.total, 1);
        assert.equal((await api("/notes?tag=home", { token: aliceToken })).data.notes[0].title, "Groceries");
        const tags = await api("/notes/tags", { token: aliceToken });
        assert.ok(tags.data.tags.some((t) => t.name === "work"));
      });

      test("updates and pins", async () => {
        const res = await api(`/notes/${noteId}`, { method: "PATCH", token: aliceToken, body: { pinned: true, title: "Groceries 🛒" } });
        assert.equal(res.status, 200);
        assert.equal(res.data.note.pinned, true);
        assert.equal(res.data.note.content, "Milk, eggs", "fields that are not sent stay the same");
        const list = await api("/notes", { token: aliceToken });
        assert.equal(list.data.notes[0].id, noteId, "pinned notes come first");
      });

      test("users cannot see or change each other's notes", async () => {
        assert.equal((await api(`/notes/${noteId}`, { token: bobToken })).status, 404);
        assert.equal((await api(`/notes/${noteId}`, { method: "DELETE", token: bobToken })).status, 404);
        assert.equal((await api("/notes", { token: bobToken })).data.total, 0);
      });

      test("deletes", async () => {
        assert.equal((await api(`/notes/${noteId}`, { method: "DELETE", token: aliceToken })).status, 204);
        assert.equal((await api(`/notes/${noteId}`, { token: aliceToken })).status, 404);
      });

      test("returns JSON errors for bad input", async () => {
        const res = await fetch(`${base}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${aliceToken}` },
          body: "{bad json",
        });
        assert.equal(res.status, 400);
        assert.match((await res.json()).error, /valid JSON/);
        assert.equal((await api("/nope", { token: aliceToken })).status, 404);
      });
    });
  });
}
