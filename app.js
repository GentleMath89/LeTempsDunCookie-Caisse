"use strict";

const STORAGE_KEY = "caisse-marche-v1";
const DATA_VERSION = 2;
const PAY_MODES = ["Espèces", "CB", "PayPal", "Wero"];
const DEFAULT_PAY = "Espèces";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Données ---------- */
const COOKIE_VARIANTS = [
  "Le Pécan", "Le Trois Chocolats", "Le Cacahuète", "Le Pistache", "Le Speculoos",
  "Le Rico", "Le Marshall", "Le Noisette", "L'Edition Limitée",
];
const DEFAULT_OTHERS = [
  { id: "p4", name: "Sachet de chocolats", price: 800 },
  { id: "p5", name: "Pack cadeau M", price: 1000 },
  { id: "p6", name: "Pack cadeau L", price: 2000 },
];
// Prix TOTAL pour 1 à 8 cookies, puis prix de chaque cookie supplémentaire à partir du 9e.
const DEFAULT_PRICING = { totals: [300, 600, 900, 1100, 1400, 1700, 2000, 2000], extra: 250 };

const isCookie = (p) => p.family === "cookie";
const freshState = () => ({
  version: DATA_VERSION,
  products: [
    ...COOKIE_VARIANTS.map((name, i) => ({ id: "v" + (i + 1), name, price: null, family: "cookie", active: true })),
    ...DEFAULT_OTHERS.map((p) => ({ ...p, family: null, active: true })),
  ],
  sales: [],
  expenses: [],
  cookiePricing: { totals: [...DEFAULT_PRICING.totals], extra: DEFAULT_PRICING.extra },
});

/* Anciennes données (v1 : produits « 1 / 4 / 8 cookies ») → v2 */
function migrate(s) {
  const kept = s.products.filter((p) => !(["p1", "p2", "p3"].includes(p.id) && /cookies?$/i.test(p.name)));
  const fresh = freshState();
  return {
    version: DATA_VERSION,
    products: [
      ...fresh.products.filter(isCookie),
      ...kept.map((p) => ({ family: null, ...p, active: p.active !== false })),
    ],
    sales: s.sales,
    expenses: s.expenses || [],
    cookiePricing: fresh.cookiePricing,
  };
}

let state = load();
let cart = [];            // { key, name, price, qty, family }
let pay = DEFAULT_PAY;
let histoAll = false;
let cookiesOpen = true;
try { cookiesOpen = localStorage.getItem("caisse-cookies-open") !== "0"; } catch (e) { /* ignoré */ }
let editingSaleId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.products) && Array.isArray(s.sales)) {
        if (s.version !== DATA_VERSION || !s.cookiePricing) { const m = migrate(s); persist(m); return m; }
        if (!Array.isArray(s.expenses)) s.expenses = [];      // données créées avant l'onglet Dépenses
        return s;
      }
    }
  } catch (e) { /* stockage indisponible : on repart du catalogue par défaut */ }
  return freshState();
}
function persist(st) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(st)); } catch (e) { /* ignoré */ } }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast("⚠ Enregistrement impossible"); }
}
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
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
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
  ["vente", "histo", "depenses", "catalogue"].forEach((t) => ($("tab-" + t).hidden = t !== name));
  $("checkout").hidden = name !== "vente";
  if (name === "vente") renderAll();
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
    `<span class="pp">${!p.active ? "désactivé" : isCookie(p) ? "" : p.price == null ? "prix à définir" : eur(p.price)}</span>` +
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
  const cookies = state.products.filter(isCookie);
  const others = state.products.filter((p) => !isCookie(p));

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
  other.addEventListener("click", openOther);
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
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
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
function openOther() {
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
  cart.push({ key: "other-" + ++otherCount, name, price, qty: 1, family: null });
  renderAll();
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
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
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
      <button class="tgl ${p.active ? "on" : ""}" aria-label="Activer ou désactiver">${p.active ? "Actif" : "Off"}</button>
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

/* ---------- Sauvegarde : fichier JSON + menu Partager d'Android ---------- */
$("btn-backup").addEventListener("click", async () => {
  const now = new Date();
  const stamp = `${dayKey(now.getTime())}-${timeStr(now.getTime()).replace(":", "h")}`;
  const filename = `sauvegarde-caisse-${stamp}.json`;
  const payload = { app: "le-temps-d-un-cookie", format: 1, exportedAt: now.toISOString(), data: state };
  const json = JSON.stringify(payload);                       // compact : fichier ~2x plus léger
  const file = new File([json], filename, { type: "application/json" });
  const summary = `${state.sales.length} vente(s), ${state.expenses.length} dépense(s)`;

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
  const hasData = state.sales.length > 0 || state.expenses.length > 0;
  const age = Date.now() - t;
  bar.textContent = t ? `Dernière sauvegarde ${agoText(age)}` : "Aucune sauvegarde pour l'instant";
  bar.className = "backbar" + (hasData && (!t || age >= 24 * 3600e3) ? " warn" : "");
}
setInterval(renderBackupBar, 60000);

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
      id: s.id, ts: s.ts, total: s.total, pay: s.pay, client: isStr(s.client) ? s.client : "",
      items: s.items.map((i) => i.family === "cookie"
        ? { name: i.name, qty: i.qty, price: null, family: "cookie" }
        : { name: i.name, qty: i.qty, price: i.price, family: null }),
      cookies: s.cookies ? { qty: s.cookies.qty, total: s.cookies.total } : null,
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

  return { version: d.version, products, sales, expenses, cookiePricing, dropped };
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
    `Fichier du ${when} : ${d.sales.length} vente(s), ${d.expenses.length} dépense(s)` +
    (d.dropped ? ` (${d.dropped} entrée(s) invalide(s) ignorée(s))` : "") + `. ` +
    `Cet appareil : ${state.sales.length} vente(s), ${state.expenses.length} dépense(s).`;
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
    state.sales.push(...newSales);
    state.expenses.push(...newExp);
    if ($("restore-cat").checked) { state.products = inc.products; state.cookiePricing = inc.cookiePricing; }
    msg = `✔ Fusion : +${newSales.length} vente(s), +${newExp.length} dépense(s)`;
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
window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  state = load();
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

/* ---------- Démarrage ---------- */
loadCart();
renderPay();
renderAll();
renderBackupBar();
