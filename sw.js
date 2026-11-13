"use strict";

/* Service worker : permet l'utilisation hors ligne (marché sans réseau).
 *
 * IMPORTANT — à CHAQUE modification de l'appli (index.html, style.css, app.js, logo, icônes…),
 * changer le numéro dans version.js (et non ici). C'est ce changement qui déclenche la mise à jour sur les téléphones.
 * Tout nouveau fichier de l'appli doit aussi être ajouté à la liste ASSETS ci-dessous.
 */
importScripts("version.js");                 // définit APP_VERSION (source unique du numéro de version)
const CACHE = "caisse-v" + APP_VERSION;
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "version.js",
  "app.js",
  "db.js",
  "sync.js",
  "logo.png",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

/* Installation : on télécharge tous les fichiers d'un coup dans un cache neuf (tout ou rien). */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

/* Activation : suppression des anciennes versions du cache. */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("caisse-v") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Les fichiers de l'appli sont servis depuis le cache (rapide et hors ligne) ; le reste passe par le réseau. */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) =>
      hit || fetch(req).catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
    )
  );
});
