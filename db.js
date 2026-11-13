"use strict";

/* Couche de stockage : IndexedDB, un enregistrement par vente / dépense / commande / produit.
 *
 * Pourquoi : préparer le partage entre appareils (synchronisation). Chaque enregistrement porte
 *   _u : date de dernière modification (ms) ;
 *   _d : date de suppression (ms) ou null. Une suppression laisse une « pierre tombale » (id seul, sans donnée)
 *        pour que la synchro puisse la propager à l'autre appareil.
 *
 * Principe : app.js continue de manipuler un objet `state` en mémoire (même forme qu'avant) ; à chaque save(),
 * DB.commit(state) compare avec ce qui est déjà enregistré et n'écrit QUE les enregistrements modifiés ou supprimés.
 * Deux fenêtres ouvertes en même temps ne s'écrasent donc plus l'une l'autre.
 *
 * Démarrage : ce fichier ouvre la base puis charge app.js (qui a besoin des données dès son démarrage).
 */
const DB = (() => {
  const NAME = "caisse-db", VERSION = 1;
  const STORES = ["products", "sales", "expenses", "orders", "settings"];
  let db = null;
  let snap = {};                    // état connu de la base : store -> Map(id -> { json, rec })
  let inited = false;               // la base a déjà reçu ses premières données (sinon : migration depuis localStorage)
  let chain = Promise.resolve();    // les écritures se font l'une après l'autre
  let channel = null;

  const wrap = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const done = (tx) => new Promise((ok, ko) => { tx.oncomplete = () => ok(); tx.onerror = tx.onabort = () => ko(tx.error); });

  function open() {
    return new Promise((ok) => {
      if (!window.indexedDB) { ok(false); return; }
      let r;
      try { r = indexedDB.open(NAME, VERSION); } catch (e) { ok(false); return; }
      r.onupgradeneeded = () => {
        [...STORES, "meta"].forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: "id" }); });
      };
      r.onsuccess = async () => {
        db = r.result;
        db.onversionchange = () => db.close();
        try {
          inited = !!(await wrap(db.transaction("meta").objectStore("meta").get("init")));
          if (typeof BroadcastChannel !== "undefined") {
            channel = new BroadcastChannel("caisse-db");
            channel.onmessage = () => { if (api.onExternalChange) api.onExternalChange(); };
          }
          ok(true);
        } catch (e) { db = null; ok(false); }
      };
      r.onerror = r.onblocked = () => ok(false);
    });
  }

  /* L'objet state -> enregistrements à plat. L'ordre des produits est conservé dans `pos`. */
  function flatten(st) {
    const lists = {
      products: st.products.map((p, i) => ({ ...p, pos: i })),
      sales: st.sales,
      expenses: st.expenses,
      orders: st.orders,
      settings: [{ id: "cookiePricing", value: st.cookiePricing }, { id: "catalogRev", value: st.catalogRev || 0 }],
    };
    const out = {};
    STORES.forEach((s) => { out[s] = new Map(lists[s].map((rec) => [rec.id, { json: JSON.stringify(rec), rec }])); });
    return out;
  }

  const clean = (rec) => { const { _u, _d, pos, ...data } = rec; return data; };

  /* Lit toute la base et reconstruit un `state`. Renvoie null si la base est vide (première ouverture). */
  async function load() {
    if (!db || !inited) return null;
    const tx = db.transaction(STORES, "readonly");
    const all = {};
    await Promise.all(STORES.map(async (s) => { all[s] = (await wrap(tx.objectStore(s).getAll())).filter((r) => !r._d); }));
    const setting = (id) => { const r = all.settings.find((x) => x.id === id); return r ? r.value : undefined; };
    const st = {
      products: all.products.sort((a, b) => a.pos - b.pos).map(clean),
      sales: all.sales.map(clean),
      expenses: all.expenses.map(clean),
      orders: all.orders.map(clean),
      cookiePricing: setting("cookiePricing"),
      catalogRev: setting("catalogRev") || 0,
    };
    snap = flatten(st);
    return st;
  }

  /* Compare `st` avec la base et enregistre les différences. Appel immédiat ; l'écriture se termine juste après. */
  function commit(st) {
    if (!db) return Promise.resolve();
    const cur = flatten(st);
    const now = Date.now();
    const ops = [];
    STORES.forEach((s) => {
      const old = snap[s] || new Map();
      cur[s].forEach((v, id) => { if (!old.has(id) || old.get(id).json !== v.json) ops.push([s, { ...v.rec, _u: now, _d: null }]); });
      old.forEach((v, id) => { if (!cur[s].has(id)) ops.push([s, { id, _u: now, _d: now }]); });
    });
    snap = cur;
    if (!inited) { ops.push(["meta", { id: "init", _u: now }]); inited = true; }
    if (!ops.length) return Promise.resolve();
    chain = chain.then(async () => {
      const tx = db.transaction([...new Set(ops.map((o) => o[0]))], "readwrite");
      ops.forEach(([s, rec]) => tx.objectStore(s).put(rec));
      await done(tx);
      if (channel) channel.postMessage("changed");
    }).catch((e) => { if (api.onError) api.onError(e); });
    return chain;
  }

  const api = {
    available: false,
    open: async () => { api.available = await open(); return api.available; },
    load, commit,
    onError: null,            // appelé si une écriture échoue
    onExternalChange: null,   // appelé quand une autre fenêtre a modifié la base
  };
  return api;
})();

/* Ouvre la base, puis démarre l'appli (même si la base est indisponible : app.js bascule alors sur localStorage). */
DB.open().then(async () => {
  window.__initialState = null;
  try { window.__initialState = await DB.load(); } catch (e) { /* base illisible : app.js repart de l'ancien stockage */ }
}).finally(() => {
  const s = document.createElement("script");
  s.src = "app.js";
  document.body.appendChild(s);
});
