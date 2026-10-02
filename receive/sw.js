// A standalone scope: never intercept Burn URLs, API calls or the main site.
const CACHE='nosus-receive-8303bf508bdee7c0';
const FILES=['./','./index.html','./style.css','./theme.js','./geist-400.woff2','./geist-700.woff2','./protocol.mjs','./receive.mjs','./vendor.mjs'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(FILES);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('nosus-receive-')&&k!==CACHE)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url), scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||u.origin!==scope.origin||u.search||!FILES.some(f=>new URL(f,scope).pathname===u.pathname))return;
  event.respondWith((async()=>{const c=await caches.open(CACHE);const saved=await c.match(event.request,{ignoreSearch:false});return saved||fetch(event.request);})());
});
self.addEventListener('message',event=>{if(event.data==='check-ready')event.waitUntil((async()=>{const c=await caches.open(CACHE);const checks=await Promise.all(FILES.map(f=>c.match(new URL(f,self.registration.scope).href)));event.ports[0]?.postMessage(checks.every(Boolean));})());});
