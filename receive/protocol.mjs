// Device Burn protocol 1. Keep the Dart implementation and wire vectors in step.
export const LIMIT = 25 * 1024 * 1024;
export const CHUNK = 16 * 1024;
export const DOMAIN = 'nosus-device/1';
const utf8 = new TextEncoder();
export const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function unb64(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw Error('Invalid connection encoding');
  return Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
}
export const randomId = () => b64(crypto.getRandomValues(new Uint8Array(16)));
export const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
export const canonical = value => JSON.stringify(value, Object.keys(value).sort());
export function validateSignal(s, role, now = Date.now()) {
  if (!s || s.v !== 1 || s.role !== role || !/^[A-Za-z0-9_-]{22}$/.test(s.sid) ||
      !Number.isSafeInteger(s.expires) || s.expires < now || s.expires > now + 16 * 60000 ||
      typeof s.pub !== 'string' || unb64(s.pub).length !== 65 || unb64(s.pub)[0] !== 4 ||
      typeof s.sdp !== 'string' || s.sdp.length > 24000 || !s.sdp.startsWith('v=0')) throw Error('Invalid or expired connection details');
  return s;
}
export async function encodeSignal(signal) {
  validateSignal(signal, signal.role);
  const raw = utf8.encode(canonical(signal));
  const zipped = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return `NS1.${b64(zipped)}.${b64((await digest(zipped)).slice(0, 6))}`;
}
export async function decodeSignal(text, role) {
  const parts = text.replace(/\s/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== 'NS1' || text.length > 40000) throw Error('Invalid connection details');
  const zipped = unb64(parts[1]);
  if (b64((await digest(zipped)).slice(0, 6)) !== parts[2]) throw Error('Connection text has a typing error');
  const stream = new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader(); let length = 0; const chunks = [];
  for (;;) { const {value, done} = await reader.read(); if (done) break; length += value.length;
    if (length > 32000) { await reader.cancel(); throw Error('Connection details too large'); } chunks.push(value); }
  const raw = new Uint8Array(length); let at = 0; for (const c of chunks) { raw.set(c, at); at += c.length; }
  return validateSignal(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)), role);
}
export async function makeKey() {
  const key = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
  return {privateKey:key.privateKey, pub:b64(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey)))};
}
export async function derive(privateKey, offer, answer, now = Date.now()) {
  validateSignal(offer, 'offer', now); validateSignal(answer, 'answer', now);
  if (offer.sid !== answer.sid || offer.expires !== answer.expires) throw Error('Response belongs to another session');
  const transcript = utf8.encode(`${DOMAIN}\n${canonical(offer)}\n${canonical(answer)}`);
  const salt = await digest(transcript);
  const other = privateKey.role === 'offer' ? answer.pub : offer.pub;
  const pub = await crypto.subtle.importKey('raw', unb64(other), {name:'ECDH', namedCurve:'P-256'}, false, []);
  const z = await crypto.subtle.deriveBits({name:'ECDH', public:pub}, privateKey.key, 256);
  const hk = await crypto.subtle.importKey('raw', z, 'HKDF', false, ['deriveBits']);
  const material = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt, info:utf8.encode(DOMAIN)}, hk, 544));
  const code = String(new DataView(material.buffer).getUint32(64) % 1000000).padStart(6, '0');
  return {keys:[material.slice(0,32), material.slice(32,64)], code, salt};
}
function nonce(d, seq) { const n = new Uint8Array(12); const v = new DataView(n.buffer); v.setUint32(0,d); v.setBigUint64(4,BigInt(seq)); return n; }
export class Cipher {
  constructor(material, direction) { this.material = material; this.direction = direction; this.sent = 0; this.received = 0; }
  async box(value) {
    const seq = ++this.sent, d = this.direction;
    const key = await crypto.subtle.importKey('raw', this.material.keys[d], 'AES-GCM', false, ['encrypt']);
    const c = await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce(d,seq), additionalData:this.material.salt},key,utf8.encode(JSON.stringify(value)));
    return {d,seq,c:b64(new Uint8Array(c))};
  }
  async open(wire) {
    if (wire.d !== 1-this.direction || wire.seq !== this.received+1 || typeof wire.c !== 'string' || wire.c.length > 40000) throw Error('Invalid or repeated message');
    const key = await crypto.subtle.importKey('raw', this.material.keys[wire.d], 'AES-GCM', false, ['decrypt']);
    const raw = await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce(wire.d,wire.seq),additionalData:this.material.salt},key,unb64(wire.c));
    const result = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); this.received = wire.seq; return result;
  }
  clear() { for (const k of this.material.keys) k.fill(0); this.material.salt.fill(0); }
}
export function validBurnLink(link) {
  try { const u = new URL(link); return u.origin === 'https://app.nosus.foo' && /^#\/(burn|burnfile|burnfiles)\/[a-f0-9,-]+\?k=[a-f0-9,]+&v=[a-f0-9,]+$/.test(u.hash); } catch { return false; }
}
// Ordered data-channel delivery; all crypto operations are serialized by the caller.
export class Transfer {
  constructor(send, changed = () => {}) {
    this.send = send; this.changed = changed; this.localConfirmed = false; this.remoteConfirmed = false;
    this.pending = new Map(); this.outgoing = new Map(); this.seen = new Set(); this.total = 0; this.progress = 0;
  }
  get connected() { return this.localConfirmed && this.remoteConfirmed; }
  async confirm() { if(this.localConfirmed)return; await this.send({t:'confirm'}); this.localConfirmed = true; this.changed(); }
  async receive(m) {
    if (m.t === 'confirm') { this.remoteConfirmed = true; this.changed(); return; }
    if (!this.connected) throw Error('Confirm both devices before sharing');
    if (m.t === 'consumed' || m.t === 'ready') {
      const out = this.outgoing.get(m.id); if (!out) throw Error('Unknown receipt');
      out.state = m.t; if (m.t === 'consumed') { out.bytes.fill(0); out.bytes = new Uint8Array(); } this.changed(); return;
    }
    if (m.t === 'meta') {
      if (!/^[A-Za-z0-9_-]{22}$/.test(m.id) || this.seen.has(m.id) || this.pending.has(m.id) || this.pending.size >= 10 ||
          !['text','file','link'].includes(m.kind) || !Number.isSafeInteger(m.size) || m.size < 1 || m.size+this.total > LIMIT ||
          typeof m.name !== 'string' || m.name.length > 255 || typeof m.hash !== 'string' || unb64(m.hash).length !== 32) throw Error('Invalid or repeated transfer');
      this.pending.set(m.id,{...m, bytes:new Uint8Array(m.size), received:0, state:'sending'}); this.total += m.size; this.changed(); return;
    }
    const p = this.pending.get(m.id); if (!p) throw Error('Unknown transfer');
    if (m.t === 'chunk') {
      const bytes = unb64(m.data); if (p.state !== 'sending' || m.offset !== p.received || bytes.length < 1 || bytes.length > CHUNK || p.received+bytes.length > p.size) throw Error('Invalid file chunk');
      p.bytes.set(bytes,p.received); p.received += bytes.length; this.changed(); return;
    }
    if (m.t === 'end') {
      if (p.state !== 'sending' || p.received !== p.size || b64(await digest(p.bytes)) !== p.hash) throw Error('Transfer integrity check failed');
      if (p.kind === 'text' && new TextDecoder('utf-8',{fatal:true}).decode(p.bytes).length > 50000) throw Error('Text too long');
      if (p.kind === 'link' && !validBurnLink(new TextDecoder().decode(p.bytes))) throw Error('Invalid Burn link');
      p.state='ready'; await this.send({t:'ready',id:m.id}); this.changed(); return;
    }
    throw Error('Invalid transfer message');
  }
  async deliver(kind, name, bytes) {
    if (!this.connected) throw Error('Confirm both devices first');
    const alive = [...this.outgoing.values()].filter(p=>p.state!=='consumed');
    if (alive.length >= 10 || !bytes.length || alive.reduce((n,p)=>n+p.bytes.length,0)+bytes.length > LIMIT) throw Error('Transfer limit reached; finish pending items first');
    if (kind === 'text' && new TextDecoder().decode(bytes).length > 50000) throw Error('Text too long');
    const id=randomId(); this.outgoing.set(id,{id,name,bytes,state:'sending'}); this.changed();
    await this.send({t:'meta',id,kind,name,size:bytes.length,hash:b64(await digest(bytes))});
    for (let offset=0;offset<bytes.length;offset+=CHUNK) { await this.send({t:'chunk',id,offset,data:b64(bytes.subarray(offset,offset+CHUNK))}); this.progress = Math.min(offset+CHUNK,bytes.length)/bytes.length; this.changed(); }
    await this.send({t:'end',id}); return id;
  }
  async consume(id) {
    const p = this.pending.get(id); if (!p || p.state !== 'ready') throw Error('Already consumed or not ready');
    // Mark before any async work so a double-click cannot reveal twice.
    p.state='consumed'; this.pending.delete(id); this.seen.add(id); this.total-=p.size;
    const bytes=p.bytes.slice(); p.bytes.fill(0);
    try { await this.send({t:'consumed',id}); } catch { this.receiptUncertain=true; }
    this.changed(); return {...p,bytes};
  }
  clear() { for (const p of this.pending.values()) p.bytes.fill(0); for (const p of this.outgoing.values()) p.bytes.fill(0); this.pending.clear(); this.outgoing.clear(); this.seen.clear(); this.total=0; this.localConfirmed=false; this.remoteConfirmed=false; }
}
