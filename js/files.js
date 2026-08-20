/* Ayomide Studio — files: folders, tags, gallery, bulk, duplicates, vault, zip import */
import {
  $, $$, esc, uid, fmtBytes, fmtDate, toast, modal, confirmDialog, download,
  isImage, isVideo, isAudio, isText, fileIcon, emit, on, sha1Blob,
  encryptBlob, decryptBlob
} from './utils.js';
import { addFile, allFiles, deleteFile, updateFile, clearFiles, kvGet, kvSet } from './db.js';
import { exportAllFiles, makeZip, importZip } from './exporter.js';
import { vaultReady, getVaultKey } from './vault.js';

let files = [];
let filter = 'all';
let query = '';
let folderFilter = 'all';
let tagFilter = null;
let vaultOnly = false;
let viewMode = 'grid';
let bulkMode = false;
const selected = new Set();
let folders = [];
const urlCache = new Map();

export async function init() {
  $('#btn-upload').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => { handleFileList(e.target.files); e.target.value = ''; });
  $('#file-search').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); render(); });
  $('#file-filter').addEventListener('change', (e) => { filter = e.target.value; render(); });
  $('#btn-export-zip').addEventListener('click', exportAllFiles);

  $('#folder-select').addEventListener('change', (e) => { folderFilter = e.target.value; render(); });
  $('#btn-new-folder').addEventListener('click', newFolder);
  $('#btn-view-toggle').addEventListener('click', () => {
    viewMode = viewMode === 'grid' ? 'gallery' : 'grid';
    $('#btn-view-toggle').textContent = viewMode === 'grid' ? '🖼' : '☰';
    render();
  });
  $('#btn-find-dupes').addEventListener('click', findDupes);
  $('#btn-import-zip').addEventListener('click', () => $('#zip-input').click());
  $('#zip-input').addEventListener('change', onZipPick);

  $('#btn-bulk').addEventListener('click', () => {
    bulkMode = !bulkMode;
    selected.clear();
    $('#btn-bulk').classList.toggle('primary', bulkMode);
    render();
  });
  $('#bulk-cancel').addEventListener('click', () => { bulkMode = false; selected.clear(); $('#btn-bulk').classList.remove('primary'); render(); });
  $('#bulk-delete').addEventListener('click', bulkDelete);
  $('#bulk-move').addEventListener('click', () => bulkMove());
  $('#bulk-zip').addEventListener('click', bulkZip);

  // drag & drop
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => handleFileList(e.dataTransfer.files));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  folders = await kvGet('folders', []);
  await refresh();
  buildFolderSelect();
  renderTags();
}

export function pickLocal() { $('#file-input').click(); }
export function importZipPick() { $('#zip-input').click(); }

export async function refresh() {
  files = await allFiles();
  render();
  renderTags();
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
    try {
      const rec = await addFile(f, f.name, { folder: folderFilter !== 'all' ? folderFilter : 'root' });
      sha1Blob(f).then((h) => updateFile(rec.id, { hash: h })).catch(() => { });
      n++;
    } catch { toast(`Failed to store ${f.name}`, 'error'); }
  }
  if (n) {
    toast(`Uploaded ${n} file${n > 1 ? 's' : ''} 📁`, 'ok');
    await refresh();
  }
}

/* ---------- folders ---------- */
function buildFolderSelect() {
  const sel = $('#folder-select');
  const cur = folderFilter;
  sel.innerHTML = `<option value="all">📂 All files</option><option value="root">🏠 Home</option>`;
  folders.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = '📁 ' + f.name;
    sel.appendChild(o);
  });
  sel.value = cur;
  if (sel.value !== cur) { folderFilter = 'all'; sel.value = 'all'; }
}

async function newFolder() {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Folder name (e.g. Work, Family…)';
  modal({
    title: 'New folder',
    body: input,
    actions: [
      { label: 'Cancel', cls: 'ghost' },
      {
        label: 'Create', cls: 'primary', onClick: async (close) => {
          const name = input.value.trim();
          if (!name) return;
          const f = { id: uid(), name };
          folders.push(f);
          await kvSet('folders', folders);
          buildFolderSelect();
          folderFilter = f.id;
          $('#folder-select').value = f.id;
          close();
          render();
          toast(`Folder “${name}” created 📁`, 'ok');
        }
      }
    ]
  });
  setTimeout(() => input.focus(), 40);
}

function moveModal(ids) {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'btn-row wrap';
  const mk = async (id, label) => {
    for (const fid of ids) await updateFile(fid, { folder: id });
    await refresh();
    toast(`Moved ${ids.length} file(s) to ${label} 📁`, 'ok');
    m.close();
  };
  [['root', '🏠 Home'], ...folders.map((f) => [f.id, '📁 ' + f.name])].forEach(([id, label]) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', () => mk(id, label));
    list.appendChild(b);
  });
  wrap.appendChild(list);
  const m = modal({ title: `Move ${ids.length} file(s) to…`, body: wrap });
}

/* ---------- filtering & render ---------- */
function matchesFilter(rec) {
  if (vaultOnly && !rec.vault) return false;
  if (!vaultOnly && rec.vault && folderFilter === 'all' && tagFilter === null) { /* still show vault in All */ }
  const t = rec.type || '';
  if (filter === 'image' && !isImage(t)) return false;
  if (filter === 'video' && !isVideo(t)) return false;
  if (filter === 'audio' && !isAudio(t)) return false;
  if (filter === 'text' && !isText(t, rec.name)) return false;
  if (folderFilter !== 'all' && (rec.folder || 'root') !== folderFilter) return false;
  if (tagFilter && !(rec.tags || []).includes(tagFilter)) return false;
  if (query && !(rec.name || '').toLowerCase().includes(query)) return false;
  return true;
}

function render() {
  const grid = $('#files-grid');
  const pool = viewMode === 'gallery' ? files.filter((f) => isImage(f.type) && !f.vault) : files;
  const shown = pool.filter(matchesFilter);
  const galleryImgs = shown.filter((f) => isImage(f.type) && !f.vault);

  $('#files-empty').style.display = files.length ? 'none' : 'block';
  grid.style.display = shown.length ? (viewMode === 'gallery' ? 'block' : 'grid') : 'none';
  grid.classList.toggle('gallery', viewMode === 'gallery');
  $('#files-count').textContent = files.length
    ? `${shown.length} of ${files.length} · ${fmtBytes(files.reduce((n, f) => n + (f.size || 0), 0))}`
    : '';

  $('#bulk-bar').hidden = !(bulkMode && selected.size);
  $('#bulk-count').textContent = `${selected.size} selected`;

  grid.innerHTML = '';
  if (viewMode === 'gallery') {
    galleryImgs.forEach((rec, i) => grid.appendChild(galleryCard(rec, i, galleryImgs)));
  } else {
    shown.forEach((rec) => grid.appendChild(card(rec)));
  }
}

function thumbHtml(rec) {
  if (rec.vault) return vaultReady() ? '🔓' : '🔒';
  if (isImage(rec.type)) return `<img src="${urlFor(rec)}" alt="" loading="lazy">`;
  return fileIcon(rec);
}

function card(rec) {
  const el = document.createElement('div');
  el.className = 'file-card';
  const canEdit = (isImage(rec.type) || isText(rec.type, rec.name)) && !rec.vault;
  const tagHtml = (rec.tags || []).length
    ? `<div class="file-meta">🏷 ${esc(rec.tags.slice(0, 3).join(', '))}</div>` : '';
  el.innerHTML = `
    <div class="file-thumb" data-view>${thumbHtml(rec)}</div>
    <div class="file-body">
      <div class="file-name" title="${esc(rec.name)}">${esc(rec.name)}</div>
      <div class="file-meta">${fmtBytes(rec.size)} · ${fmtDate(rec.addedAt)}</div>
      ${tagHtml}
      <div class="file-actions">
        ${bulkMode ? `<button data-sel>${selected.has(rec.id) ? '☑️' : '⬜'}</button>` : ''}
        <button data-view title="Preview">👁</button>
        <button data-dl title="Download">⬇️</button>
        ${canEdit ? '<button data-edit title="Edit">✏️</button>' : ''}
        ${isImage(rec.type) && !rec.vault ? '<button data-vid title="Use in video">🎬</button>' : ''}
        <button data-move title="Move to folder">📁</button>
        <button data-tags title="Tags">🏷</button>
        ${rec.vault
      ? '<button data-unvault title="Restore from vault (decrypt)">🔓</button>'
      : '<button data-vault title="Move to encrypted vault">🔒</button>'}
        <button data-del title="Delete">✕</button>
      </div>
    </div>`;
  const selBtn = el.querySelector('[data-sel]');
  if (selBtn) selBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(rec.id); });
  el.querySelector('[data-view]').addEventListener('click', () => bulkMode ? toggleSelect(rec.id) : preview(rec));
  el.querySelector('[data-dl]').addEventListener('click', async () => {
    const blob = await readableBlob(rec);
    if (blob) download(blob, rec.name); else toast('Unlock the vault first (Settings → Security).', 'warn');
  });
  el.querySelector('[data-move]').addEventListener('click', () => moveModal([rec.id]));
  el.querySelector('[data-tags]').addEventListener('click', () => tagModal(rec));
  const vaultBtn = el.querySelector('[data-vault]');
  if (vaultBtn) vaultBtn.addEventListener('click', () => toVault(rec));
  const unvaultBtn = el.querySelector('[data-unvault]');
  if (unvaultBtn) unvaultBtn.addEventListener('click', () => fromVault(rec));
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog('Delete file?', `“${rec.name}” will be permanently removed from this device.`, { danger: true, okLabel: 'Delete' })) {
      await deleteFile(rec.id);
      forgetUrl(rec.id);
      selected.delete(rec.id);
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

function galleryCard(rec, idx, list) {
  const el = document.createElement('div');
  el.className = 'file-card';
  el.innerHTML = `
    <div class="file-thumb"><img src="${urlFor(rec)}" alt="" loading="lazy"></div>
    <div class="file-body">
      <div class="file-name" title="${esc(rec.name)}">${esc(rec.name)}</div>
      <div class="file-meta">${fmtBytes(rec.size)}</div>
    </div>`;
  el.querySelector('.file-thumb').addEventListener('click', () => lightbox(idx, list));
  return el;
}

function lightbox(idx, list) {
  const body = document.createElement('div');
  body.className = 'lightbox';
  const img = new Image();
  const name = document.createElement('p');
  name.className = 'muted center';
  const nav = document.createElement('div');
  nav.className = 'lightbox-nav';
  nav.innerHTML = '<button class="btn">← Prev</button><button class="btn">Next →</button>';
  const show = (i) => {
    const rec = list[(i + list.length) % list.length];
    img.src = urlFor(rec);
    name.textContent = `${rec.name} · ${fmtBytes(rec.size)}`;
    cur = (i + list.length) % list.length;
  };
  let cur = idx;
  nav.children[0].addEventListener('click', () => show(cur - 1));
  nav.children[1].addEventListener('click', () => show(cur + 1));
  body.append(img, name, nav);
  const m = modal({ title: 'Gallery', body, wide: true });
  show(idx);
}

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  render();
}

/* ---------- tags ---------- */
function tagModal(rec) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = (rec.tags || []).join(', ');
  input.placeholder = 'Comma-separated tags (e.g. work, logo, 2026)';
  modal({
    title: 'Tags · ' + rec.name,
    body: input,
    actions: [
      { label: 'Cancel', cls: 'ghost' },
      {
        label: 'Save', cls: 'primary', onClick: async (close) => {
          const tags = input.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
          await updateFile(rec.id, { tags });
          close();
          await refresh();
        }
      }
    ]
  });
  setTimeout(() => input.focus(), 40);
}

function renderTags() {
  const row = $('#tag-row');
  const all = new Set();
  files.forEach((f) => (f.tags || []).forEach((t) => all.add(t)));
  const hasVault = files.some((f) => f.vault);
  row.innerHTML = '';
  if (!all.size && !hasVault) return;
  if (hasVault) {
    const c = document.createElement('button');
    c.className = 'chip lockchip' + (vaultOnly ? ' active' : '');
    c.textContent = '🔒 Vault';
    c.addEventListener('click', () => {
      vaultOnly = !vaultOnly;
      renderTags();
      render();
      if (vaultOnly && !vaultReady()) toast('Vault is locked — unlock it in Settings → Security to open files.', 'warn', 4500);
    });
    row.appendChild(c);
  }
  [...all].sort().forEach((t) => {
    const c = document.createElement('button');
    c.className = 'chip' + (tagFilter === t ? ' active' : '');
    c.textContent = '🏷 ' + t;
    c.addEventListener('click', () => {
      tagFilter = tagFilter === t ? null : t;
      renderTags();
      render();
    });
    row.appendChild(c);
  });
}

/* ---------- vault ---------- */
async function toVault(rec) {
  if (rec.vault) return;
  if (!vaultReady()) {
    toast('Enable app lock & unlock the vault first — Settings → Security 🔐', 'warn', 5000);
    emit('nav', 'settings');
    return;
  }
  try {
    const { blob: enc, ivHex } = await encryptBlob(rec.blob, getVaultKey());
    await updateFile(rec.id, { vault: true, blob: enc, iv: ivHex, hash: null });
    forgetUrl(rec.id);
    toast(`“${rec.name}” moved to the Vault — AES-256 encrypted 🔒`, 'ok');
    await refresh();
  } catch (err) {
    toast('Encryption failed: ' + err.message, 'error');
  }
}

async function fromVault(rec) {
  if (!rec.vault) return;
  if (!vaultReady()) { toast('Unlock the vault first (Settings → Security).', 'warn'); emit('nav', 'settings'); return; }
  try {
    const dec = await decryptBlob(rec.blob, getVaultKey(), rec.iv);
    await updateFile(rec.id, { vault: false, blob: dec, iv: null });
    toast(`“${rec.name}” restored from the Vault 🔓`, 'ok');
    await refresh();
  } catch {
    toast('Could not decrypt — wrong key. Unlock the vault in Settings.', 'error');
  }
}

async function readableBlob(rec) {
  if (!rec.vault) return rec.blob;
  if (!vaultReady()) return null;
  try { return await decryptBlob(rec.blob, getVaultKey(), rec.iv); } catch { return null; }
}

/* ---------- preview & text editing ---------- */
export async function preview(rec) {
  const t = rec.type || '';
  const blob = await readableBlob(rec);
  if (rec.vault && !blob) { toast('Unlock the vault in Settings to open this file.', 'warn'); return; }
  let body;
  const url = blob ? URL.createObjectURL(blob) : null;
  if (isImage(t) && url) {
    body = document.createElement('div');
    body.style.textAlign = 'center';
    const img = new Image();
    img.src = url;
    img.style.maxWidth = '100%';
    img.style.borderRadius = '10px';
    body.appendChild(img);
  } else if (isVideo(t) && url) {
    body = document.createElement('div');
    const v = document.createElement('video');
    v.src = url; v.controls = true; v.autoplay = true;
    v.style.width = '100%'; v.style.borderRadius = '10px';
    body.appendChild(v);
  } else if (isAudio(t) && url) {
    body = document.createElement('div');
    const a = document.createElement('audio');
    a.src = url; a.controls = true; a.autoplay = true;
    a.style.width = '100%';
    body.appendChild(a);
  } else if (isText(t, rec.name) && rec.size < 400_000 && blob) {
    body = document.createElement('div');
    const txt = await blob.text();
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.fontSize = '13px';
    pre.textContent = txt;
    body.appendChild(pre);
  } else {
    body = document.createElement('p');
    body.innerHTML = `${fileIcon(rec)} No preview for this type — you can still download it.<br><br>
      <b>${esc(rec.name)}</b><br><span class="muted">${esc(t || 'unknown type')} · ${fmtBytes(rec.size)}</span>`;
  }
  const m = modal({
    title: rec.name,
    body,
    wide: true,
    actions: [
      { label: '⬇️ Download', cls: 'primary', onClick: () => { if (blob) download(blob, rec.name); } },
      { label: 'Close', cls: 'ghost' }
    ]
  });
  m.back.addEventListener('click', () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 500); }, { once: true });
}

export async function editText(rec) {
  const blob = await readableBlob(rec);
  if (!blob) { toast('Unlock the vault to edit this file.', 'warn'); return; }
  const ta = document.createElement('textarea');
  ta.rows = 14;
  ta.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  ta.style.fontSize = '13px';
  ta.value = await blob.text();
  modal({
    title: 'Edit · ' + rec.name,
    body: ta,
    actions: [
      { label: 'Cancel', cls: 'ghost' },
      {
        label: '💾 Save', cls: 'primary',
        onClick: async (close) => {
          const nb = new Blob([ta.value], { type: rec.type || 'text/plain' });
          await updateFile(rec.id, { blob: nb, size: nb.size });
          toast('File saved ✅', 'ok');
          close();
          await refresh();
        }
      }
    ]
  });
}

/* ---------- duplicates ---------- */
async function findDupes() {
  const plain = files.filter((f) => !f.vault && f.size > 0);
  if (plain.length < 2) { toast('Need at least 2 files to compare.', 'warn'); return; }
  toast('Scanning file contents…');
  for (const f of plain) {
    if (!f.hash) {
      try {
        const h = await sha1Blob(f.blob);
        f.hash = h;
        await updateFile(f.id, { hash: h });
      } catch { }
    }
  }
  const groups = new Map();
  plain.filter((f) => f.hash).forEach((f) => {
    if (!groups.has(f.hash)) groups.set(f.hash, []);
    groups.get(f.hash).push(f);
  });
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  if (!dupes.length) { toast('No duplicates found ✨', 'ok'); return; }

  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="muted">${dupes.length} duplicate group(s) found.</p>`;
  dupes.forEach((g, i) => {
    const box = document.createElement('div');
    box.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px 0;';
    box.innerHTML = `<b>${esc(g[0].name)}</b> ×${g.length} <span class="muted">(${fmtBytes(g[0].size)} each)</span>
      <ul style="margin:8px 0 0 18px;padding:0;font-size:13px;">
        ${g.map((f) => `<li data-id="${f.id}">${esc(f.name)} · ${fmtDate(f.addedAt)}</li>`).join('')}
      </ul>`;
    const btn = document.createElement('button');
    btn.className = 'btn warn slim';
    btn.textContent = 'Keep newest, delete rest';
    btn.addEventListener('click', async () => {
      const sorted = [...g].sort((a, b) => b.addedAt - a.addedAt);
      for (const f of sorted.slice(1)) { await deleteFile(f.id); forgetUrl(f.id); }
      toast(`Group ${i + 1} cleaned ♻️`, 'ok');
      await refresh();
      box.remove();
      if (!$('#files-grid')?.isConnected) m2.close?.();
    });
    box.appendChild(btn);
    wrap.appendChild(box);
  });
  const m2 = modal({ title: '♻️ Duplicate files', body: wrap });
}

/* ---------- bulk actions ---------- */
async function bulkDelete() {
  if (!selected.size) return;
  if (await confirmDialog(`Delete ${selected.size} file(s)?`, 'This cannot be undone.', { danger: true, okLabel: 'Delete' })) {
    for (const id of selected) { await deleteFile(id); forgetUrl(id); }
    selected.clear();
    bulkMode = false;
    $('#btn-bulk').classList.remove('primary');
    await refresh();
    toast('Deleted 🗑', 'ok');
  }
}

function bulkMove() {
  if (!selected.size) return;
  moveModal([...selected]);
}

async function bulkZip() {
  if (!selected.size) return;
  const entries = [];
  for (const id of selected) {
    const rec = files.find((f) => f.id === id);
    if (!rec || rec.vault) continue;
    entries.push({ name: rec.name, data: new Uint8Array(await rec.blob.arrayBuffer()) });
  }
  if (!entries.length) { toast('No downloadable (non-vault) files selected.', 'warn'); return; }
  download(makeZip(entries), 'ayomide-selection.zip');
  toast(`Downloaded ${entries.length} file(s) 📦`, 'ok');
}

/* ---------- zip import ---------- */
async function onZipPick(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  toast('Reading ZIP…');
  try {
    const { addFile: af, putChatRow, allChat } = await import('./db.js');
    const res = await importZip(f, { addFile: af, putChatRow, allChat });
    await refresh();
    toast(`Imported ${res.files} file(s)${res.chat ? ` + ${res.chat} chat message(s)` : ''} 🧳`, 'ok', 5000);
  } catch (err) {
    toast('Import failed: ' + err.message, 'error', 6000);
  }
}

/* ---------- pickers used by other tools ---------- */
export function pickImages({ multiple = true, title = 'Choose images' } = {}) {
  return new Promise((resolve) => {
    const imgs = files.filter((f) => isImage(f.type) && !f.vault);
    if (!imgs.length) {
      toast('No images in Files yet — upload some first.', 'warn');
      resolve([]);
      return;
    }
    const wrap = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'pick-list';
    const sel = new Set();
    imgs.forEach((rec) => {
      const b = document.createElement('button');
      b.className = 'pick-item';
      b.type = 'button';
      b.innerHTML = `<img src="${urlFor(rec)}" alt=""><span>${esc(rec.name)}</span>`;
      b.addEventListener('click', () => {
        if (!multiple) { resolve([rec]); m.close(); return; }
        if (sel.has(rec.id)) { sel.delete(rec.id); b.style.borderColor = ''; }
        else { sel.add(rec.id); b.style.borderColor = 'var(--acc)'; }
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
        { label: 'Add selected', cls: 'primary', onClick: (close) => { close(); resolve(imgs.filter((r) => sel.has(r.id))); } }
      ] : []
    });
  });
}

export function pickAudio() {
  return new Promise((resolve) => {
    const auds = files.filter((f) => isAudio(f.type) && !f.vault);
    if (!auds.length) {
      toast('No audio in Files yet — upload a music track first.', 'warn');
      resolve(null);
      return;
    }
    const wrap = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'btn-row wrap';
    auds.forEach((rec) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `🎵 ${rec.name} (${fmtBytes(rec.size)})`;
      b.addEventListener('click', () => { m.close(); resolve(rec); });
      list.appendChild(b);
    });
    wrap.appendChild(list);
    const m = modal({ title: 'Choose music', body: wrap });
  });
}

on('op', (name) => { if (name === 'upload') pickLocal(); });
