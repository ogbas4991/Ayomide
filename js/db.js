/* Ayomide Studio — IndexedDB layer (files, chat, threads, settings, share-in queue) */
import { uid } from './utils.js';

const DB_NAME = 'ayomide-studio';
const DB_VERSION = 2;
let _db = null;

function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      const v = req.transaction;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chat')) d.createObjectStore('chat', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('threads')) d.createObjectStore('threads', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('share-in')) d.createObjectStore('share-in', { keyPath: 'id' });
      // indexes
      const files = v.objectStore('files');
      if (!files.indexNames.contains('folder')) files.createIndex('folder', 'folder');
      const chat = v.objectStore('chat');
      if (!chat.indexNames.contains('threadId')) chat.createIndex('threadId', 'threadId');
      // migrate v1 rows
      if (req.result.version > 1 || true) {
        const cr = v.objectStore('chat').openCursor();
        cr.onsuccess = () => {
          const c = cr.result;
          if (!c) return;
          const row = c.value;
          if (!row.threadId) { row.threadId = 'default'; c.update(row); }
          c.continue();
        };
        const fr = v.objectStore('files').openCursor();
        fr.onsuccess = () => {
          const c = fr.result;
          if (!c) return;
          const row = c.value;
          if (!row.folder) row.folder = 'root';
          if (!row.tags) row.tags = [];
          c.update(row);
        };
        v.objectStore('threads').put({ id: 'default', title: 'Chat', updatedAt: Date.now() });
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    fn(s);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  }));
}

function reqToPromise(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function store(storeName) {
  return db().then((d) => d.transaction(storeName).objectStore(storeName));
}

/* ---------- files ---------- */
export async function addFile(blob, name, meta = {}) {
  const rec = {
    id: meta.id || uid(),
    name: name || 'file',
    type: blob.type || meta.type || '',
    size: blob.size,
    addedAt: Date.now(),
    updated: Date.now(),
    folder: meta.folder || 'root',
    tags: meta.tags || [],
    hash: meta.hash || null,
    vault: false,
    iv: null,
    blob,
    ...meta,
    blob, // ensure blob always the given blob (meta cannot override)
    size: blob.size
  };
  await tx('files', 'readwrite', (s) => s.put(rec));
  return rec;
}

export async function putFileRec(rec) {
  await tx('files', 'readwrite', (s) => s.put(rec));
}

export const getFile = (id) => store('files').then((s) => reqToPromise(s.get(id)));

export async function allFiles() {
  return store('files').then((s) => reqToPromise(s.getAll()))
    .then((rows) => (rows || []).sort((a, b) => b.addedAt - a.addedAt));
}

export async function updateFile(id, patch) {
  const rec = await getFile(id);
  if (!rec) return null;
  Object.assign(rec, patch, { updated: Date.now() });
  await tx('files', 'readwrite', (s) => s.put(rec));
  return rec;
}

export const deleteFile = (id) => tx('files', 'readwrite', (s) => s.delete(id));
export const clearFiles = () => tx('files', 'readwrite', (s) => s.clear());

/* ---------- threads ---------- */
export async function allThreads() {
  return store('threads').then((s) => reqToPromise(s.getAll()))
    .then((rows) => (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
}
export const putThread = (t) => tx('threads', 'readwrite', (s) => s.put(t));
export const getThread = (id) => store('threads').then((s) => reqToPromise(s.get(id)));
export const deleteThread = (id) => tx('threads', 'readwrite', (s) => s.delete(id));

/* ---------- chat ---------- */
export async function addChat(msg) {
  const row = { id: msg.id || uid(), ts: Date.now(), threadId: msg.threadId || 'default', ...msg };
  await tx('chat', 'readwrite', (s) => s.put(row));
  const t = await getThread(row.threadId);
  await putThread({ id: row.threadId, title: t?.title || 'Chat', updatedAt: Date.now() });
  return row;
}
export const putChatRow = (row) => tx('chat', 'readwrite', (s) => s.put(row));
export const allChat = (threadId = null) => {
  if (threadId === null) {
    return store('chat').then((s) => reqToPromise(s.getAll()))
      .then((rows) => (rows || []).sort((a, b) => a.ts - b.ts));
  }
  return store('chat').then((s) => reqToPromise(s.index('threadId').getAll(threadId)))
    .then((rows) => (rows || []).sort((a, b) => a.ts - b.ts));
};
export const clearChat = () => tx('chat', 'readwrite', (s) => s.clear());
export const deleteChatRow = (id) => tx('chat', 'readwrite', (s) => s.delete(id));

/* ---------- kv settings ---------- */
export async function kvGet(key, def = null) {
  const row = await store('kv').then((s) => reqToPromise(s.get(key)));
  return row ? row.value : def;
}
export const kvSet = (key, value) => tx('kv', 'readwrite', (s) => s.put({ key, value }));

/* ---------- share-in queue (written by service worker) ---------- */
export async function drainShareIn() {
  const rows = await store('share-in').then((s) => reqToPromise(s.getAll()));
  if (rows?.length) await tx('share-in', 'readwrite', (s) => s.clear());
  return rows || [];
}

/* ---------- storage estimate ---------- */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
