const CACHE = "contas-v3";
const SHELL = ["./", "index.html", "config.js", "manifest.json", "icon-180.png", "icon-192.png", "icon-512.png"];
const EXTRA = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap"
];
const CDN = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await Promise.all(EXTRA.map(u => c.add(new Request(u, { mode: "cors" })).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Arquivos do app: tenta a internet primeiro (pega atualizações), cai no cache se estiver offline.
// Bibliotecas e fontes: cache primeiro.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.host === self.location.host;
  if (!own && !CDN.includes(url.host)) return; // Firestore e login passam direto
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (own) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(req, { signal: ctrl.signal, cache: "no-cache" });
        clearTimeout(t);
        if (r && r.ok) c.put(req, r.clone());
        return r;
      } catch (err) {
        const hit = await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") return (await c.match("index.html")) || (await c.match("./")) || Response.error();
        return Response.error();
      }
    }
    const hit = await c.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone());
      return r;
    } catch (err) { return Response.error(); }
  })());
});
