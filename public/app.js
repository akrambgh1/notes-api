// NoteVault frontend: talks to the REST API with fetch + a JWT Bearer token
const $ = (id) => document.getElementById(id);
const COLORS = ["default", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
const TOKEN_KEY = "notevault:token";

const state = { token: null, user: null, notes: [], tags: [], tag: "", search: "", mode: "login", editing: null };

// ---------- API client ----------
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      ...(state.token && { Authorization: `Bearer ${state.token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    logout("Your session has expired. Please log in again.");
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? "Request failed");
    err.details = data?.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- tiny DOM helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

const parseTags = (text) => text.split(",").map((t) => t.trim()).filter(Boolean);
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// ---------- auth view ----------
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.mode === mode;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active);
  });
  $("nameField").hidden = mode !== "register";
  $("authSubmit").textContent = mode === "register" ? "Create account" : "Log in";
  $("authForm").password.autocomplete = mode === "register" ? "new-password" : "current-password";
  clearAuthErrors();
}

function clearAuthErrors() {
  document.querySelectorAll(".field-error").forEach((e) => (e.textContent = ""));
  $("authError").hidden = true;
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthErrors();
  const form = e.target;
  const body = { email: form.email.value, password: form.password.value };
  if (state.mode === "register") body.name = form.name.value;
  const submit = $("authSubmit");
  submit.disabled = true;
  try {
    const data = await api(`/auth/${state.mode}`, { method: "POST", body });
    login(data.token, data.user);
    form.reset();
  } catch (err) {
    if (err.details) {
      for (const [field, msg] of Object.entries(err.details)) {
        const slot = document.querySelector(`.field-error[data-for="${field}"]`);
        if (slot) slot.textContent = msg;
      }
    }
    if (!err.details || err.status !== 400) {
      $("authError").textContent = err.message;
      $("authError").hidden = false;
    }
  } finally {
    submit.disabled = false;
  }
});

function login(token, user) {
  state.token = token;
  state.user = user;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  showApp();
}

function logout(message) {
  state.token = null;
  state.user = null;
  state.notes = [];
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  $("appView").hidden = true;
  $("authView").hidden = false;
  $("userMenu").hidden = true;
  if (message) {
    $("authError").textContent = message;
    $("authError").hidden = false;
  }
}

// ---------- app view ----------
async function showApp() {
  $("authView").hidden = true;
  $("appView").hidden = false;
  const name = state.user.name;
  $("userName").textContent = name;
  $("userInitial").textContent = name[0].toUpperCase();
  $("menuName").textContent = name;
  $("menuEmail").textContent = state.user.email;
  await loadNotes();
}

async function loadNotes() {
  const params = new URLSearchParams({ limit: "100" });
  if (state.search) params.set("search", state.search);
  if (state.tag) params.set("tag", state.tag);
  try {
    const [list, tags] = await Promise.all([api(`/notes?${params}`), api("/notes/tags")]);
    state.notes = list.notes;
    state.tags = tags.tags;
    $("status").textContent = state.search || state.tag ? `${list.total} matching note${list.total === 1 ? "" : "s"}` : "";
    render();
  } catch (err) {
    if (state.token) $("status").textContent = `⚠️ ${err.message}`;
  }
}

function noteCard(note) {
  const card = el("article", `note color-${note.color}`);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Edit note ${note.title}`);

  const pin = el("button", `pin ${note.pinned ? "on" : ""}`, "📌");
  pin.title = note.pinned ? "Unpin" : "Pin";
  pin.setAttribute("aria-label", note.pinned ? "Unpin note" : "Pin note");
  pin.addEventListener("click", async (e) => {
    e.stopPropagation();
    await api(`/notes/${note.id}`, { method: "PATCH", body: { pinned: !note.pinned } });
    loadNotes();
  });

  card.append(pin, el("h3", "note-title", note.title));
  if (note.content) card.append(el("p", "note-content", note.content));
  if (note.tags.length) {
    const tags = el("div", "note-tags");
    note.tags.forEach((t) => tags.append(el("span", "note-tag", `#${t}`)));
    card.append(tags);
  }
  card.append(el("span", "note-time", ago(note.updatedAt)));

  const open = () => openEditor(note);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => e.key === "Enter" && open());
  return card;
}

function render() {
  const pinned = state.notes.filter((n) => n.pinned);
  const others = state.notes.filter((n) => !n.pinned);
  $("pinnedGrid").replaceChildren(...pinned.map(noteCard));
  $("notesGrid").replaceChildren(...others.map(noteCard));
  $("pinnedSection").hidden = !pinned.length;
  $("othersTitle").hidden = !pinned.length || !others.length;
  $("empty").hidden = state.notes.length > 0 || Boolean(state.search || state.tag);

  const bar = $("tagBar");
  bar.replaceChildren();
  if (state.tags.length) {
    const all = el("button", `chip ${state.tag ? "" : "active"}`, "All");
    all.addEventListener("click", () => { state.tag = ""; loadNotes(); });
    bar.append(all);
    for (const t of state.tags) {
      const chip = el("button", `chip ${state.tag === t.name ? "active" : ""}`, `#${t.name} · ${t.count}`);
      chip.addEventListener("click", () => { state.tag = state.tag === t.name ? "" : t.name; loadNotes(); });
      bar.append(chip);
    }
  }
}

// ---------- quick add ----------
const expandQuick = (open) => {
  $("quickContent").hidden = !open;
  $("quickActions").hidden = !open;
};
$("quickTitle").addEventListener("focus", () => expandQuick(true));
$("quickCancel").addEventListener("click", () => { $("quickForm").reset(); expandQuick(false); });

$("quickForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("quickTitle").value.trim();
  if (!title) return $("quickTitle").focus();
  try {
    await api("/notes", { method: "POST", body: { title, content: $("quickContent").value, tags: parseTags($("quickTags").value) } });
    $("quickForm").reset();
    expandQuick(false);
    toast("Note added");
    loadNotes();
  } catch (err) {
    toast(err.details ? Object.values(err.details).join(", ") : err.message);
  }
});

// ---------- editor dialog ----------
const dialog = $("editDialog");
let pickedColor = "default";

for (const c of COLORS) {
  const b = el("button", `swatch color-${c}`);
  b.type = "button";
  b.dataset.color = c;
  b.setAttribute("aria-label", `${c} color`);
  b.addEventListener("click", () => selectColor(c));
  $("editColors").append(b);
}

function selectColor(c) {
  pickedColor = c;
  document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.color === c));
  dialog.className = `dialog color-${c}`;
}

function openEditor(note) {
  state.editing = note;
  $("editTitle").value = note.title;
  $("editContent").value = note.content;
  $("editTags").value = note.tags.join(", ");
  $("editMeta").textContent = `Edited ${ago(note.updatedAt)}`;
  $("editError").hidden = true;
  selectColor(note.color);
  dialog.showModal();
}

$("editCancel").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

$("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api(`/notes/${state.editing.id}`, {
      method: "PUT",
      body: { title: $("editTitle").value, content: $("editContent").value, tags: parseTags($("editTags").value), color: pickedColor },
    });
    dialog.close();
    loadNotes();
  } catch (err) {
    $("editError").textContent = err.details ? Object.values(err.details).join(", ") : err.message;
    $("editError").hidden = false;
  }
});

$("editDelete").addEventListener("click", async () => {
  if (!confirm(`Delete "${state.editing.title}"?`)) return;
  await api(`/notes/${state.editing.id}`, { method: "DELETE" });
  dialog.close();
  toast("Note deleted");
  loadNotes();
});

// ---------- search & user menu ----------
let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = e.target.value.trim(); loadNotes(); }, 300);
});

$("userBtn").addEventListener("click", async () => {
  const menu = $("userMenu");
  menu.hidden = !menu.hidden;
  $("userBtn").setAttribute("aria-expanded", String(!menu.hidden));
  if (!menu.hidden) {
    const me = await api("/auth/me");
    $("menuStats").textContent = `${me.stats.total} notes · ${me.stats.pinned} pinned`;
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".user-menu")) $("userMenu").hidden = true;
});
$("logoutBtn").addEventListener("click", () => logout());
$("deleteAccountBtn").addEventListener("click", async () => {
  if (!confirm("Delete your account and all your notes? This cannot be undone.")) return;
  await api("/auth/me", { method: "DELETE" });
  logout("Your account was deleted.");
});

// ---------- start ----------
(async function start() {
  let saved = null;
  try { saved = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
  if (saved) {
    state.token = saved;
    try {
      const me = await api("/auth/me");
      state.user = me.user;
      return showApp();
    } catch {
      state.token = null;
    }
  }
  $("authView").hidden = false;
  setMode("login");
})();
