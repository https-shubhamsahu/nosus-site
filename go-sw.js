// NO SUS Chat installed on a computer (<handle>.nosus.foo, go.webmanifest):
// the share target. Chrome and Edge list the installed page in the computer's
// Share menu; what is shared arrives here as a POST, which a static site can't
// take. It is kept in this browser's IndexedDB (src/lib/goShare.ts reads the
// same store), the page opens, and it goes to the chat once the phone
// connects. Nothing else is handled here: every other request goes to the
// network as if there were no service worker, so a stale page can't stick.

const DB = "nosus-go-share";
const STORE = "shares";
const KEY = "pending";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function keep(share) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get = store.get(KEY);
    get.onsuccess = () => {
      // A second share before the first was sent joins it.
      const had = get.result;
      const files = [...(had?.files ?? []), ...share.files].slice(0, 20);
      const text = [had?.text, share.text].filter(Boolean).join("\n");
      store.put({ at: Date.now(), files, text }, KEY);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share-to-chat") return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll("files").filter((f) => f instanceof File && f.size > 0);
        const text = ["title", "text", "url"]
          .map((k) => form.get(k))
          .filter((v) => typeof v === "string" && v.trim())
          .join("\n")
          .slice(0, 20000);
        if (files.length > 0 || text) await keep({ files, text });
        // An open, connected window of this page can send it at once.
        new BroadcastChannel(DB).postMessage("shared");
      } catch {
        // Nothing kept: the page opens and shows no waiting share.
      }
      return Response.redirect("/#shared", 303);
    })(),
  );
});
