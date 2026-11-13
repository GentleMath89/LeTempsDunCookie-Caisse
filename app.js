"use strict";

const STORAGE_KEY = "caisse-marche-v1";
const DATA_VERSION = 2;
const PAY_MODES = ["Espèces", "CB", "PayPal", "Wero"];
const DEFAULT_PAY = "Espèces";
const SOLD_OUT = "Épuisé";          // mention affichée pour un produit inactif (libellé par défaut)

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Données ---------- */
const COOKIE_VARIANTS = [
  "Le Pécan", "Le Trois Chocolats", "Le Cacahuète", "Le Pistache", "Le Spéculoos",
  "Le Rico", "Le Marshall", "Le Noisette", "L'Edition Limitée",
];
const DEFAULT_OTHERS = [
  { id: "p4", name: "Sachet de chocolats", price: 800 },
  { id: "p5", name: "Coffret petit format", price: 1000 },
  { id: "p6", name: "Coffret grand format", price: 2000 },
  { id: "p7", name: "Thé", price: 100 },
  { id: "p8", name: "Café", price: 100 },
];
// Prix TOTAL pour 1 à 8 cookies, puis prix de chaque cookie supplémentaire à partir du 9e.
const DEFAULT_PRICING = { totals: [300, 600, 900, 1100, 1400, 1700, 2000, 2000], extra: 250 };

const isCookie = (p) => p.family === "cookie";
const CATALOG_REV = 2;     // 1 = Thé et Café ajoutés · 2 = Spéculoos et coffrets renommés
const RENAMES = [          // anciens noms par défaut → nouveaux (uniquement si le produit porte encore son ancien nom)
  { id: "v5", from: "Le Speculoos", to: "Le Spéculoos" },
  { id: "p5", from: "Pack cadeau M", to: "Coffret petit format" },
  { id: "p6", from: "Pack cadeau L", to: "Coffret grand format" },
];
const freshState = () => ({
  version: DATA_VERSION,
  catalogRev: CATALOG_REV,
  products: [
    ...COOKIE_VARIANTS.map((name, i) => ({ id: "v" + (i + 1), name, price: null, family: "cookie", active: true })),
    ...DEFAULT_OTHERS.map((p) => ({ ...p, family: null, active: true })),
  ],
  sales: [],
  expenses: [],
  orders: [],
  cookiePricing: { totals: [...DEFAULT_PRICING.totals], extra: DEFAULT_PRICING.extra },
});

/* Évolutions du catalogue par défaut, appliquées UNE seule fois par jeu de données (catalogRev) :
 * - rev 1 : ajout de « Thé » et « Café » (pas de doublon si le nom existe déjà ; supprimés ensuite, ils ne reviennent pas) ;
 * - rev 2 : renommages (Spéculoos, coffrets), seulement si le produit porte encore son ancien nom ;
 *   les ventes et commandes déjà enregistrées reprennent alors le nouveau nom, pour ne pas scinder les totaux de l'Historique. */
function ensureCatalog(st) {
  const rev = st.catalogRev || 0;
  if (rev >= CATALOG_REV) return false;
  if (rev < 1) {
    DEFAULT_OTHERS.filter((a) => ["p7", "p8"].includes(a.id)).forEach((a) => {
      if (st.products.some((p) => p.name.trim().toLowerCase() === a.name.toLowerCase())) return;
      const id = st.products.some((p) => p.id === a.id) ? a.id + Date.now().toString(36) : a.id;
      st.products.push({ id, name: a.name, price: a.price, family: null, active: true });
    });
  }
  if (rev < 2) {
    RENAMES.forEach((r) => {
      const p = st.products.find((x) => x.id === r.id && x.name === r.from);
      if (!p) return;
      p.name = r.to;
      const fix = (arr) => (arr || []).forEach((i) => { if (i.name === r.from) i.name = r.to; });
      (st.sales || []).forEach((s) => fix(s.items));
      (st.orders || []).forEach((o) => fix(o.lines));
    });
  }
  st.catalogRev = CATALOG_REV;
  return true;
}

/* Anciennes données (v1 : produits « 1 / 4 / 8 cookies ») → v2 */
function migrate(s) {
  const kept = s.products.filter((p) => !(["p1", "p2", "p3"].includes(p.id) && /cookies?$/i.test(p.name)));
  const fresh = freshState();
  const m = {
    version: DATA_VERSION,
    products: [
      ...fresh.products.filter(isCookie),
      ...kept.map((p) => ({ family: null, ...p, active: p.active !== false })),
    ],
    sales: s.sales,
    expenses: s.expenses || [],
    orders: s.orders || [],
    cookiePricing: fresh.cookiePricing,
  };
  ensureCatalog(m);
  return m;
}

let state = load();
let cart = [];            // { key, name, price, qty, family }
let pay = DEFAULT_PAY;
let histoAll = false;
let cookiesOpen = true;
try { cookiesOpen = localStorage.getItem("caisse-cookies-open") !== "0"; } catch (e) { /* ignoré */ }
let editingSaleId = null;

/* Les données viennent d'IndexedDB (voir db.js). Première ouverture après la mise à jour : on reprend l'ancien
 * contenu de localStorage (il y reste comme copie de secours) et on le copie dans IndexedDB.
 * Si IndexedDB est indisponible, on continue comme avant avec localStorage seul. */
function load() {
  const s = window.__initialState;
  if (DB.available && s && Array.isArray(s.products) && s.cookiePricing) {
    s.version = DATA_VERSION;
    if (ensureCatalog(s)) DB.commit(s);
    return s;
  }
  const st = loadLegacy();
  if (DB.available) DB.commit(st);
  return st;
}
function loadLegacy() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.products) && Array.isArray(s.sales)) {
        if (s.version !== DATA_VERSION || !s.cookiePricing) { const m = migrate(s); persist(m); return m; }
        if (!Array.isArray(s.expenses)) s.expenses = [];      // données créées avant l'onglet Dépenses
        if (!Array.isArray(s.orders)) s.orders = [];          // données créées avant l'onglet Commandes
        if (ensureCatalog(s)) persist(s);                     // Thé et Café, une seule fois
        return s;
      }
    }
  } catch (e) { /* stockage indisponible : on repart du catalogue par défaut */ }
  return freshState();
}
function persist(st) { if (!DB.available) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(st)); } catch (e) { /* ignoré */ } } }
function save() {
  if (DB.available) { DB.commit(state); return; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast("⚠ Enregistrement impossible"); }
}
DB.onError = () => toast("⚠ Enregistrement impossible");
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

/* ---------- Utilitaires ---------- */
/* Formatteurs créés une seule fois (en créer un par appel est coûteux sur de longues listes) */
const EUR_FMT = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const DAY_FMT = new Intl.DateTimeFormat("sv-SE");                                   // AAAA-MM-JJ (heure locale)
const TIME_FMT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const DATE_FR = new Intl.DateTimeFormat("fr-FR");
const eur = (c) => EUR_FMT.format(c / 100);
const csvNum = (c) => (c / 100).toFixed(2).replace(".", ",");
function parsePrice(str) {
  const n = parseFloat(String(str).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
/* Montant pouvant être négatif (réduction) : accepte « -2,5 » ou « −2,5 » */
function parseSigned(str) {
  const n = parseFloat(String(str).trim().replace(/\s/g, "").replace("−", "-").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const dayKey = (ts) => DAY_FMT.format(ts);
const timeStr = (ts) => TIME_FMT.format(ts);
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  // popover : s'affiche au-dessus des fenêtres ouvertes (les messages de validation y restaient invisibles)
  try { if (t.matches(":popover-open")) t.hidePopover(); t.showPopover(); } catch (e) { /* navigateur sans popover : affichage normal */ }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { try { t.hidePopover(); } catch (e) { t.textContent = ""; } }, 1800);
}

/* Prix total de n cookies selon la grille du catalogue */
function cookiePrice(n, pricing = state.cookiePricing) {
  if (n <= 0) return 0;
  const t = pricing.totals;
  if (n <= t.length) return t[n - 1];
  return t[t.length - 1] + pricing.extra * (n - t.length);
}

/* Confirmation intégrée (confirm() est bloqué dans certains navigateurs) */
function askConfirm(msg) {
  return new Promise((resolve) => {
    const d = $("dlg-confirm");
    $("confirm-msg").textContent = msg;
    const done = (v) => { d.close(); $("confirm-yes").onclick = $("confirm-no").onclick = null; resolve(v); };
    $("confirm-yes").onclick = () => done(true);
    $("confirm-no").onclick = () => done(false);
    d.addEventListener("cancel", () => done(false), { once: true });
    d.showModal();
  });
}

/* ---------- Onglets ---------- */
function showTab(name) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["vente", "commandes", "histo", "depenses", "catalogue"].forEach((t) => ($("tab-" + t).hidden = t !== name));
  $("checkout").hidden = name !== "vente";
  if (name === "vente") renderAll();
  if (name === "commandes") renderOrders();
  if (name === "histo") renderHisto();
  if (name === "depenses") renderExpenses();
  renderBackupBar();
  if (name === "catalogue") renderCatalogue();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------- Vente ---------- */
const cookieQty = () => cart.filter((l) => l.family === "cookie").reduce((s, l) => s + l.qty, 0);
const cartTotal = () =>
  cookiePrice(cookieQty()) + cart.filter((l) => l.family !== "cookie").reduce((s, l) => s + l.price * l.qty, 0);

function productRow(p) {
  const line = cart.find((l) => l.key === p.id);
  const b = document.createElement("div");
  const noPrice = !isCookie(p) && p.price == null;
  b.className = "prow" + (p.active ? "" : " off") + (noPrice ? " noprice" : "");
  b.setAttribute("role", "button");
  b.innerHTML = `<span class="pn">${esc(p.name)}</span>` +
    `<span class="pp">${!p.active ? SOLD_OUT : isCookie(p) ? "" : p.price == null ? "prix à définir" : eur(p.price)}</span>` +
    (line ? `<button class="minus" aria-label="Retirer un">−</button>` : "") +
    `<span class="badge${line ? "" : " zero"}">${line ? line.qty : ""}</span>`;
  b.addEventListener("click", () => addProduct(p));
  const minus = b.querySelector(".minus");
  if (minus) minus.addEventListener("click", (e) => {
    e.stopPropagation();
    line.qty--;
    if (line.qty <= 0) cart = cart.filter((x) => x !== line);
    renderAll();
  });
  return b;
}

function renderGrid() {
  const g = $("grid");
  g.innerHTML = "";
  // Les produits inactifs (épuisés) descendent en bas de leur rubrique, l'ordre du catalogue étant conservé dans chaque groupe
  const activeFirst = (list) => [...list.filter((p) => p.active), ...list.filter((p) => !p.active)];
  const cookies = activeFirst(state.products.filter(isCookie));
  const others = activeFirst(state.products.filter((p) => !isCookie(p)));

  if (cookies.length) {
    const n = cookieQty();
    const h = document.createElement("div");
    h.className = "sec";
    let info = "";
    if (n > 0) {
      info = `${n} cookie${n > 1 ? "s" : ""} · ${eur(cookiePrice(n))}`;
      if (cookiePrice(n + 1) === cookiePrice(n)) info += " (le suivant est au même prix)";
    }
    h.classList.add("toggle");
    h.setAttribute("role", "button");
    h.setAttribute("aria-expanded", String(cookiesOpen));
    h.innerHTML = `<span>${cookiesOpen ? "▾" : "▸"} 🍪 Cookies</span><span class="live">${info}</span>`;
    h.addEventListener("click", () => {
      cookiesOpen = !cookiesOpen;
      try { localStorage.setItem("caisse-cookies-open", cookiesOpen ? "1" : "0"); } catch (e) { /* ignoré */ }
      renderGrid();
    });
    g.appendChild(h);
    if (cookiesOpen) cookies.forEach((p) => g.appendChild(productRow(p)));
  }

  const h2 = document.createElement("div");
  h2.className = "sec";
  h2.innerHTML = "<span>Autres produits</span>";
  g.appendChild(h2);
  others.forEach((p) => g.appendChild(productRow(p)));
  const other = document.createElement("div");
  other.setAttribute("role", "button");
  other.className = "prow other";
  other.innerHTML = `<span class="pn">＋ Autre</span><span class="pp">Saisie libre</span>`;
  other.addEventListener("click", () => openOther("cart"));
  g.appendChild(other);
}

function addProduct(p) {
  if (!p.active) return;
  if (!isCookie(p) && p.price == null) { toast("Prix à définir dans Catalogue"); return; }
  const line = cart.find((l) => l.key === p.id);
  if (line) line.qty++;
  else cart.push({ key: p.id, name: p.name, price: isCookie(p) ? 0 : p.price, qty: 1, family: isCookie(p) ? "cookie" : null });
  renderAll();
}

function renderCart() {
  const ul = $("cart");
  ul.innerHTML = "";
  const stepper = (li, l) => li.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    l.qty += Number(b.dataset.d);
    if (l.qty <= 0) cart = cart.filter((x) => x !== l);
    renderAll();
  }));
  const qtyHtml = (l) => `<div class="qty"><button data-d="-1" aria-label="Moins">−</button><span>${l.qty}</span><button data-d="1" aria-label="Plus">+</button></div>`;

  const cookieLines = cart.filter((l) => l.family === "cookie");
  if (cookieLines.length) {
    const n = cookieQty();
    const g = document.createElement("li");
    g.className = "group";
    g.innerHTML = `<div class="info">🍪 Cookies × ${n}</div><div class="amount">${eur(cookiePrice(n))}</div>`;
    ul.appendChild(g);
    cookieLines.forEach((l) => {
      const li = document.createElement("li");
      li.className = "sub";
      li.innerHTML = `<div class="info">${esc(l.name)}</div>${qtyHtml(l)}`;
      stepper(li, l);
      ul.appendChild(li);
    });
  }
  cart.filter((l) => l.family !== "cookie").forEach((l) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="info">${esc(l.name)}<small>${eur(l.price)}</small></div>${qtyHtml(l)}<div class="amount">${eur(l.price * l.qty)}</div>`;
    stepper(li, l);
    ul.appendChild(li);
  });
  $("total").textContent = eur(cartTotal());
  $("btn-pay").disabled = cart.length === 0;
  saveCart();
}

function renderPay() {
  const box = $("pay");
  box.innerHTML = "";
  PAY_MODES.forEach((m) => {
    const b = document.createElement("button");
    b.textContent = m;
    b.className = m === pay ? "active" : "";
    b.addEventListener("click", () => { pay = m; renderPay(); saveCart(); });
    box.appendChild(b);
  });
}
function renderAll() { renderGrid(); renderCart(); }

$("btn-clear").addEventListener("click", async () => {
  if (cart.length && (await askConfirm("Vider le panier ?"))) { cart = []; renderAll(); }
});

$("btn-pay").addEventListener("click", () => {
  if (!cart.length) return;
  if (cartTotal() < 0) { toast("Le total ne peut pas être négatif"); return; }
  const n = cookieQty();
  const sale = {
    id: uid(),
    ts: Date.now(),
    items: cart.map((l) => ({ name: l.name, qty: l.qty, price: l.family ? null : l.price, family: l.family || null })),
    cookies: n ? { qty: n, total: cookiePrice(n) } : null,
    total: cartTotal(),
    pay,
    client: "",
  };
  state.sales.push(sale);
  save();
  toast(`✔ ${eur(sale.total)} encaissé (${sale.pay})`);
  cart = [];
  pay = DEFAULT_PAY;
  renderPay();
  renderAll();
});

/* "Autre" */
let otherCount = 0;
let otherTarget = "cart";           // "cart" (écran Vente) ou "order" (éditeur de commande)
function openOther(target = "cart") {
  otherTarget = target;
  $("other-label").value = "";
  $("other-price").value = "";
  $("other-neg").checked = false;
  $("dlg-other").showModal();
  $("other-label").focus();
}
$("other-cancel").addEventListener("click", () => $("dlg-other").close());
$("form-other").addEventListener("submit", (e) => {
  let price = parseSigned($("other-price").value);
  if (price == null || price === 0) { e.preventDefault(); toast("Montant invalide"); return; }
  if ($("other-neg").checked) price = -Math.abs(price);          // case « Réduction » ou saisie « -5 »
  const name = $("other-label").value.trim() || (price < 0 ? "Réduction" : "Autre");
  if (otherTarget === "order" && orderDraft) {
    orderDraft.others.push({ name, price, qty: 1 });
    renderOrderEditor();
  } else {
    cart.push({ key: "other-" + ++otherCount, name, price, qty: 1, family: null });
    renderAll();
  }
});

/* ---------- Historique ---------- */
$("histo-date").value = dayKey(Date.now());
$("histo-date").addEventListener("change", () => { histoAll = false; renderHisto(); });
$("btn-all").addEventListener("click", () => { histoAll = !histoAll; renderHisto(); });

function renderHisto() {
  $("btn-all").textContent = histoAll ? "Un seul jour" : "Tout voir";
  $("histo-date").disabled = histoAll;
  const day = $("histo-date").value;
  const list = state.sales
    .filter((s) => histoAll || dayKey(s.ts) === day)
    .sort((a, b) => b.ts - a.ts);

  const total = list.reduce((s, x) => s + x.total, 0);
  const byVariant = {}, byProd = {}, byPay = {};
  let cookieN = 0, cookieCA = 0;
  list.forEach((s) => {
    byPay[s.pay] = (byPay[s.pay] || 0) + s.total;
    if (s.cookies) { cookieN += s.cookies.qty; cookieCA += s.cookies.total; }
    s.items.forEach((i) => {
      if (i.family === "cookie") { byVariant[i.name] = (byVariant[i.name] || 0) + i.qty; return; }
      const o = byProd[i.name] || (byProd[i.name] = { qty: 0, sum: 0 });
      o.qty += i.qty; o.sum += i.price * i.qty;
    });
  });
  const rows = (entries, fmt) => entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join("");
  const variantRows = Object.entries(byVariant).sort((a, b) => b[1] - a[1]);
  const plural = (n) => (n > 1 ? "s" : "");

  $("summary").innerHTML = list.length
    ? `<div class="big">${eur(total)}</div><div class="meta">${list.length} vente${plural(list.length)}${histoAll ? " (toutes dates)" : ""}</div>` +
      (cookieN
        ? `<h3>Cookies</h3><table><tr><td><b>Total</b></td><td><b>${cookieN} cookie${plural(cookieN)} · ${eur(cookieCA)}</b></td></tr>` +
          rows(variantRows, (q) => `${q}`) + `</table>`
        : "") +
      (Object.keys(byProd).length
        ? `<h3>Autres produits</h3><table>${rows(Object.entries(byProd), (v) => `${v.qty} vendu${plural(v.qty)} · ${eur(v.sum)}`)}</table>`
        : "") +
      `<h3>Par paiement</h3><table>${rows(Object.entries(byPay), eur)}</table>`
    : `<div class="empty">Aucune vente.</div>`;

  const ul = $("sales");
  ul.innerHTML = "";
  list.forEach((s) => {
    const li = document.createElement("li");
    const cookieItems = s.items.filter((i) => i.family === "cookie");
    const parts = [];
    if (cookieItems.length) parts.push(`🍪 ${s.cookies ? s.cookies.qty : ""} cookie${s.cookies && s.cookies.qty > 1 ? "s" : ""} : ` + cookieItems.map((i) => `${i.qty} × ${esc(i.name)}`).join(", "));
    s.items.filter((i) => i.family !== "cookie").forEach((i) => parts.push(`${i.qty} × ${esc(i.name)}`));
    li.innerHTML = `<div class="main">
        <div class="meta">${histoAll ? DATE_FR.format(s.ts) + " " : ""}${timeStr(s.ts)} · ${esc(s.pay)}</div>
        <div>${parts.join("<br>")}</div>
        ${s.client ? `<div class="client">👤 ${esc(s.client)}</div>` : ""}
      </div><div class="side"><div class="tot">${eur(s.total)}</div><button class="edit-btn">✏️ Éditer</button></div>`;
    li.addEventListener("click", () => openSale(s.id));
    ul.appendChild(li);
  });
}

function openSale(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  editingSaleId = id;
  $("sale-info").textContent = `${DATE_FR.format(s.ts)} ${timeStr(s.ts)} · ${s.pay} · ${eur(s.total)}`;
  $("sale-client").value = s.client || "";
  $("dlg-sale").showModal();
}
$("sale-cancel").addEventListener("click", () => $("dlg-sale").close());
$("form-sale").addEventListener("submit", () => {
  const s = state.sales.find((x) => x.id === editingSaleId);
  if (s) { s.client = $("sale-client").value.trim(); save(); renderHisto(); }
});
$("sale-delete").addEventListener("click", async () => {
  if (!(await askConfirm("Supprimer définitivement cette vente ?"))) return;
  state.sales = state.sales.filter((x) => x.id !== editingSaleId);
  save();
  $("dlg-sale").close();
  renderHisto();
});

/* Export CSV : le prix du lot de cookies n'est inscrit qu'une fois par vente (1re ligne cookie). */
$("btn-csv").addEventListener("click", () => {
  if (!state.sales.length) { toast("Aucune vente à exporter"); return; }
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Date", "Heure", "Produit", "Famille", "Quantité", "Prix unitaire", "Total ligne", "Paiement", "Client", "N° vente"].map(q).join(";")];
  [...state.sales].sort((a, b) => a.ts - b.ts).forEach((s) => {
    let cookieTotalWritten = false;
    s.items.forEach((i) => {
      let unit = "", tot = "";
      if (i.family === "cookie") {
        if (!cookieTotalWritten && s.cookies) { tot = csvNum(s.cookies.total); cookieTotalWritten = true; }
      } else { unit = csvNum(i.price); tot = csvNum(i.price * i.qty); }
      lines.push([dayKey(s.ts), timeStr(s.ts), i.name, i.family === "cookie" ? "Cookies" : "", i.qty, unit, tot, s.pay, s.client || "", s.id].map(q).join(";"));
    });
  });
  downloadCsv(`ventes-${dayKey(Date.now())}.csv`, lines);
});

/* Téléchargement d'un CSV (séparateur « ; » et BOM pour qu'Excel FR l'ouvre correctement) */
function downloadCsv(filename, lines) {
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Dépenses ---------- */
$("exp-date").value = dayKey(Date.now());

$("form-exp").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = parsePrice($("exp-amount").value);
  const date = $("exp-date").value;
  if (!date) { toast("Date manquante"); return; }
  if (amount == null || amount === 0) { toast("Montant invalide"); return; }
  state.expenses.push({
    id: uid(),
    date, label: $("exp-label").value.trim() || "Dépense", amount, ts: Date.now(),
  });
  save();
  $("exp-label").value = "";
  $("exp-amount").value = "";
  toast(`✔ Dépense de ${eur(amount)} ajoutée`);
  renderExpenses();
  $("exp-label").focus();
});

function renderExpenses() {
  const list = [...state.expenses].sort((a, b) => (b.date.localeCompare(a.date)) || (b.ts - a.ts));
  const total = list.reduce((s, x) => s + x.amount, 0);
  $("exp-summary").innerHTML = list.length
    ? `<div class="big">${eur(total)}</div><div class="meta">${list.length} dépense${list.length > 1 ? "s" : ""} au total</div>`
    : `<div class="empty">Aucune dépense saisie.</div>`;
  const ul = $("exp-list");
  ul.innerHTML = "";
  list.forEach((x) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="main">
        <div class="meta">${DATE_FR.format(new Date(x.date + "T12:00:00"))}</div>
        <div>${esc(x.label)}</div>
      </div><div class="side"><div class="tot">${eur(x.amount)}</div><button class="edit-btn">✏️ Éditer</button></div>`;
    li.addEventListener("click", () => openExpense(x.id));
    ul.appendChild(li);
  });
}

let editingExpId = null;
function openExpense(id) {
  const x = state.expenses.find((e) => e.id === id);
  if (!x) return;
  editingExpId = id;
  $("expe-date").value = x.date;
  $("expe-label").value = x.label;
  $("expe-amount").value = csvNum(x.amount);
  $("dlg-exp").showModal();
}
$("expe-cancel").addEventListener("click", () => $("dlg-exp").close());
$("form-exp-edit").addEventListener("submit", (e) => {
  const x = state.expenses.find((i) => i.id === editingExpId);
  const amount = parsePrice($("expe-amount").value);
  if (!x || amount == null || amount === 0 || !$("expe-date").value) { e.preventDefault(); toast("Date ou montant invalide"); return; }
  x.date = $("expe-date").value;
  x.label = $("expe-label").value.trim() || "Dépense";
  x.amount = amount;
  save(); renderExpenses();
});
$("expe-delete").addEventListener("click", async () => {
  if (!(await askConfirm("Supprimer définitivement cette dépense ?"))) return;
  state.expenses = state.expenses.filter((i) => i.id !== editingExpId);
  save();
  $("dlg-exp").close();
  renderExpenses();
});

$("btn-exp-csv").addEventListener("click", () => {
  if (!state.expenses.length) { toast("Aucune dépense à exporter"); return; }
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Date", "Libellé", "Montant", "N° dépense"].map(q).join(";")];
  [...state.expenses].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts)
    .forEach((x) => lines.push([x.date, x.label, csvNum(x.amount), x.id].map(q).join(";")));
  downloadCsv(`depenses-${dayKey(Date.now())}.csv`, lines);
});

/* ---------- Catalogue ---------- */
function renderCatalogue() {
  renderList($("plist-cookies"), true);
  renderList($("plist-other"), false);
  renderPricing();
}

function renderList(ul, cookieList) {
  ul.innerHTML = "";
  state.products.filter((p) => isCookie(p) === cookieList).forEach((p) => {
    const li = document.createElement("li");
    li.dataset.id = p.id;
    if (!p.active) li.classList.add("off");
    li.innerHTML = `<span class="handle" title="Glisser pour réordonner">☰</span>
      <input class="pname" value="${esc(p.name)}" aria-label="Nom">
      ${cookieList ? "" : `<input class="pprice" inputmode="decimal" placeholder="prix €" value="${p.price == null ? "" : csvNum(p.price)}" aria-label="Prix">`}
      <button class="tgl ${p.active ? "on" : ""}" aria-label="Disponible ou épuisé">${p.active ? "Actif" : SOLD_OUT}</button>
      <button class="del" aria-label="Supprimer">🗑</button>`;
    const name = li.querySelector(".pname");
    name.addEventListener("change", () => { p.name = name.value.trim() || "Sans nom"; name.value = p.name; save(); });
    const price = li.querySelector(".pprice");
    if (price) price.addEventListener("change", () => {
      p.price = price.value.trim() === "" ? null : parsePrice(price.value);
      price.value = p.price == null ? "" : csvNum(p.price);
      save();
    });
    li.querySelector(".tgl").addEventListener("click", () => { p.active = !p.active; save(); renderCatalogue(); });
    li.querySelector(".del").addEventListener("click", async () => {
      if (!(await askConfirm(`Supprimer « ${p.name} » du catalogue ?`))) return;
      state.products = state.products.filter((x) => x !== p);
      save(); renderCatalogue();
    });
    ul.appendChild(li);
  });
  enableDrag(ul, cookieList);
}

/* Glisser-déposer tactile : on déplace visuellement la ligne, et on ne réordonne le DOM qu'au relâchement. */
function enableDrag(ul, cookieList) {
  ul.querySelectorAll(".handle").forEach((h) => {
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const li = h.closest("li");
      const startY = e.clientY;
      const sibs = [...ul.children].filter((x) => x !== li);
      let target = null;
      li.classList.add("dragging");
      const clearMarks = () => { sibs.forEach((s) => s.classList.remove("drop-before")); ul.classList.remove("drop-end"); };
      const move = (ev) => {
        li.style.transform = `translateY(${ev.clientY - startY}px)`;
        clearMarks();
        target = sibs.find((s) => { const r = s.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }) || null;
        if (target) target.classList.add("drop-before"); else ul.classList.add("drop-end");
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        clearMarks();
        li.classList.remove("dragging");
        li.style.transform = "";
        if (target) ul.insertBefore(li, target); else ul.appendChild(li);
        commitOrder(ul, cookieList);
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
  });
}

function commitOrder(ul, cookieList) {
  const ids = [...ul.children].map((li) => li.dataset.id);
  const group = ids.map((id) => state.products.find((p) => p.id === id)).filter(Boolean);
  const rest = state.products.filter((p) => isCookie(p) !== cookieList);
  state.products = cookieList ? [...group, ...rest] : [...rest, ...group];
  save();
}

function renderPricing() {
  const box = $("pricing");
  box.innerHTML = "";
  const t = state.cookiePricing.totals;
  const cell = (label, value, onChange) => {
    const d = document.createElement("label");
    d.innerHTML = `${label}<input inputmode="decimal" value="${csvNum(value)}">`;
    const inp = d.querySelector("input");
    inp.addEventListener("change", () => {
      const v = parsePrice(inp.value);
      if (v != null) onChange(v);
      inp.value = csvNum(v != null ? v : value);
      save();
    });
    return d;
  };
  t.forEach((v, i) => box.appendChild(cell(`${i + 1} cookie${i ? "s" : ""}`, v, (nv) => { t[i] = nv; })));
  box.appendChild(cell("Cookie supplémentaire", state.cookiePricing.extra, (nv) => { state.cookiePricing.extra = nv; }));
}

$("btn-add-cookie").addEventListener("click", () => {
  const cookies = state.products.filter(isCookie);
  const others = state.products.filter((p) => !isCookie(p));
  cookies.push({ id: "v" + Date.now().toString(36), name: "Nouvelle variante", price: null, family: "cookie", active: true });
  state.products = [...cookies, ...others];
  save(); renderCatalogue();
  const inputs = $("plist-cookies").querySelectorAll(".pname");
  const last = inputs[inputs.length - 1];
  last.focus(); last.select();
});
$("btn-add").addEventListener("click", () => {
  state.products.push({ id: "p" + Date.now().toString(36), name: "Nouveau produit", price: null, family: null, active: true });
  save(); renderCatalogue();
  const inputs = $("plist-other").querySelectorAll(".pname");
  const last = inputs[inputs.length - 1];
  last.focus(); last.select();
});

/* ---------- Commandes ----------
 * Une commande = date + heure + nom + remarques + lignes (variantes de cookies et lignes « Autre »).
 * Le statut Payé / À payer est DÉDUIT de l'existence de la vente liée (saleId) : si la vente est supprimée
 * de l'Historique, la commande repasse toute seule à « À payer ». */
function uid() {                          // identifiant unique, même entre deux appareils
  return Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => (b % 36).toString(36)).join("");
}
const DATE_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const DATE_SHORT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
const timeFr = (t) => t.replace(":", "h");
const orderSale = (o) => (o.saleId ? state.sales.find((s) => s.id === o.saleId) || null : null);
const orderStart = (o) => {
  const [y, m, d] = o.date.split("-").map(Number);
  const [hh, mm] = o.time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
let ordersFilter = "upcoming";        // upcoming (date ≥ aujourd'hui) | past (date < aujourd'hui) | all

/* Lignes de la commande en texte (message WhatsApp, description de l'événement) */
function orderLinesText(o) {
  const out = [];
  const cook = o.lines.filter((l) => l.family === "cookie");
  if (cook.length) {
    const n = o.cookies ? o.cookies.qty : cook.reduce((s, l) => s + l.qty, 0);
    out.push(`• ${n} cookie${n > 1 ? "s" : ""} : ` + cook.map((l) => `${l.qty} × ${l.name}`).join(", "));
  }
  o.lines.filter((l) => l.family !== "cookie").forEach((l) => out.push(`• ${l.qty} × ${l.name} (${eur(l.price * l.qty)})`));
  return out;
}

function renderOrders() {
  document.querySelectorAll("#ofilter button").forEach((b) => b.classList.toggle("active", b.dataset.f === ordersFilter));
  const today = dayKey(Date.now());
  // À venir : la plus proche d'abord · Passées : la plus récente d'abord · Toutes : la plus tardive d'abord
  const list = state.orders
    .filter((o) => ordersFilter === "all" || (ordersFilter === "past" ? o.date < today : o.date >= today))
    .sort((a, b) => {
      const k = (a.date + a.time).localeCompare(b.date + b.time);
      return ordersFilter === "upcoming" ? k : -k;
    });
  const ul = $("orders");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${ordersFilter === "past" ? "Aucune commande passée." : ordersFilter === "upcoming" ? "Aucune commande à venir." : "Aucune commande."}</li>`;
    return;
  }
  list.forEach((o) => {
    const sale = orderSale(o);
    const li = document.createElement("li");
    li.className = "order" + (sale ? " paid" : "");
    const when = o.date === today ? "Aujourd'hui" : DATE_SHORT.format(orderStart(o));
    const late = !sale && o.date < today;
    li.innerHTML =
      `<div class="ohead"><span class="odate${late ? " late" : ""}">${esc(when)} · ${esc(timeFr(o.time))}</span>` +
      `<span class="ostatus ${sale ? "ok" : "due"}">${sale ? "Payé · " + esc(sale.pay) : "À payer"}</span></div>` +
      `<div class="oname">${o.name ? esc(o.name) : "<i>Sans nom</i>"}</div>` +
      `<div class="olines">${orderLinesText(o).map(esc).join("<br>")}</div>` +
      (o.remarks ? `<div class="oremark">📝 ${esc(o.remarks)}</div>` : "") +
      `<div class="otot">${eur(o.total)}</div>` +
      `<div class="oact">` +
      (sale ? `<button type="button" data-a="unpay">Annuler le paiement</button>` : `<button type="button" class="paybtn" data-a="pay">Marquer comme payé</button>`) +
      `<button type="button" data-a="wa">WhatsApp</button><button type="button" data-a="ics">Agenda</button><button type="button" data-a="edit">Éditer</button></div>`;
    const act = (a, fn) => li.querySelector(`[data-a=${a}]`).addEventListener("click", fn);
    if (sale) act("unpay", () => unpayOrder(o)); else act("pay", () => askPayMode(o));
    act("wa", () => sendWhatsApp(o));
    act("ics", () => exportIcs(o));
    act("edit", () => openOrder(o));
    ul.appendChild(li);
  });
}
document.querySelectorAll("#ofilter button").forEach((b) => b.addEventListener("click", () => { ordersFilter = b.dataset.f; renderOrders(); }));

/* ----- Paiement : crée immédiatement la vente liée ----- */
let payingOrderId = null;
function askPayMode(o) {
  payingOrderId = o.id;
  $("paymode-info").textContent = `${o.name || "Commande"} · ${eur(o.total)}`;
  const box = $("paymode-btns");
  box.innerHTML = "";
  PAY_MODES.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = m;
    b.addEventListener("click", () => { $("dlg-paymode").close(); markOrderPaid(payingOrderId, m); });
    box.appendChild(b);
  });
  $("dlg-paymode").showModal();
}
$("paymode-cancel").addEventListener("click", () => $("dlg-paymode").close());

function markOrderPaid(id, mode) {
  const o = state.orders.find((x) => x.id === id);
  if (!o || orderSale(o)) return;
  const sale = {
    id: "pay-" + o.id,            // identifiant dérivé de la commande : payée depuis deux appareils, elle ne donne qu'une seule vente
    ts: Date.now(), pay: mode, client: o.name || "", total: o.total, orderId: o.id,
    items: o.lines.map((l) => ({ name: l.name, qty: l.qty, price: l.family === "cookie" ? null : l.price, family: l.family === "cookie" ? "cookie" : null })),
    cookies: o.cookies ? { qty: o.cookies.qty, total: o.cookies.total } : null,
  };
  state.sales.push(sale);
  o.saleId = sale.id;
  save();
  renderOrders();
  toast(`✔ ${eur(o.total)} encaissé (${mode})`);
}

async function unpayOrder(o) {
  if (!(await askConfirm("Annuler le paiement ? La vente liée sera supprimée de l'Historique."))) return;
  state.sales = state.sales.filter((s) => s.id !== o.saleId);
  o.saleId = null;
  save();
  renderOrders();
  toast("Paiement annulé");
}

/* ----- WhatsApp : ouvre WhatsApp avec le message prérempli (le contact se choisit dans WhatsApp) ----- */
function orderMessage(o) {
  const sale = orderSale(o);
  const day = DATE_LONG.format(orderStart(o));
  return [
    `Bonjour${o.name ? " " + o.name : ""},`,
    `voici le récapitulatif de votre commande Le Temps d'un Cookie 🍪`,
    ``,
    `📅 ${day.charAt(0).toUpperCase() + day.slice(1)} à ${timeFr(o.time)}`,
    ...orderLinesText(o),
    ``,
    `Total : ${eur(o.total)} ${sale ? "(réglé, merci !)" : "(à régler au retrait)"}`,
    ``,
    `À très bientôt !`,
  ].join("\n");
}
function openLink(url) {
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  document.body.appendChild(a); a.click(); a.remove();
}
function sendWhatsApp(o) { openLink("https://wa.me/?text=" + encodeURIComponent(orderMessage(o))); }

/* ----- Agenda : fichier .ics (événement d'1 h) à ouvrir avec l'application Agenda ----- */
const icsEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function icsFold(line) {                       // lignes de 75 octets maximum (RFC 5545), accents compris
  const enc = new TextEncoder();
  let out = "", cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out += cur + "\r\n"; cur = " "; bytes = 1; }
    cur += ch; bytes += b;
  }
  return out + cur;
}
const p2 = (n) => String(n).padStart(2, "0");
const icsLocal = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;

function buildIcs(o) {
  const start = orderStart(o);
  const end = new Date(start.getTime() + 60 * 60 * 1000);                  // durée : 1 h
  const n = o.cookies ? o.cookies.qty : 0;
  const title = `Commande ${o.name || "sans nom"}${n ? ` – ${n} cookie${n > 1 ? "s" : ""}` : ""} – ${eur(o.total)}`;
  const desc = [
    ...orderLinesText(o),
    `Total : ${eur(o.total)} (${orderSale(o) ? "payé" : "à payer"})`,
    o.remarks ? `Remarques : ${o.remarks}` : "",
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Le Temps d'un Cookie//Caisse//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${o.id}@temps-d-un-cookie`,                                       // même UID + SEQUENCE croissant = mise à jour, pas de doublon
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `SEQUENCE:${o.seq || 0}`,
    `DTSTART:${icsLocal(start)}`, `DTEND:${icsLocal(end)}`,
    `SUMMARY:${icsEscape(title)}`, `DESCRIPTION:${icsEscape(desc)}`,
    "COLOR:yellowgreen",                                                   // « vert pomme » (RFC 7986 : nom de couleur CSS) ; ignoré par certaines applis, dont Google Agenda
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape("Dans 7 jours : " + title)}`, "TRIGGER:-P7D", "END:VALARM",   // rappel 7 jours avant (J-7)
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape("Demain : " + title)}`, "TRIGGER:-P1D", "END:VALARM",      // rappel 24 h avant (J-1)
    "END:VEVENT", "END:VCALENDAR",
  ].map(icsFold);
  return lines.join("\r\n") + "\r\n";
}
function exportIcs(o) {
  const slug = (o.name || "client").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "client";
  const blob = new Blob([buildIcs(o)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `commande-${slug}-${o.date}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Ouvrez le fichier pour l'ajouter à l'Agenda");
}

/* ----- Éditeur de commande ----- */
let orderDraft = null;     // { id, date, time, cookies:{nom:qté}, others:[{name,price,qty}], locked }

function orderTotals() {
  const n = Object.values(orderDraft.cookies).reduce((s, q) => s + q, 0);
  const cookiesTotal = cookiePrice(n);
  return { n, cookiesTotal, total: cookiesTotal + orderDraft.others.reduce((s, l) => s + l.price * l.qty, 0) };
}

function openOrder(o) {
  if (o) {
    const cookies = {}, others = [];
    o.lines.forEach((l) => {
      if (l.family === "cookie") cookies[l.name] = (cookies[l.name] || 0) + l.qty;
      else others.push({ name: l.name, price: l.price, qty: l.qty });
    });
    orderDraft = { id: o.id, cookies, others, locked: !!orderSale(o) };
    $("ord-date").value = o.date; $("ord-time").value = o.time;
    $("ord-name").value = o.name; $("ord-phone").value = o.phone || ""; $("ord-remarks").value = o.remarks;
  } else {
    orderDraft = { id: null, cookies: {}, others: [], locked: false };
    $("ord-date").value = dayKey(Date.now()); $("ord-time").value = "10:00";
    $("ord-name").value = ""; $("ord-phone").value = ""; $("ord-remarks").value = "";
  }
  $("order-title").textContent = o ? "Modifier la commande" : "Nouvelle commande";
  $("btn-order-delete").hidden = !o;
  renderOrderEditor();
  $("dlg-order").showModal();
}
$("btn-new-order").addEventListener("click", () => openOrder(null));
$("order-cancel").addEventListener("click", () => $("dlg-order").close());

function renderOrderEditor() {
  const box = $("ord-items");
  box.innerHTML = "";
  const locked = orderDraft.locked;
  const t = orderTotals();

  if (locked) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Commande payée : pour modifier son contenu, annulez d'abord le paiement.";
    box.appendChild(note);
  }

  const head = document.createElement("div");
  head.className = "sec";
  head.innerHTML = `<span>🍪 Cookies</span><span class="live">${t.n ? `${t.n} cookie${t.n > 1 ? "s" : ""} · ${eur(t.cookiesTotal)}` : ""}</span>`;
  box.appendChild(head);

  const variants = state.products.filter(isCookie).map((p) => ({ name: p.name, active: p.active, note: p.active ? "" : SOLD_OUT }));
  Object.keys(orderDraft.cookies).forEach((n) => { if (!variants.some((v) => v.name === n)) variants.push({ name: n, active: true, note: "retiré du catalogue" }); });
  variants.forEach((v) => {
    const qty = orderDraft.cookies[v.name] || 0;
    const row = document.createElement("div");
    row.className = "prow" + (v.active || qty ? "" : " off");
    row.setAttribute("role", "button");
    row.innerHTML = `<span class="pn">${esc(v.name)}</span><span class="pp">${esc(v.note)}</span>` +
      (qty && !locked ? `<button type="button" class="minus" aria-label="Retirer un">−</button>` : "") +
      `<span class="badge${qty ? "" : " zero"}">${qty || ""}</span>`;
    if (!locked) {
      row.addEventListener("click", () => {
        if (!v.active && !qty) return;
        orderDraft.cookies[v.name] = qty + 1;
        renderOrderEditor();
      });
      const minus = row.querySelector(".minus");
      if (minus) minus.addEventListener("click", (e) => {
        e.stopPropagation();
        if (qty <= 1) delete orderDraft.cookies[v.name]; else orderDraft.cookies[v.name] = qty - 1;
        renderOrderEditor();
      });
    }
    box.appendChild(row);
  });

  if (orderDraft.others.length || !locked) {
    const h2 = document.createElement("div");
    h2.className = "sec";
    h2.innerHTML = "<span>Autres lignes</span>";
    box.appendChild(h2);
  }
  orderDraft.others.forEach((l) => {
    const row = document.createElement("div");
    row.className = "ordline";
    row.innerHTML = `<span class="pn">${esc(l.name)}<br><small>${eur(l.price)}</small></span>` +
      (locked ? `<b>× ${l.qty}</b>` : `<span class="qty"><button type="button" data-d="-1" aria-label="Moins">−</button><span>${l.qty}</span><button type="button" data-d="1" aria-label="Plus">+</button></span>`) +
      `<b>${eur(l.price * l.qty)}</b>`;
    row.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => {
      l.qty += Number(b.dataset.d);
      if (l.qty <= 0) orderDraft.others = orderDraft.others.filter((x) => x !== l);
      renderOrderEditor();
    }));
    box.appendChild(row);
  });
  if (!locked) {
    const add = document.createElement("div");
    add.className = "prow other";
    add.setAttribute("role", "button");
    add.innerHTML = `<span class="pn">＋ Autre</span><span class="pp">remise, produit hors catalogue</span>`;
    add.addEventListener("click", () => openOther("order"));
    box.appendChild(add);
  }
  $("ord-total").textContent = eur(t.total);
}

$("form-order").addEventListener("submit", (e) => {
  const date = $("ord-date").value, time = $("ord-time").value;
  const t = orderTotals();
  const lines = [
    ...Object.entries(orderDraft.cookies).filter(([, q]) => q > 0).map(([name, qty]) => ({ name, qty, price: null, family: "cookie" })),
    ...orderDraft.others.map((l) => ({ name: l.name, qty: l.qty, price: l.price, family: null })),
  ];
  if (!date || !time) { e.preventDefault(); toast("Date et heure obligatoires"); return; }
  if (!lines.length) { e.preventDefault(); toast("Ajoutez au moins un produit"); return; }
  if (t.total < 0) { e.preventDefault(); toast("Le total ne peut pas être négatif"); return; }

  const data = { date, time, name: $("ord-name").value.trim(), phone: $("ord-phone").value.trim(), remarks: $("ord-remarks").value.trim() };
  const cookies = t.n ? { qty: t.n, total: t.cookiesTotal } : null;
  if (orderDraft.id) {
    const o = state.orders.find((x) => x.id === orderDraft.id);
    if (!o) return;
    Object.assign(o, data);
    if (!orderDraft.locked) { o.lines = lines; o.cookies = cookies; o.total = t.total; }   // prix recalculé à l'enregistrement, puis figé
    o.seq = (o.seq || 0) + 1;
    const sale = orderSale(o);
    if (sale) sale.client = o.name;
  } else {
    state.orders.push({ id: uid(), ts: Date.now(), seq: 0, ...data, lines, cookies, total: t.total, saleId: null });
  }
  save();
  renderOrders();
  toast("✔ Commande enregistrée");
});

$("btn-order-delete").addEventListener("click", async () => {
  const o = state.orders.find((x) => x.id === (orderDraft && orderDraft.id));
  if (!o) return;
  const msg = orderSale(o) ? "Supprimer cette commande ? La vente déjà enregistrée est conservée dans l'Historique." : "Supprimer cette commande ?";
  if (!(await askConfirm(msg))) return;
  state.orders = state.orders.filter((x) => x !== o);
  save();
  $("dlg-order").close();
  renderOrders();
});

/* ----- Choix d'un contact du téléphone (API Contact Picker : Chrome sur Android, appel déclenché par un appui) ----- */
async function pickContact() {
  try {
    const res = await navigator.contacts.select(["name", "tel"], { multiple: false });
    if (!res || !res.length) return;
    const c = res[0];
    if (c.tel && c.tel.length) $("ord-phone").value = String(c.tel[0]).trim();                      // premier numéro du contact
    if (!$("ord-name").value.trim() && c.name && c.name.length) $("ord-name").value = String(c.name[0]).trim();   // nom : seulement s'il est vide
  } catch (e) {
    if (e && e.name !== "AbortError") toast("Contacts indisponibles");
  }
}
if ("contacts" in navigator && "ContactsManager" in window) $("btn-contact").hidden = false;     // masqué sur PC et navigateurs sans cette fonction
$("btn-contact").addEventListener("click", pickContact);

/* ---------- Sauvegarde : fichier JSON + menu Partager d'Android ---------- */
$("btn-backup").addEventListener("click", async () => {
  const now = new Date();
  const stamp = `${dayKey(now.getTime())}-${timeStr(now.getTime()).replace(":", "h")}`;
  const filename = `sauvegarde-caisse-${stamp}.json`;
  const payload = { app: "le-temps-d-un-cookie", format: 1, exportedAt: now.toISOString(), data: state };
  const json = JSON.stringify(payload);                       // compact : fichier ~2x plus léger
  const file = new File([json], filename, { type: "application/json" });
  const summary = `${state.sales.length} vente(s), ${state.expenses.length} dépense(s), ${state.orders.length} commande(s)`;

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Sauvegarde caisse", text: `Sauvegarde caisse du ${DATE_FR.format(now)} (${summary})` });
      markBackup();
      toast("✔ Sauvegarde partagée");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;      // menu fermé par l'utilisateur : rien à faire
      /* partage impossible : on retombe sur le téléchargement */
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markBackup();
  toast("Partage indisponible : fichier téléchargé");
});

/* Bandeau « Dernière sauvegarde il y a x h » */
const LAST_BACKUP_KEY = "caisse-last-backup";
const SNAPSHOT_KEY = "caisse-avant-restauration";
let undoUntil = 0;
const lastBackup = () => { try { return Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0; } catch (e) { return 0; } };
function markBackup() {
  try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (e) { /* ignoré */ }
  renderBackupBar();
}
function agoText(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
function renderBackupBar() {
  const bar = $("backup-bar");
  if (undoUntil > Date.now()) {
    bar.className = "backbar";
    bar.innerHTML = `Données restaurées · <button class="link" id="btn-undo">Annuler la restauration</button>`;
    $("btn-undo").addEventListener("click", undoRestore);
    return;
  }
  const t = lastBackup();
  const hasData = state.sales.length > 0 || state.expenses.length > 0 || state.orders.length > 0;
  const age = Date.now() - t;
  bar.textContent = t ? `Dernière sauvegarde ${agoText(age)}` : "Aucune sauvegarde pour l'instant";
  const sy = syncLabel();
  if (sy) {
    bar.appendChild(document.createTextNode(" · "));
    const b = document.createElement("button");
    b.type = "button"; b.id = "btn-sync"; b.textContent = sy.text;
    b.className = "link syncbtn" + (sy.bad ? " bad" : "");
    b.addEventListener("click", openSync);
    bar.appendChild(b);
  }
  const ver = document.createElement("span");                 // numéro de version (voir version.js)
  ver.className = "ver";
  ver.textContent = ` · v${APP_VERSION}`;
  bar.appendChild(ver);
  bar.className = "backbar" + (hasData && (!t || age >= 24 * 3600e3) ? " warn" : "");
}
setInterval(renderBackupBar, 60000);

/* ---------- Synchronisation entre appareils (moteur : sync.js) ---------- */
function syncLabel() {
  const i = Sync.info();
  switch (i.state) {
    case "off": return null;
    case "login": return { text: "☁ Se connecter", bad: true };
    case "syncing": return { text: "☁ Synchronisation…" };
    case "offline": return { text: "☁ Hors ligne : envoi plus tard" };
    case "error": return { text: "☁ Erreur de synchro", bad: true };
    default: return { text: "☁ Synchronisé " + agoText(Date.now() - i.lastOk) };
  }
}
Sync.onStatus = () => { renderBackupBar(); if ($("dlg-sync").open) renderSyncDialog(); };

function renderSyncDialog() {
  const i = Sync.info();
  const connected = i.state !== "login";
  $("form-sync").hidden = connected;
  $("sync-ok").hidden = !connected;
  if (connected) {
    const label = { idle: "à jour", syncing: "en cours…", offline: "hors ligne (les saisies partiront au retour du réseau)", error: "erreur : " + i.message }[i.state] || "";
    $("sync-info").textContent = `Connecté : ${i.email}. Synchronisation ${label}` + (i.lastOk ? ` · dernière réussie ${agoText(Date.now() - i.lastOk)}.` : ".");
  } else if (i.message) {
    $("sync-err").textContent = i.message; $("sync-err").hidden = false;
  }
}
function openSync() {
  $("sync-err").hidden = true;
  $("sync-email").setAttribute("autocomplete", "username");        // l'appli coupe l'autocomplétion partout ailleurs ; ici elle est utile
  $("sync-pass").setAttribute("autocomplete", "current-password");
  renderSyncDialog();
  if (!$("dlg-sync").open) $("dlg-sync").showModal();
}
["sync-close1", "sync-close2"].forEach((id) => $(id).addEventListener("click", () => $("dlg-sync").close()));
$("sync-now").addEventListener("click", () => Sync.now());
$("sync-out").addEventListener("click", async () => {
  if (await askConfirm("Se déconnecter ? Les données restent sur cet appareil mais ne seront plus synchronisées.")) { await Sync.signOut(); $("dlg-sync").close(); toast("Déconnecté"); }
});
$("form-sync").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("sync-login");
  btn.disabled = true;
  $("sync-err").hidden = true;
  try {
    await Sync.signIn($("sync-email").value.trim(), $("sync-pass").value);
    $("sync-pass").value = "";
    $("dlg-sync").close();
    toast("✔ Connecté");
  } catch (err) {
    $("sync-err").textContent = err instanceof TypeError ? "Pas de réseau" : (err.message === "Invalid login credentials" ? "E-mail ou mot de passe incorrect" : err.message);
    $("sync-err").hidden = false;
  } finally { btn.disabled = false; }
});

/* Après une synchro (ou une modification venue d'une autre fenêtre) : on relit les données, puis on réaffiche
 * dès que l'utilisateur n'est pas en train de saisir (fenêtre ouverte ou champ actif). */
let idleTimer = null;
function renderWhenIdle() {
  const ae = document.activeElement;
  if (document.querySelector("dialog[open]") || (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName))) {
    clearTimeout(idleTimer); idleTimer = setTimeout(renderWhenIdle, 1500); return;
  }
  showTab(currentTab());
}
async function refreshState() {
  try {
    const s = await DB.load();
    if (!s || !s.cookiePricing) return;
    s.version = DATA_VERSION;
    if (ensureCatalog(s)) DB.commit(s);
    state = s;
    renderWhenIdle();
  } catch (e) { /* lecture impossible : on garde l'affichage actuel */ }
}
Sync.onRemoteChange = refreshState;

/* ---------- Restauration ---------- */
let pendingRestore = null;
const currentTab = () => document.querySelector("nav button.active").dataset.tab;
function refreshAll() { cart = []; renderPay(); showTab(currentTab()); }

/* Vérifie chaque entrée d'un fichier restauré : les entrées invalides sont ignorées (et comptées) au lieu de casser l'affichage. */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
function sanitizeData(d) {
  let dropped = 0;

  const sales = [];
  (Array.isArray(d.sales) ? d.sales : []).forEach((s) => {
    const ok = s && isStr(s.id) && s.id && isNum(s.ts) && isNum(s.total) && isStr(s.pay) &&
      Array.isArray(s.items) && s.items.length > 0 &&
      s.items.every((i) => i && isStr(i.name) && isNum(i.qty) && i.qty > 0 && (i.family === "cookie" || isNum(i.price))) &&
      (s.cookies == null || (isNum(s.cookies.qty) && isNum(s.cookies.total)));
    if (!ok) { dropped++; return; }
    sales.push({
      id: s.id, ts: s.ts, total: s.total, pay: s.pay, client: isStr(s.client) ? s.client : "", orderId: isStr(s.orderId) ? s.orderId : null,
      items: s.items.map((i) => i.family === "cookie"
        ? { name: i.name, qty: i.qty, price: null, family: "cookie" }
        : { name: i.name, qty: i.qty, price: i.price, family: null }),
      cookies: s.cookies ? { qty: s.cookies.qty, total: s.cookies.total } : null,
    });
  });

  const orders = [];
  (Array.isArray(d.orders) ? d.orders : []).forEach((o) => {
    const ok = o && isStr(o.id) && o.id && isStr(o.date) && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && isStr(o.time) && /^\d{2}:\d{2}$/.test(o.time) &&
      isNum(o.total) && Array.isArray(o.lines) && o.lines.length > 0 &&
      o.lines.every((l) => l && isStr(l.name) && isNum(l.qty) && l.qty > 0 && (l.family === "cookie" || isNum(l.price))) &&
      (o.cookies == null || (isNum(o.cookies.qty) && isNum(o.cookies.total)));
    if (!ok) { dropped++; return; }
    orders.push({
      id: o.id, ts: isNum(o.ts) ? o.ts : 0, seq: isNum(o.seq) ? o.seq : 0, date: o.date, time: o.time,
      name: isStr(o.name) ? o.name : "", phone: isStr(o.phone) ? o.phone : "", remarks: isStr(o.remarks) ? o.remarks : "", total: o.total,
      lines: o.lines.map((l) => l.family === "cookie"
        ? { name: l.name, qty: l.qty, price: null, family: "cookie" }
        : { name: l.name, qty: l.qty, price: l.price, family: null }),
      cookies: o.cookies ? { qty: o.cookies.qty, total: o.cookies.total } : null,
      saleId: isStr(o.saleId) && o.saleId ? o.saleId : null,
    });
  });

  const expenses = [];
  (Array.isArray(d.expenses) ? d.expenses : []).forEach((x) => {
    const ok = x && isStr(x.id) && x.id && isStr(x.date) && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && isStr(x.label) && isNum(x.amount);
    if (!ok) { dropped++; return; }
    expenses.push({ id: x.id, date: x.date, label: x.label, amount: x.amount, ts: isNum(x.ts) ? x.ts : 0 });
  });

  let products = [];
  (Array.isArray(d.products) ? d.products : []).forEach((p) => {
    const ok = p && isStr(p.id) && p.id && isStr(p.name) && (p.price == null || isNum(p.price));
    if (!ok) { dropped++; return; }
    products.push({ id: p.id, name: p.name, price: p.price == null ? null : p.price, family: p.family === "cookie" ? "cookie" : null, active: p.active !== false });
  });
  if (!products.length) products = freshState().products;

  const cp = d.cookiePricing;
  const pricingOk = cp && Array.isArray(cp.totals) && cp.totals.length > 0 && cp.totals.every((v) => isNum(v) && v >= 0) && isNum(cp.extra) && cp.extra >= 0;
  const cookiePricing = pricingOk ? { totals: [...cp.totals], extra: cp.extra } : freshState().cookiePricing;

  return { version: d.version, catalogRev: isNum(d.catalogRev) ? d.catalogRev : 0, products, sales, expenses, orders, cookiePricing, dropped };
}

$("btn-restore").addEventListener("click", () => { $("file-restore").value = ""; $("file-restore").click(); });
$("file-restore").addEventListener("change", async () => {
  const f = $("file-restore").files[0];
  if (!f) return;
  let p;
  try { p = JSON.parse(await f.text()); } catch (e) { p = null; }
  if (!p || p.app !== "le-temps-d-un-cookie" || !p.data || !Array.isArray(p.data.products) || !Array.isArray(p.data.sales)) {
    toast("Fichier non reconnu"); return;
  }
  const d = sanitizeData(p.data);
  pendingRestore = { exportedAt: p.exportedAt, data: d };
  const when = p.exportedAt ? new Date(p.exportedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "date inconnue";
  $("restore-info").textContent =
    `Fichier du ${when} : ${d.sales.length} vente(s), ${d.expenses.length} dépense(s), ${d.orders.length} commande(s)` +
    (d.dropped ? ` (${d.dropped} entrée(s) invalide(s) ignorée(s))` : "") + `. ` +
    `Cet appareil : ${state.sales.length} vente(s), ${state.expenses.length} dépense(s), ${state.orders.length} commande(s).`;
  document.querySelector('input[name=rmode][value=merge]').checked = true;
  $("restore-cat").checked = false;
  $("rcat-wrap").hidden = false;
  $("dlg-restore").showModal();
});
document.querySelectorAll("input[name=rmode]").forEach((r) =>
  r.addEventListener("change", () => { $("rcat-wrap").hidden = document.querySelector("input[name=rmode]:checked").value === "replace"; }));
$("restore-cancel").addEventListener("click", () => { pendingRestore = null; $("dlg-restore").close(); });

$("form-restore").addEventListener("submit", () => {
  if (!pendingRestore) return;
  const mode = document.querySelector("input[name=rmode]:checked").value;
  let inc = pendingRestore.data;
  pendingRestore = null;
  if (inc.version !== DATA_VERSION) inc = migrate(inc);       // ancien format (v1) → format actuel
  delete inc.dropped;
  ensureCatalog(inc);                                         // ancienne sauvegarde : Thé et Café ajoutés une fois
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state)); } catch (e) { /* ignoré */ }   // filet de sécurité

  let msg;
  if (mode === "replace") {
    state = inc;
    msg = "✔ Données remplacées";
  } else {
    const sid = new Set(state.sales.map((s) => s.id));
    const eid = new Set(state.expenses.map((x) => x.id));
    const newSales = inc.sales.filter((s) => !sid.has(s.id));
    const newExp = inc.expenses.filter((x) => !eid.has(x.id));
    const oid = new Set(state.orders.map((o) => o.id));
    const newOrders = inc.orders.filter((o) => !oid.has(o.id));
    state.sales.push(...newSales);
    state.expenses.push(...newExp);
    state.orders.push(...newOrders);
    if ($("restore-cat").checked) { state.products = inc.products; state.cookiePricing = inc.cookiePricing; state.catalogRev = inc.catalogRev; }
    msg = `✔ Fusion : +${newSales.length} vente(s), +${newExp.length} dépense(s), +${newOrders.length} commande(s)`;
  }
  save();
  undoUntil = Date.now() + 60000;
  setTimeout(renderBackupBar, 60500);
  refreshAll();
  renderBackupBar();
  toast(msg);
});

function undoRestore() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return;
    state = JSON.parse(raw);
  } catch (e) { return; }
  save();
  undoUntil = 0;
  refreshAll();
  renderBackupBar();
  toast("Restauration annulée");
}

/* ---------- Panier en brouillon : survit à un rechargement ou à la fermeture de l'appli par Android ---------- */
const CART_KEY = "caisse-panier";
function saveCart() {
  try {
    if (cart.length) localStorage.setItem(CART_KEY, JSON.stringify({ cart, pay }));
    else localStorage.removeItem(CART_KEY);
  } catch (e) { /* ignoré */ }
}
function loadCart() {
  try {
    const d = JSON.parse(localStorage.getItem(CART_KEY));
    if (!d || !Array.isArray(d.cart)) return;
    cart = d.cart.filter((l) => l && typeof l.key === "string" && typeof l.name === "string" &&
      Number.isFinite(l.qty) && l.qty > 0 && Number.isFinite(l.price));
    if (PAY_MODES.includes(d.pay)) pay = d.pay;
    cart.forEach((l) => { const m = /^other-(\d+)$/.exec(l.key); if (m) otherCount = Math.max(otherCount, Number(m[1])); });
    if (cart.length) toast("Panier en cours rétabli");
  } catch (e) { /* brouillon illisible : on l'ignore */ }
}

/* ---------- Plusieurs fenêtres (onglet Chrome + appli installée) : on relit les données modifiées ailleurs ---------- */
DB.onExternalChange = () => refreshState();
window.addEventListener("storage", (e) => {                  // repli sans IndexedDB
  if (DB.available || (e.key !== null && e.key !== STORAGE_KEY)) return;
  state = loadLegacy();
  showTab(currentTab());
  toast("Données mises à jour depuis une autre fenêtre");
});

/* ---------- Mode hors ligne (service worker) ----------
 * Sur localhost on ne l'active que sur demande (?sw=1) : sinon le cache masquerait les modifications pendant le développement. */
if ("serviceWorker" in navigator && (location.hostname !== "localhost" || location.search.includes("sw=1"))) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(() => { /* hors ligne non disponible : l'appli reste utilisable en ligne */ });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) toast("Mise à jour installée : fermez et rouvrez l'appli");
  });
}

/* ---------- Pas de saisie automatique ----------
 * Chrome propose, au-dessus du clavier, des adresses, cartes bancaires ou numéros enregistrés : cette barre prend de la place.
 * « autocomplete » avec une valeur non reconnue (et non « off », ignoré par Chrome pour les champs nom/adresse/téléphone)
 * désactive ces suggestions. Appliqué à tous les champs, y compris ceux créés plus tard (catalogue, éditeurs…). */
function noAutofill(el) {
  el.setAttribute("autocomplete", "nope");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("spellcheck", "false");
  el.setAttribute("data-lpignore", "true");          // gestionnaires de mots de passe tiers
  el.setAttribute("data-1p-ignore", "");
}
const noAutofillIn = (root) => root.querySelectorAll("input, textarea").forEach(noAutofill);
noAutofillIn(document);
new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
  if (n.nodeType !== 1) return;
  if (n.matches("input, textarea")) noAutofill(n);
  noAutofillIn(n);
}))).observe(document.body, { childList: true, subtree: true });

/* ---------- Démarrage ---------- */
loadCart();
renderPay();
renderAll();
renderBackupBar();
Sync.start();                // synchronisation avec l'autre appareil (sans effet tant qu'on n'est pas connecté)
