/* Ayomide Studio — app shell: nav, tools, theme, i18n, lock screen, PWA, SW, settings, sync */
import { $, $$, on, emit, toast, modal, confirmDialog, fmtBytes, sha256Hex } from './utils.js';
import * as chat from './chat.js';
import * as files from './files.js';
import * as editor from './editor.js';
import * as video from './video.js';
import * as tools from './tools.js';
import { init as initPalette } from './palette.js';
import { initI18n, setLang, LANGS, t } from './i18n.js';
import { initBranding } from './branding.js';
import { clearChat, clearFiles, kvGet, kvSet, storageEstimate, drainShareIn } from './db.js';
import { exportEverything } from './exporter.js';
import { lockConfig, setupLock, disableLock, verifyPin, unlockVault, vaultReady } from './vault.js';
import { initSyncUI, setE2EE } from './sync.js';

const TITLES = {
  chat: 'nav.chat', files: 'files.title', editor: 'editor.title', video: 'video.title',
  tools: 'tools.title', settings: 'settings.title'
};

const ACCENTS = {
  violet: ['#7c5cff', '#22d3ee'],
  ocean: ['#0ea5e9', '#34d399'],
  sunset: ['#f97316', '#f43f5e'],
  pink: ['#ec4899', '#8b5cf6'],
  green: ['#22c55e', '#22d3ee'],
  gold: ['#f59e0b', '#f97316']
};

let deferredPrompt = null;
let swReg = null;
let reloading = false;
let appUnlocked = false;
let themeCfg = { mode: 'dark', accent: 'violet' };

/* ---------- navigation ---------- */
function nav(tab) {
  if (!TITLES[tab]) return;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view-title').textContent = '~/' + tab;
}

/* ---------- boot ---------- */
async function boot() {
  await Promise.all([chat.init(), files.init(), editor.init(), video.init(), tools.init()]);
  nav('chat');

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => nav(b.dataset.tab)));
  on('nav', (tab) => nav(tab));
  on('open-editor-with', async ({ id }) => { nav('editor'); await editor.loadFileId(id); });
  on('open-video-with', async ({ ids }) => { nav('video'); await video.addFileIds(ids); });
  on('files:changed', updateStorage);
  on('op', (name) => {
    if (name === 'toggle-theme') { themeCfg.mode = (document.documentElement.dataset.theme === 'light') ? 'dark' : 'light'; applyTheme(); saveTheme(); }
    if (name === 'lock') { if (lockConfig()) location.reload(); else toast('Enable app lock first (Settings → Security).', 'warn'); }
  });

  await initI18n();
  await initTheme();
  initAppearanceUI();
  initPalette();
  await initBranding();

  await initLock();
  initSecurity();
  initSettings();
  initInstall();
  initSW();
  initNet();
  initShareIn();
  initLaunchQueue();
  await initSyncUI();
  updateStorage();

  // deep link (#chat / #video / #tools)
  const hash = (window.location?.hash || '').replace('#', '');
  if (TITLES[hash]) nav(hash);
}
boot();

/* ---------- theme ---------- */
function resolveMode() {
  if (themeCfg.mode !== 'auto') return themeCfg.mode;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme() {
  const mode = resolveMode();
  document.documentElement.dataset.theme = mode;
  const [a, b] = ACCENTS[themeCfg.accent] || ACCENTS.violet;
  document.documentElement.style.setProperty('--acc', a);
  document.documentElement.style.setProperty('--acc2', b);
  document.documentElement.style.setProperty('--grad', `linear-gradient(135deg, ${a}, ${b})`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === 'light' ? '#f2f4fa' : '#0b0d14';
}

async function saveTheme() {
  await kvSet('theme', { ...themeCfg });
}

async function initTheme() {
  themeCfg = { mode: 'dark', accent: 'violet', ...(await kvGet('theme', {})) };
  applyTheme();
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (themeCfg.mode === 'auto') applyTheme();
  });
}

function initAppearanceUI() {
  $('#theme-mode').value = themeCfg.mode;
  $('#theme-mode').addEventListener('change', async (e) => {
    themeCfg.mode = e.target.value;
    applyTheme();
    await saveTheme();
  });

  const sw = $('#accent-swatches');
  sw.innerHTML = '';
  Object.entries(ACCENTS).forEach(([name, [a]]) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (themeCfg.accent === name ? ' active' : '');
    b.style.background = a;
    b.title = name;
    b.addEventListener('click', async () => {
      themeCfg.accent = name;
      applyTheme();
      await saveTheme();
      [...sw.children].forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
    });
    sw.appendChild(b);
  });

  const langSel = $('#lang-select');
  LANGS.forEach((l) => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.label;
    langSel.appendChild(o);
  });
  langSel.value = (LANGS.find((l) => l.id === document.documentElement.lang) || LANGS[0]).id;
  langSel.addEventListener('change', () => setLang(langSel.value));

  // E2EE wiring
  const e2eeOn = $('#e2ee-on');
  e2eeOn.addEventListener('change', () => { $('#e2ee-fields').hidden = !e2eeOn.checked; });
  $('#e2ee-pass').addEventListener('change', async () => {
    if (!e2eeOn.checked) return;
    await setE2EE(true, $('#e2ee-pass').value, $('#e2ee-remember').checked);
    $('#e2ee-pass').value = '';
  });
  e2eeOn.addEventListener('change', async () => {
    if (!e2eeOn.checked) await setE2EE(false, null, false);
    else if (!$('#e2ee-pass').value) toast('Enter a sync passphrase to activate encryption.', 'info', 5000);
  });
}

/* ---------- lock screen ---------- */
async function initLock() {
  const cfg = await lockConfig();
  if (!cfg) return;
  $('#lock-screen').hidden = false;
  $('#lock-biometric').hidden = !cfg.credId;
  const pinInput = $('#lock-pin');
  pinInput.focus();

  const tryUnlock = async () => {
    const pin = pinInput.value;
    if (!(await verifyPin(pin))) {
      pinInput.value = '';
      const box = document.querySelector('.lock-box');
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      toast('Wrong PIN', 'error');
      return;
    }
    try {
      await unlockVault(pin);
      toast(vaultReady() ? 'Unlocked — vault ready 🔓' : 'Unlocked', 'ok');
    } catch { toast('Unlocked (vault key failed)', 'warn'); }
    doUnlock();
  };

  const doUnlock = () => {
    appUnlocked = true;
    $('#lock-screen').hidden = true;
    pinInput.value = '';
  };

  $('#lock-unlock').addEventListener('click', tryUnlock);
  pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

  $('#lock-biometric').addEventListener('click', async () => {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.get({
        publicKeyKey: undefined,
        publicKey: {
          challenge,
          userVerification: 'preferred',
          allowCredentials: [{
            type: 'public-key',
            id: Uint8Array.from(cfg.credId.match(/../g).map((h) => parseInt(h, 16)))
          }],
          timeout: 60000
        }
      });
      toast('Unlocked with biometrics 👆 (enter your PIN once in Settings to open Vault files this session)', 'ok', 6000);
      doUnlock();
    } catch {
      toast('Biometric unlock failed — use your PIN.', 'error');
    }
  });
}

function initSecurity() {
  refreshSecurityButtons();

  $('#lock-setup').addEventListener('click', () => {
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="muted">Pick a PIN (4+ digits). It unlocks the app and encrypts Vault files (AES-256).
      Don't forget it — the Vault can't be opened without it.</p>
      <label class="field">PIN <input id="pin1" type="password" inputmode="numeric" autocomplete="off"></label>
      <label class="field">Repeat PIN <input id="pin2" type="password" inputmode="numeric" autocomplete="off"></label>`;
    modal({
      title: '🔐 Enable app lock & vault',
      body,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: 'Enable', cls: 'primary', onClick: async (close) => {
            const p1 = body.querySelector('#pin1').value;
            const p2 = body.querySelector('#pin2').value;
            if (!/^\d{4,12}$/.test(p1)) { toast('PIN must be 4–12 digits.', 'warn'); return; }
            if (p1 !== p2) { toast('PINs do not match.', 'warn'); return; }
            await setupLock(p1);
            await unlockVault(p1).catch(() => { });
            close();
            refreshSecurityButtons();
            toast('App lock & Vault enabled 🔐 — use the 🔒 button on any file card to encrypt it.', 'ok', 6000);
          }
        }
      ]
    });
  });

  $('#lock-disable').addEventListener('click', async () => {
    const cfg = await lockConfig();
    if (!cfg) return;
    const body = document.createElement('div');
    body.innerHTML = `<label class="field">Enter your PIN to disable the lock
      <input id="pinv" type="password" inputmode="numeric"></label>`;
    modal({
      title: 'Disable app lock',
      body,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: 'Disable', cls: 'danger', onClick: async (close) => {
            const pin = body.querySelector('#pinv').value;
            if (!(await verifyPin(pin))) { toast('Wrong PIN', 'error'); return; }
            await disableLock();
            close();
            refreshSecurityButtons();
            toast('Lock disabled. Vault files remain encrypted — restore them before they can be opened.', 'warn', 6000);
          }
        }
      ]
    });
  });

  $('#lock-bio-setup').addEventListener('click', async () => {
    const cfg = await lockConfig();
    if (!cfg) { toast('Enable the lock first.', 'warn'); return; }
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Ayomide Studio' },
          user: {
            id: new TextEncoder().encode('ayomide-user'),
            name: 'Ayomide Studio user',
            displayName: 'Ayomide Studio user'
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred' },
          timeout: 60000
        }
      });
      cfg.credId = [...new Uint8Array(cred.rawId)].map((b) => b.toString(16).padStart(2, '0')).join('');
      await kvSet('lock', cfg);
      toast('Fingerprint / Face ID unlock added 👆', 'ok');
    } catch (err) {
      toast('Biometric setup failed: ' + (err.message || 'not supported here'), 'error', 6000);
    }
  });

  $('#btn-lock-now').addEventListener('click', () => location.reload());
}

async function refreshSecurityButtons() {
  const cfg = await lockConfig();
  $('#lock-disable').hidden = !cfg;
  $('#lock-bio-setup').hidden = !cfg;
  $('#btn-lock-now').hidden = !cfg;
  $('#lock-setup').hidden = !!cfg;
}

/* ---------- settings ---------- */
async function initSettings() {
  const cfg = await kvGet('ai', {});
  $('#ai-enabled').checked = !!cfg.enabled;
  $('#ai-url').value = cfg.url || '';
  $('#ai-key').value = cfg.key || '';
  $('#ai-model').value = cfg.model || '';
  updateAIBadge(cfg);

  $('#ai-save').addEventListener('click', async () => {
    await kvSet('ai', {
      enabled: $('#ai-enabled').checked,
      url: $('#ai-url').value.trim(),
      key: $('#ai-key').value.trim(),
      model: $('#ai-model').value.trim()
    });
    updateAIBadge(await kvGet('ai', {}));
    toast('AI settings saved ✅', 'ok');
  });

  $('#ai-test').addEventListener('click', async () => {
    const cfg = {
      enabled: true,
      url: $('#ai-url').value.trim(),
      key: $('#ai-key').value.trim(),
      model: $('#ai-model').value.trim()
    };
    if (!cfg.url || !cfg.key) { toast('Enter a Base URL and API key first.', 'warn'); return; }
    toast('Testing connection…');
    try {
      const out = await chat.testAI(cfg);
      toast(`Connection OK — model replied: “${out}”`, 'ok', 5000);
    } catch (err) {
      toast('Connection failed: ' + err.message, 'error', 6000);
    }
  });

  $('#btn-export-zip-2').addEventListener('click', exportEverything);
  $('#btn-import-zip-2').addEventListener('click', () => files.importZipPick());

  $('#btn-clear-chat').addEventListener('click', async () => {
    if (await confirmDialog('Clear chat history?', 'All conversations will be removed from this device.', { danger: true, okLabel: 'Clear' })) {
      await clearChat();
      await chat.resetChat();
      toast('Chat history cleared 🧹', 'ok');
    }
  });

  $('#btn-clear-files').addEventListener('click', async () => {
    if (await confirmDialog('Delete all files?', 'Every file (including Vault files) will be permanently removed from this device. Export first if you need a backup.', { danger: true, okLabel: 'Delete all' })) {
      await clearFiles();
      await files.refresh();
      toast('All files deleted', 'ok');
    }
  });

  $('#btn-refresh').addEventListener('click', async () => {
    toast('Checking for updates…');
    try { await swReg?.update(); } catch { /* noop */ }
  });
}

function updateAIBadge(cfg) {
  const b = $('#ai-badge');
  if (cfg?.enabled && cfg.url && cfg.key) { b.textContent = 'External AI connected'; b.classList.add('ext'); }
  else { b.textContent = 'Local assistant'; b.classList.remove('ext'); }
}

async function updateStorage() {
  const est = await storageEstimate();
  if (!est) { $('#storage-usage').textContent = 'Storage usage not available in this browser.'; return; }
  const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  $('#storage-usage').textContent = `Using ${fmtBytes(est.usage)} of ~${fmtBytes(est.quota)} available (${pct.toFixed(pct < 1 ? 2 : 1)}%)`;
  $('#storage-bar').style.width = Math.max(pct, 0.5) + '%';
}

/* ---------- share target (files shared from the OS) ---------- */
async function drainShareQueue() {
  try {
    const rows = await drainShareIn();
    if (!rows.length) return;
    const list = rows.map((r) => {
      try { return new File([r.blob], r.name || 'shared-file', { type: r.type || '' }); }
      catch { const b = r.blob; b.name = r.name; return b; }
    });
    await files.handleFileList(list);
    toast(`Received ${list.length} shared file(s) 📲`, 'ok');
  } catch { /* noop */ }
}
function initShareIn() {
  drainShareQueue();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) drainShareQueue(); });
}

/* ---------- file handling API (open images from the OS) ---------- */
function initLaunchQueue() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (launchParams) => {
    const fs = launchParams.files || [];
    if (!fs.length) return;
    const first = fs[0];
    try {
      const file = await first.getFile();
      if (file.type.startsWith('image/')) {
        nav('editor');
        await editor.loadBlob(file, file.name);
      } else {
        await files.handleFileList([file]);
        nav('files');
      }
    } catch { /* noop */ }
  });
}

/* ---------- PWA install ---------- */
function initInstall() {
  const show = () => { $('#btn-install').hidden = false; $('#btn-install-2').hidden = false; };
  const hide = () => { $('#btn-install').hidden = true; $('#btn-install-2').hidden = true; };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; show(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; hide(); toast('App installed! 🎉 Find it on your home screen.', 'ok', 5000); });
  const promptInstall = async () => {
    if (!deferredPrompt) { toast('To install: use your browser menu → “Install app” / “Add to Home screen”.', 'info', 5000); return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; hide();
  };
  $('#btn-install').addEventListener('click', promptInstall);
  $('#btn-install-2').addEventListener('click', promptInstall);
}

/* ---------- service worker ---------- */
function initSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swReg = reg;
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBtn();
      });
    });
  }).catch(() => { });

  const showUpdateBtn = () => { $('#btn-update').hidden = false; };
  $('#btn-update').addEventListener('click', async () => {
    $('#btn-update').disabled = true;
    swReg?.waiting?.postMessage('SKIP_WAITING');
    setTimeout(() => location.reload(), 600);
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/* ---------- online / offline ---------- */
function initNet() {
  const el = $('#net-status');
  const set = () => {
    const on = navigator.onLine;
    el.classList.toggle('offline', !on);
    $('#net-text').textContent = on ? 'Online' : 'Offline — app still works';
  };
  window.addEventListener('online', () => { set(); toast('Back online 🌐', 'ok'); });
  window.addEventListener('offline', () => { set(); toast('You are offline — everything still works locally.', 'warn'); });
  set();
}
