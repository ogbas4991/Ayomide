/* Ayomide Studio — app shell: navigation, PWA install, service worker, settings */
import { $, $$, on, emit, toast, confirmDialog, fmtBytes } from './utils.js';
import * as chat from './chat.js';
import * as files from './files.js';
import * as editor from './editor.js';
import * as video from './video.js';
import { clearChat, clearFiles, kvGet, kvSet, storageEstimate } from './db.js';
import { exportEverything } from './exporter.js';

const TITLES = {
  chat: 'Chat', files: 'Files', editor: 'Image Editor', video: 'Image → Video', settings: 'Settings'
};

let deferredPrompt = null;
let swReg = null;
let reloading = false;

/* ---------- navigation ---------- */
function nav(tab) {
  if (!TITLES[tab]) return;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view-title').textContent = TITLES[tab];
}

/* ---------- boot ---------- */
async function boot() {
  await Promise.all([chat.init(), files.init(), editor.init(), video.init()]);
  nav('chat');

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => nav(b.dataset.tab)));
  on('nav', (tab) => nav(tab));
  on('open-editor-with', async ({ id }) => { nav('editor'); await editor.loadFileId(id); });
  on('open-video-with', async ({ ids }) => { nav('video'); await video.addFileIds(ids); });
  on('files:changed', updateStorage);

  initSettings();
  initInstall();
  initSW();
  initNet();
  updateStorage();
}
boot();

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

  $('#btn-clear-chat').addEventListener('click', async () => {
    if (await confirmDialog('Clear chat history?', 'Your entire conversation will be removed from this device.', { danger: true, okLabel: 'Clear' })) {
      await clearChat();
      await chat.resetChat();
      toast('Chat history cleared 🧹', 'ok');
    }
  });

  $('#btn-clear-files').addEventListener('click', async () => {
    if (await confirmDialog('Delete all files?', 'Every uploaded/created file will be permanently removed from this device. Export first if you need a backup.', { danger: true, okLabel: 'Delete all' })) {
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
