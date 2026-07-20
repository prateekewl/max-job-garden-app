const CACHE_NAME = "max-job-garden-v20260720-11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./bootstrap.js",
  "./styles.css",
  "./app.js",
  "./core.js",
  "./pdf.js",
  "./demo-data.js",
  "./manifest.webmanifest",
  "./assets/garden-mark.svg",
  "./assets/garden-mark-192.png",
  "./assets/garden-mark-512.png",
  "./assets/garden-companions.jpg",
  "./assets/jspdf.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/jobs.json")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("./jobs.json", response.clone()));
          return response;
        })
        .catch(() => caches.match("./jobs.json"))
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SHOW_NOTIFICATION") return;
  const { title, body, url } = event.data;
  event.waitUntil(
    self.registration.showNotification(title || "Max's Job Garden", {
      body: body || "A new role is ready to review.",
      icon: "./assets/garden-mark-192.png",
      badge: "./assets/garden-mark-192.png",
      data: { url: url || "./#view=discover" },
      tag: event.data.tag || "job-garden-update",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) return existing.focus().then(() => existing.navigate(target));
      return self.clients.openWindow(target);
    })
  );
});
