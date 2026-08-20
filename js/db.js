/* Ayomide Studio — IndexedDB layer (files, chat, settings) */
import { uid } from './utils.js';

const DB_NAME = 'ayomide-studio';
const DB_VERSION = 1;
let _db = null;

function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chat')) d.createObjectStore('chat', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && out._v !== undefined ? out._v : out);
    t.onerror = () => rej(t.error);
  }));
}

function reqToPromise(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/* ---------- files ---------- */
export async function addFile(blob, name, meta = {}) {
  const rec = {
    id: uid(),
    name: name || 'file',
    type: blob.type || meta.type || '',
    size: blob.size,
    addedAt: Date.now(),
    blob,
    ...meta
  };
  await tx('files', 'readwrite', (s) => s.put(rec));
  return rec;
}

export async function getFile(id) {
  return db().then((d) => reqToPromise(d.transaction('files').objectStore('files').get(id)));
}

export async function allFiles() {
  return db().then((d) => reqToPromise(d.transaction('files').objectStore('files').getAll()))
    .then((rows) => (rows || []).sort((a, b) => b.addedAt - a.addedAt));
}

export async function updateFile(id, patch) {
  const rec = await getFile(id);
  if (!rec) return null;
  Object.assign(rec, patch);
  await tx('files', 'readwrite', (s) => s.put(rec));
  return rec;
}

export async function deleteFile(id) {
  await tx('files', 'readwrite', (s) => s.delete(id));
}

export async function clearFiles() {
  await tx('files', 'readwrite', (s) => s.clear());
}

/* ---------- chat ---------- */
export async function addChat(msg) {
  const row = { id: uid(), ts: Date.now(), ...msg };
  await tx('chat', 'readwrite', (s) => s.put(row));
  return row;
}

export async function allChat() {
  return db().then((d) => reqToPromise(d.transaction('chat').objectStore('chat').getAll()))
    .then((rows) => (rows || []).sort((a, b) => a.ts - b.ts));
}

export async function clearChat() {
  await tx('chat', 'readwrite', (s) => s.clear());
}

/* ---------- kv settings ---------- */
export async function kvGet(key, def = null) {
  const row = await db().then((d) => reqToPromise(d.transaction('kv').objectStore('kv').get(key)));
  return row ? row.value : def;
}

export async function kvSet(key, value) {
  await tx('kv', 'readwrite', (s) => s.put({ key, value }));
}

/* ---------- storage estimate ---------- */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
