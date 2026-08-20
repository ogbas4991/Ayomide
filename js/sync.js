/* Ayomide Studio — cloud sync client (works with server/index.js — your own deployment) */
import { $, toast, emit, on, fmtBytes, randomHex, deriveKey, encryptBlob, decryptBlob } from './utils.js';
import { kvGet, kvSet, allFiles, putFileRec, allChat, putChatRow } from './db.js';

let cfg = null;
let syncing = false;
let autoTimer = null;
let e2eeKey = null; // CryptoKey when E2EE is active this session
const MAX_SYNC_FILE = 100 * 1024 * 1024; // 100MB

async function api(path, opts = {}, { raw = false } = {}) {
  const base = (cfg.url || '').replace(/\/+$/, '');
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      ...(opts.body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {}),
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) throw new Error('Session expired — sign in again');
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { }
    throw new Error(msg);
  }
  return res;
}

export async function initSyncUI() {
  cfg = await kvGet('sync', {});
  if (cfg.url) $('#sync-url').value = cfg.url;
  else if (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http') && !window.location.hostname.endsWith('github.io')) {
    $('#sync-url').value = window.location.origin; // when the app is served by its own sync server
  }
  if (cfg.email) $('#sync-email').value = cfg.email;
  updateState();

  $('#sync-signin').addEventListener('click', () => auth(false));
  $('#sync-register').addEventListener('click', () => auth(true));
  $('#sync-out').addEventListener('click', async () => {
    cfg = { url: cfg.url };
    await kvSet('sync', cfg);
    updateState();
    toast('Signed out of sync', 'ok');
  });
  $('#sync-now').addEventListener('click', () => syncNow(false));

  // auto-sync (debounced) whenever local data changes
  on('files:changed', () => {
    if (!cfg?.token || !navigator.onLine) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => syncNow(true), 8000);
  });
  if (cfg?.token && navigator.onLine) setTimeout(() => syncNow(true), 1500);
}

async function auth(register) {
  const url = $('#sync-url').value.trim();
  const email = $('#sync-email').value.trim();
  const password = $('#sync-pass').value;
  if (!url || !email || !password) { toast('Fill in server URL, email and password.', 'warn'); return; }
  if (password.length < 6) { toast('Password must be at least 6 characters.', 'warn'); return; }
  const prev = cfg;
  cfg = { url, email, token: null, lastSync: null };
  try {
    const res = await api('/api/auth/' + (register ? 'register' : 'login'), {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    cfg.token = data.token;
    await kvSet('sync', cfg);
    $('#sync-pass').value = '';
    updateState();
    toast(register ? 'Account created 🎉' : 'Signed in ✅', 'ok');
    await syncNow(false);
  } catch (err) {
    cfg = prev;
    toast((register ? 'Sign-up failed: ' : 'Sign-in failed: ') + err.message, 'error', 6000);
  }
}

function updateState() {
  const on = !!(cfg?.token);
  $('#sync-badge').textContent = on ? (cfg.email || 'On') : 'Off';
  $('#sync-badge').classList.toggle('ext', on);
  $('#sync-now').hidden = !on;
  $('#sync-out').hidden = !on;
  $('#sync-signin').hidden = on;
  $('#sync-register').hidden = on;
  $('#sync-status').textContent = on
    ? `Signed in as ${cfg.email} · last sync ${cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'never'}`
    : 'Not connected.';
}

/* ---- E2EE (server only ever stores ciphertext) ---- */
export async function setE2EE(on, passphrase, remember) {
  cfg = cfg || await kvGet('sync', {}) || {};
  if (!on) {
    delete cfg.enc;
    e2eeKey = null;
    await kvSet('sync', cfg);
    toast('End-to-end encryption disabled for sync', 'info');
    return;
  }
  if (!passphrase || passphrase.length < 6) { toast('Sync passphrase must be at least 6 characters.', 'warn'); return; }
  const enc = { salt: cfg.enc?.salt || randomHex(16) };
  const key = await deriveKey(passphrase, enc.salt);
  if (remember) {
    enc.jwk = await crypto.subtle.exportKey('jwk', key); // convenience — protected by device access
  }
  cfg.enc = enc;
  e2eeKey = key;
  await kvSet('sync', cfg);
  toast('End-to-end encryption enabled 🔐 — the server will only ever store ciphertext.', 'ok', 5000);
}

async function ensureE2EEKey() {
  if (!cfg?.enc) return null;
  if (e2eeKey) return e2eeKey;
  if (cfg.enc.jwk) {
    try {
      e2eeKey = await crypto.subtle.importKey('jwk', cfg.enc.jwk, 'AES-GCM', false, ['encrypt', 'decrypt']);
      return e2eeKey;
    } catch { return null; }
  }
  return null; // passphrase must be re-entered in Settings
}

export async function syncNow(silent = true) {
  if (!cfg?.token || syncing) return;
  if (!navigator.onLine) return;
  const eKey = cfg.enc ? await ensureE2EEKey() : null;
  if (cfg.enc && !eKey) {
    toast('Re-enter your sync passphrase: Settings → Cloud sync → passphrase field.', 'warn', 6000);
    $('#sync-status').textContent = 'E2EE passphrase needed — enter it in Settings.';
    return;
  }
  syncing = true;
  let pushed = 0, pulled = 0, chats = 0, skipped = 0;
  try {
    const [localFiles, remoteRes] = await Promise.all([
      allFiles(),
      api('/api/files').then((r) => r.json())
    ]);
    const remote = new Map((remoteRes.files || []).map((f) => [f.id, f]));

    // push newer local files
    for (const lf of localFiles) {
      const rf = remote.get(lf.id);
      if (rf && (rf.updated || 0) >= (lf.updated || lf.addedAt || 0)) continue;
      if ((lf.size || 0) > MAX_SYNC_FILE) { skipped++; continue; }
      const q = new URLSearchParams({
        name: lf.name || 'file',
        type: lf.type || '',
        addedAt: String(lf.addedAt || Date.now()),
        updated: String(lf.updated || lf.addedAt || Date.now()),
        folder: lf.folder || 'root',
        tags: (lf.tags || []).join(','),
        vault: lf.vault ? '1' : '0',
        iv: lf.iv || ''
      });
      let body = lf.blob;
      if (eKey && !lf.vault) {
        const { blob: encBlob, ivHex } = await encryptBlob(lf.blob, eKey);
        body = encBlob;
        q.set('enc', '1');
        q.set('encIv', ivHex);
      }
      await api('/api/files/' + encodeURIComponent(lf.id) + '?' + q.toString(), {
        method: 'PUT',
        body
      }, { raw: true });
      pushed++;
    }

    // pull newer remote files
    for (const rf of remoteRes.files || []) {
      const lf = localFiles.find((f) => f.id === rf.id);
      if (lf && (lf.updated || lf.addedAt || 0) >= (rf.updated || 0)) continue;
      if (rf.enc && !eKey) { skipped++; continue; } // encrypted remotely, no key locally
      const res = await api('/api/files/' + encodeURIComponent(rf.id) + '/blob');
      let blob = await res.blob();
      if (rf.enc) {
        try { blob = await decryptBlob(blob, eKey, rf.encIv || ''); }
        catch { skipped++; continue; }
      }
      await putFileRec({
        id: rf.id,
        name: rf.name,
        type: rf.type,
        size: blob.size,
        addedAt: rf.addedAt,
        updated: rf.updated,
        folder: rf.folder || 'root',
        tags: rf.tags || [],
        hash: null,
        vault: !!rf.vault,
        iv: rf.iv || null,
        blob
      });
      pulled++;
    }

    // chat merge (union by id)
    const remoteChat = await api('/api/chat').then((r) => r.json());
    const remoteRows = remoteChat.rows || [];
    const localRows = await allChat();
    const localIds = new Set(localRows.map((r) => r.id));
    const remoteIds = new Set(remoteRows.map((r) => r.id));
    const toPush = localRows.filter((r) => !remoteIds.has(r.id));
    if (toPush.length) {
      await api('/api/chat', { method: 'PUT', body: JSON.stringify({ rows: toPush }) });
    }
    for (const r of remoteRows) {
      if (!localIds.has(r.id)) { await putChatRow(r); chats++; }
    }

    cfg.lastSync = Date.now();
    await kvSet('sync', cfg);
    updateState();
    emit('files:changed');
    if (!silent || pushed || pulled || chats) {
      toast(`Synced ☁️ — ${pushed} up, ${pulled} down, ${chats} chat in${skipped ? `, ${skipped} skipped (too big)` : ''}`, 'ok', 5000);
    }
  } catch (err) {
    if (!silent) toast('Sync failed: ' + err.message, 'error', 6000);
    $('#sync-status').textContent = 'Sync error: ' + err.message;
  } finally {
    syncing = false;
  }
}
