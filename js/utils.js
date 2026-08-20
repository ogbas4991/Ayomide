/* Ayomide Studio — shared utilities */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- tiny event bus ---------- */
const handlers = new Map();
export const on = (name, fn) => {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
};
export const emit = (name, detail) => {
  (handlers.get(name) || []).forEach((fn) => {
    try { fn(detail); } catch (err) { console.error(`[bus:${name}]`, err); }
  });
};

/* ---------- toast ---------- */
export function toast(msg, type = 'info', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

/* ---------- modal ---------- */
export function modal({ title, body, actions = [], wide = false }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  if (wide) box.style.width = 'min(94vw, 860px)';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  box.innerHTML = `
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>✕</button></div>`;
  box.appendChild(bodyEl);
  if (actions.length) {
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = `btn ${a.cls || ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => a.onClick ? a.onClick(close) : close());
      foot.appendChild(b);
    });
    box.appendChild(foot);
  }
  back.appendChild(box);
  $('#modal-root').appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  box.querySelector('[data-close]').addEventListener('click', close);
  return { close, body: bodyEl, box };
}

export function confirmDialog(title, text, { danger = false, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p style="line-height:1.6;margin:0">${esc(text)}</p>`,
      actions: [
        { label: 'Cancel', cls: 'ghost', onClick: (close) => { close(); resolve(false); } },
        { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: (close) => { close(); resolve(true); } }
      ]
    });
    m.box.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) resolve(false); });
  });
}

/* ---------- download ---------- */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- file type helpers ---------- */
export const isImage = (t) => String(t || '').startsWith('image/');
export const isVideo = (t) => String(t || '').startsWith('video/');
export const isAudio = (t) => String(t || '').startsWith('audio/');

const TEXT_EXT = /\.(txt|md|markdown|json|js|mjs|cjs|ts|jsx|tsx|css|scss|html?|xml|svg|csv|tsv|ya?ml|ini|cfg|conf|log|py|java|c|cpp|h|cs|go|rs|rb|php|sh|bat|sql|toml|env)$/i;
export function isText(t, name) {
  return String(t || '').startsWith('text/') ||
    /json|xml|javascript|ecmascript|yaml|toml|x-sh/i.test(String(t || '')) ||
    TEXT_EXT.test(name || '');
}

export function fileIcon(rec) {
  const t = rec.type || '', n = rec.name || '';
  if (isImage(t)) return '🖼️';
  if (isVideo(t)) return '🎬';
  if (isAudio(t)) return '🎵';
  if (/pdf/i.test(t)) return '📕';
  if (/zip|rar|7z|tar|gzip/i.test(t)) return '🗜️';
  if (isText(t, n)) return '📄';
  return '📎';
}

/* ---------- image helpers ---------- */
export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load image'));
    img.src = src;
  });
}

export async function shrinkImage(blob, maxDim = 1280, mime = 'image/jpeg', quality = 0.85) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((res) => c.toBlob(res, mime, quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/* safe arithmetic evaluation for the assistant */
export function safeMath(expr) {
  if (!/^[\d\s+\-*/().%]+$/.test(expr) || !/\d/.test(expr) || !/[+\-*/%]/.test(expr)) return null;
  try {
    const v = Function(`"use strict";return (${expr.replace(/%/g, '/100')})`)();
    return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : null;
  } catch { return null; }
}
