"use strict";

/* Synchronisation avec Supabase (voir supabase/schema.sql).
 *
 * Principe : la base locale (db.js) reste la référence de l'appli, elle marche toujours, réseau ou non.
 * Ce fichier ne fait que recopier dans les deux sens, sans bibliothèque externe (simples requêtes HTTPS) :
 *   - lecture : on demande au serveur ce qui est arrivé depuis la dernière fois (toutes les 10 s appli ouverte,
 *     au retour dans l'appli, au retour du réseau) ;
 *   - envoi   : tout enregistrement modifié ou supprimé ici (_s != 1) part au serveur, peu après chaque saisie.
 * En cas de désaccord, la modification la plus récente gagne (le serveur ignore une modification plus ancienne).
 *
 * L'URL et la clé « publishable » ci-dessous sont publiques par conception : la protection vient de la connexion
 * (compte unique) et des règles d'accès de la base, pas du secret de cette clé.
 */
const Sync = (() => {
  const BASE = "https://thkscwqpyqpxbhrinfho.supabase.co";
  const KEY = "sb_publishable_LWhjro6_Plitr4oi42y1zA_z20kutfl";
  const SESSION_KEY = "caisse-sync-session";
  const POLL_MS = 10000;
  const OVERLAP_MS = 10000;          // on relit un peu en arrière : un enregistrement arrivé « en même temps » n'est jamais manqué
  const PAGE = 500;

  let session = readSession();
  let state = "off";                 // off | login | idle | syncing | offline | error
  let lastOk = 0;
  let message = "";
  let busy = false, again = false, started = false;
  let timer = null, debounce = null;

  function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
  function writeSession(s) {
    session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignoré */ }
  }
  function setState(s, msg = "") {
    state = s; message = msg;
    if (s === "idle") lastOk = Date.now();
    if (api.onStatus) api.onStatus();
  }

  /* ----- Connexion ----- */
  class SyncError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }   // kind : "auth" | "http"

  async function tokenCall(grant, body) {
    const r = await fetch(`${BASE}/auth/v1/token?grant_type=${grant}`, {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new SyncError(j.error_description || j.msg || `Erreur ${r.status}`, r.status === 400 || r.status === 401 ? "auth" : "http");
    return {
      access: j.access_token, refresh: j.refresh_token,
      exp: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      email: (j.user && j.user.email) || (session && session.email) || "",
    };
  }

  async function signIn(email, password) {
    writeSession(await tokenCall("password", { email, password }));
    await cycle();
  }

  async function signOut() {
    const s = session;
    writeSession(null);
    setState("login");
    if (s) fetch(`${BASE}/auth/v1/logout`, { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + s.access } }).catch(() => {});
  }

  /* Renouvellement du jeton. Le verrou évite que deux fenêtres le renouvellent en même temps. */
  const locked = (name, fn, opts) => (navigator.locks ? navigator.locks.request(name, opts || {}, fn) : fn(true));
  function refresh() {
    return locked("caisse-refresh", async () => {
      const stored = readSession();
      if (stored && session && stored.refresh !== session.refresh) { session = stored; return; }   // une autre fenêtre l'a déjà fait
      if (!session) throw new SyncError("Non connecté", "auth");
      try { writeSession(await tokenCall("refresh_token", { refresh_token: session.refresh })); }
      catch (e) { if (e.kind === "auth") { writeSession(null); } throw e; }
    });
  }

  async function request(path, { method = "GET", headers = {}, body } = {}) {
    if (!session) throw new SyncError("Non connecté", "auth");
    if (session.exp - Date.now() < 60000) await refresh();
    const go = () => fetch(BASE + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: KEY, Authorization: "Bearer " + session.access, "Content-Type": "application/json", ...headers },
    });
    let r = await go();
    if (r.status === 401) { await refresh(); r = await go(); }
    if (!r.ok) throw new SyncError(`Serveur : ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`, r.status === 401 ? "auth" : "http");
    return method === "GET" ? r.json() : null;
  }

  /* ----- Lecture : ce qui est arrivé sur le serveur depuis la dernière fois ----- */
  async function pull() {
    const cursor = await DB.getMeta("sync-cursor");
    const first = !cursor;                         // 1re synchro de cet appareil : le catalogue du serveur l'emporte sur celui par défaut
    let from = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
    let newest = cursor, changed = 0;
    for (;;) {
      let q = `/rest/v1/records?select=store,id,data,u,d,updated_at&order=updated_at.asc&limit=${PAGE}`;
      if (from) q += "&updated_at=gt." + encodeURIComponent(from);
      const rows = await request(q);
      if (!rows.length) break;
      changed += await DB.applyRemote(rows, first ? ["products", "settings"] : null);
      newest = from = rows[rows.length - 1].updated_at;
      if (rows.length < PAGE) break;
    }
    if (newest !== cursor) await DB.setMeta("sync-cursor", newest);
    return changed;
  }

  /* ----- Envoi : ce qui a été modifié ou supprimé ici ----- */
  async function push() {
    for (;;) {
      const batch = await DB.dirty(200);
      if (!batch.length) return;
      const body = batch.map(({ store, rec }) => {
        const { _u, _d, _s, ...data } = rec;
        return { store, id: rec.id, data: _d ? null : data, u: _u, d: _d || null };
      });
      await request("/rest/v1/records?on_conflict=store,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body });
      await DB.markSynced(batch);
      if (batch.length < 200) return;
    }
  }

  /* ----- Un tour de synchronisation ----- */
  async function cycle() {
    if (!DB.available) return;
    if (!session) { setState("login"); return; }
    if (busy) { again = true; return; }
    busy = true;
    try {
      await locked("caisse-sync", async (got) => {
        if (!got) return;                          // une autre fenêtre synchronise déjà
        if (state !== "idle") setState("syncing");        // en régime normal, pas de clignotement toutes les 10 s
        const changed = await pull();
        await push();
        setState("idle");
        if (changed && api.onRemoteChange) api.onRemoteChange();
      }, { ifAvailable: true });
    } catch (e) {
      if (e.kind === "auth") setState("login", "Connexion expirée : reconnectez-vous");
      else if (e instanceof TypeError || (navigator.onLine === false)) setState("offline");   // pas de réseau
      else setState("error", e.message);
    } finally {
      busy = false;
      if (again) { again = false; later(1500); }
    }
  }

  function later(ms) { clearTimeout(debounce); debounce = setTimeout(cycle, ms); }

  function start() {
    if (started || !DB.available) { if (!DB.available) setState("off"); return; }
    started = true;
    if (!session) setState("login"); else setState("idle");
    DB.onLocalChange = () => { if (session) later(800); };
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === "visible") cycle(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cycle(); });
    window.addEventListener("online", cycle);
    window.addEventListener("offline", () => { if (session) setState("offline"); });
    cycle();
  }

  const api = {
    start, signIn, signOut, now: cycle,
    info: () => ({ state, message, lastOk, email: session ? session.email : "" }),
    onStatus: null,           // appelé quand l'état change
    onRemoteChange: null,     // appelé quand la synchro a modifié des données locales
  };
  return api;
})();
