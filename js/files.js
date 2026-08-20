/* Ayomide Studio — file management (upload, browse, preview, rename, delete) */
import {
  $, $$, esc, fmtBytes, fmtDate, toast, modal, confirmDialog, download,
  isImage, isVideo, isAudio, isText, fileIcon, emit, on
} from './utils.js';
import { addFile, allFiles, deleteFile, updateFile, clearFiles } from './db.js';
import { exportAllFiles } from './exporter.js';

let files = [];
let filter = 'all';
let query = '';
const urlCache = new Map(); // id -> objectURL

export async function init() {
  $('#btn-upload').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => { handleFileList(e.target.files); e.target.value = ''; });
  $('#file-search').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); render(); });
  $('#file-filter').addEventListener('change', (e) => { filter = e.target.value; render(); });
  $('#btn-export-zip').addEventListener('click', exportAllFiles);

  // drag & drop
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => handleFileList(e.dataTransfer.files));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  await refresh();
}

export function pickLocal() { $('#file-input').click(); }

export async function refresh() {
  files = await allFiles();
  render();
  emit('files:changed');
}

function urlFor(rec) {
  if (!urlCache.has(rec.id)) urlCache.set(rec.id, URL.createObjectURL(rec.blob));
  return urlCache.get(rec.id);
}
function forgetUrl(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}

export async function handleFileList(list) {
  const arr = [...list];
  if (!arr.length) return;
  let n = 0;
  for (const f of arr) {
    try { await addFile(f, f.name); n++; } catch { toast(`Failed to store ${f.name}`, 'error'); }
  }
  if (n) {
    toast(`Uploaded ${n} file${n > 1 ? 's' : ''} 📁`, 'ok');
    await refresh();
  }
}

function matchesFilter(rec) {
  if (filter === 'all') return true;
  const t = rec.type || '';
  if (filter === 'image') return isImage(t);
  if (filter === 'video') return isVideo(t);
  if (filter === 'audio') return isAudio(t);
  if (filter === 'text') return isText(t, rec.name);
  return true;
}

function render() {
  const grid = $('#files-grid');
  const shown = files.filter((f) => matchesFilter(f) && (!query || (f.name || '').toLowerCase().includes(query)));
  $('#files-empty').style.display = files.length ? 'none' : 'block';
  grid.style.display = shown.length ? 'grid' : 'none';
  $('#files-count').textContent = files.length ? `${shown.length} of ${files.length} · ${fmtBytes(files.reduce((n, f) => n + (f.size || 0), 0))}` : '';

  grid.innerHTML = '';
  shown.forEach((rec) => grid.appendChild(card(rec)));
}

function card(rec) {
  const el = document.createElement('div');
  el.className = 'file-card';
  const thumb = isImage(rec.type)
    ? `<img src="${urlFor(rec)}" alt="" loading="lazy">`
    : fileIcon(rec);
  const canEdit = isImage(rec.type) || isText(rec.type, rec.name);
  el.innerHTML = `
    <div class="file-thumb" data-view>${thumb}</div>
    <div class="file-body">
      <div class="file-name" title="${esc(rec.name)}">${esc(rec.name)}</div>
      <div class="file-meta">${fmtBytes(rec.size)} · ${fmtDate(rec.addedAt)}</div>
      <div class="file-actions">
        <button data-view title="Preview">👁</button>
        <button data-dl title="Download">⬇️</button>
        ${canEdit ? '<button data-edit title="Edit">✏️</button>' : ''}
        ${isImage(rec.type) ? '<button data-vid title="Use in video">🎬</button>' : ''}
        <button data-del title="Delete">✕</button>
      </div>
    </div>`;
  el.querySelector('[data-view]').addEventListener('click', () => preview(rec));
  el.querySelector('[data-dl]').addEventListener('click', () => download(rec.blob, rec.name));
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog('Delete file?', `“${rec.name}” will be permanently removed from this device.`, { danger: true, okLabel: 'Delete' })) {
      await deleteFile(rec.id);
      forgetUrl(rec.id);
      toast('File deleted');
      await refresh();
    }
  });
  const editBtn = el.querySelector('[data-edit]');
  if (editBtn) editBtn.addEventListener('click', () => {
    if (isImage(rec.type)) emit('open-editor-with', { id: rec.id });
    else editText(rec);
  });
  const vidBtn = el.querySelector('[data-vid]');
  if (vidBtn) vidBtn.addEventListener('click', () => emit('open-video-with', { ids: [rec.id] }));
  return el;
}

/* ---------- preview modal ---------- */
export function preview(rec) {
  const t = rec.type || '';
  let body;
  if (isImage(t)) {
    body = document.createElement('div');
    body.style.textAlign = 'center';
    const img = new Image();
    img.src = urlFor(rec);
    img.style.maxWidth = '100%';
    img.style.borderRadius = '10px';
    body.appendChild(img);
  } else if (isVideo(t)) {
    body = document.createElement('div');
    const v = document.createElement('video');
    v.src = urlFor(rec);
    v.controls = true;
    v.autoplay = true;
    v.style.width = '100%';
    v.style.borderRadius = '10px';
    body.appendChild(v);
  } else if (isAudio(t)) {
    body = document.createElement('div');
    const a = document.createElement('audio');
    a.src = urlFor(rec);
    a.controls = true;
    a.style.width = '100%';
    a.autoplay = true;
    body.appendChild(a);
  } else if (isText(t, rec.name) && rec.size < 400_000) {
    body = document.createElement('div');
    rec.blob.text().then((txt) => {
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.style.fontSize = '13px';
      pre.textContent = txt;
      body.appendChild(pre);
    });
  } else {
    body = document.createElement('p');
    body.innerHTML = `${fileIcon(rec)} No preview for this type — you can still download it.<br><br>
      <b>${esc(rec.name)}</b><br><span class="muted">${esc(t || 'unknown type')} · ${fmtBytes(rec.size)}</span>`;
  }
  modal({
    title: rec.name,
    body,
    wide: true,
    actions: [
      { label: '⬇️ Download', cls: 'primary', onClick: (close) => { download(rec.blob, rec.name); } },
      { label: 'Close', cls: 'ghost' }
    ]
  });
}

/* ---------- text editing ---------- */
export async function editText(rec) {
  const ta = document.createElement('textarea');
  ta.rows = 14;
  ta.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  ta.style.fontSize = '13px';
  ta.value = await rec.blob.text();
  modal({
    title: 'Edit · ' + rec.name,
    body: ta,
    actions: [
      { label: 'Cancel', cls: 'ghost' },
      {
        label: '💾 Save', cls: 'primary',
        onClick: async (close) => {
          const blob = new Blob([ta.value], { type: rec.type || 'text/plain' });
          await updateFile(rec.id, { blob, size: blob.size });
          toast('File saved ✅', 'ok');
          close();
          await refresh();
        }
      }
    ]
  });
}

/* ---------- image picker used by editor & video tools ---------- */
export function pickImages({ multiple = true, title = 'Choose images' } = {}) {
  return new Promise((resolve) => {
    const imgs = files.filter((f) => isImage(f.type));
    if (!imgs.length) {
      toast('No images in Files yet — upload some first.', 'warn');
      resolve([]);
      return;
    }
    const wrap = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'pick-list';
    const selected = new Set();
    imgs.forEach((rec) => {
      const b = document.createElement('button');
      b.className = 'pick-item';
      b.type = 'button';
      b.innerHTML = `<img src="${urlFor(rec)}" alt=""><span>${esc(rec.name)}</span>`;
      b.addEventListener('click', () => {
        if (!multiple) { resolve([rec]); m.close(); return; }
        if (selected.has(rec.id)) { selected.delete(rec.id); b.style.borderColor = ''; }
        else { selected.add(rec.id); b.style.borderColor = 'var(--acc)'; }
      });
      list.appendChild(b);
    });
    wrap.appendChild(list);
    const m = modal({
      title,
      body: wrap,
      wide: true,
      actions: multiple ? [
        { label: 'Cancel', cls: 'ghost', onClick: (close) => { close(); resolve([]); } },
        {
          label: 'Add selected', cls: 'primary',
          onClick: (close) => { close(); resolve(imgs.filter((r) => selected.has(r.id))); }
        }
      ] : []
    });
  });
}

on('op', (name) => { if (name === 'upload') pickLocal(); });
