/* Ayomide Studio — image editor (rotate/flip/crop/resize/filters, undo-redo, export) */
import { $, $$, toast, download, loadImage, emit } from './utils.js';
import { addFile, getFile } from './db.js';
import { pickImages, refresh as refreshFiles } from './files.js';

const FILTERS = [
  { key: 'brightness', label: 'Brightness', min: 20, max: 200, def: 100, unit: '%' },
  { key: 'contrast', label: 'Contrast', min: 20, max: 200, def: 100, unit: '%' },
  { key: 'saturate', label: 'Saturation', min: 0, max: 250, def: 100, unit: '%' },
  { key: 'hue', label: 'Hue', min: 0, max: 360, def: 0, unit: '°' },
  { key: 'blur', label: 'Blur', min: 0, max: 12, def: 0, unit: 'px', step: 0.5 },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, def: 0, unit: '%' }
];

const PRESETS = {
  'None': {}, 'Vivid': { contrast: 118, saturate: 150 }, 'B&W': { grayscale: 100, contrast: 112 },
  'Sepia': { sepia: 75 }, 'Cool': { hue: 16, saturate: 120 }, 'Warm': { sepia: 28, saturate: 125, brightness: 105 }
};

let st = null;           // editor state
let history = [];
let hIndex = -1;
let cropping = false;
let cropSel = null;      // live selection in canvas px
let origName = 'image';

const canvas = () => $('#editor-canvas');

export async function init() {
  buildFilterControls();
  buildPresets();

  $('#ed-pick').addEventListener('click', async () => {
    const recs = await pickImages({ multiple: false, title: 'Choose an image to edit' });
    if (recs[0]) await loadFileId(recs[0].id);
  });
  $('#ed-upload').addEventListener('click', () => $('#ed-upload-input').click());
  $('#ed-upload-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await loadBlob(f, f.name);
  });

  $('#ed-rot-l').addEventListener('click', () => mutate({ rotation: (state().rotation + 270) % 360 }));
  $('#ed-rot-r').addEventListener('click', () => mutate({ rotation: (state().rotation + 90) % 360 }));
  $('#ed-flip-h').addEventListener('click', () => mutate({ flipH: !state().flipH }));
  $('#ed-flip-v').addEventListener('click', () => mutate({ flipV: !state().flipV }));

  $('#ed-crop-start').addEventListener('click', startCrop);
  $('#ed-crop-cancel').addEventListener('click', endCrop);
  $('#ed-crop-apply').addEventListener('click', applyCrop);

  $('#ed-resize').addEventListener('click', () => {
    const w = Math.max(1, parseInt($('#ed-w').value, 10) || 1);
    const h = Math.max(1, parseInt($('#ed-h').value, 10) || 1);
    mutate({ scaleTo: { w, h } });
  });
  $('#ed-w').addEventListener('input', () => {
    if (!$('#ed-lock').checked || !st) return;
    const ratio = outDims().h / outDims().w;
    const w = parseInt($('#ed-w').value, 10);
    if (w > 0) $('#ed-h').value = Math.round(w * ratio);
  });
  $('#ed-h').addEventListener('input', () => {
    if (!$('#ed-lock').checked || !st) return;
    const ratio = outDims().w / outDims().h;
    const h = parseInt($('#ed-h').value, 10);
    if (h > 0) $('#ed-w').value = Math.round(h * ratio);
  });

  $('#ed-reset-filters').addEventListener('click', () => mutate({ filters: defaultFilters() }));

  $('#ed-save').addEventListener('click', saveToFiles);
  $('#ed-download').addEventListener('click', doDownload);
  $('#ed-undo').addEventListener('click', undo);
  $('#ed-redo').addEventListener('click', redo);
  $('#ed-new').addEventListener('click', () => { st = null; history = []; hIndex = -1; showStage(false); });
}

function state() { return st; }
function defaultFilters() {
  const o = {};
  FILTERS.forEach((f) => o[f.key] = f.def);
  return o;
}

/* ---------- loading ---------- */
export async function loadFileId(id) {
  const rec = await getFile(id);
  if (!rec) { toast('File not found', 'error'); return; }
  await loadBlob(rec.blob, rec.name);
}

export async function loadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    st = {
      img, name: name || 'image', rotation: 0, flipH: false, flipV: false,
      crop: null, filters: defaultFilters(), scaleTo: null
    };
    origName = st.name;
    history = [snapshot()];
    hIndex = 0;
    showStage(true);
    render();
    syncFilterInputs();
    toast(`Loaded “${st.name}” 🎨`, 'ok');
  } catch {
    toast('Could not load that image.', 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function snapshot() {
  return JSON.parse(JSON.stringify({
    rotation: st.rotation, flipH: st.flipH, flipV: st.flipV, crop: st.crop,
    filters: st.filters, scaleTo: st.scaleTo
  }));
}

function mutate(patch) {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  Object.assign(st, patch);
  history = history.slice(0, hIndex + 1);
  history.push(snapshot());
  if (history.length > 30) history.shift();
  hIndex = history.length - 1;
  render();
  syncFilterInputs();
}

function restore(snap) {
  Object.assign(st, JSON.parse(JSON.stringify(snap)));
  render();
  syncFilterInputs();
}

function undo() {
  if (!st || hIndex <= 0) return;
  restore(history[--hIndex]);
}
function redo() {
  if (!st || hIndex >= history.length - 1) return;
  restore(history[++hIndex]);
}

/* ---------- geometry ---------- */
function geoDims() {
  const img = st.img;
  const sw = st.crop ? st.crop.w : img.width;
  const sh = st.crop ? st.crop.h : img.height;
  const swap = st.rotation === 90 || st.rotation === 270;
  return { w: swap ? sh : sw, h: swap ? sw : sh };
}

function outDims() {
  const g = geoDims();
  return st.scaleTo || { w: g.w, h: g.h };
}

function filterString() {
  if (!('filter' in canvas().getContext('2d'))) return '';
  const f = st.filters;
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) hue-rotate(${f.hue}deg) blur(${f.blur}px) grayscale(${f.grayscale}%) sepia(${f.sepia}%)`;
}

/* Draw source (with crop/rotation/flip) into target ctx at given size */
function drawGeometry(ctx, w, h) {
  const img = st.img;
  const sx = st.crop ? st.crop.x : 0;
  const sy = st.crop ? st.crop.y : 0;
  const sw = st.crop ? st.crop.w : img.width;
  const sh = st.crop ? st.crop.h : img.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((st.rotation * Math.PI) / 180);
  ctx.scale(st.flipH ? -1 : 1, st.flipV ? -1 : 1);
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

function render() {
  if (!st) return;
  const { w, h } = outDims();
  const c = canvas();
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  const fs = filterString();
  if (fs) ctx.filter = fs;
  drawGeometry(ctx, w, h);
  ctx.filter = 'none';
  $('#ed-dims').textContent = `${w} × ${h} px`;
  if (document.activeElement !== $('#ed-w')) $('#ed-w').value = w;
  if (document.activeElement !== $('#ed-h')) $('#ed-h').value = h;
}

function outCanvas() {
  const { w, h } = outDims();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const fs = filterString();
  if (fs) ctx.filter = fs;
  drawGeometry(ctx, w, h);
  ctx.filter = 'none';
  return c;
}

/* ---------- crop overlay ---------- */
function startCrop() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  cropping = true; cropSel = null;
  $('#crop-layer').hidden = false;
  $('#crop-hint').hidden = false;
  $('#ed-crop-start').hidden = true;
  $('#ed-crop-apply').hidden = true;
  $('#ed-crop-cancel').hidden = false;
  setupCropLayer();
}

function endCrop() {
  cropping = false; cropSel = null;
  $('#crop-layer').hidden = true;
  $('#crop-hint').hidden = true;
  $('#ed-crop-start').hidden = false;
  $('#ed-crop-apply').hidden = true;
  $('#ed-crop-cancel').hidden = true;
  $('#crop-layer').innerHTML = '';
}

function setupCropLayer() {
  const layer = $('#crop-layer');
  layer.innerHTML = '<div class="shade"></div><div class="rect" hidden></div>';
  const rect = layer.querySelector('.rect');
  const c = canvas();
  let start = null;

  const toCanvasPx = (e) => {
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(c.width, ((e.clientX - r.left) / r.width) * c.width)),
      y: Math.max(0, Math.min(c.height, ((e.clientY - r.top) / r.height) * c.height))
    };
  };

  layer.onpointerdown = (e) => {
    layer.setPointerCapture(e.pointerId);
    start = toCanvasPx(e);
    rect.hidden = false;
  };
  layer.onpointermove = (e) => {
    if (!start) return;
    const p = toCanvasPx(e);
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    const r = c.getBoundingClientRect();
    rect.style.left = (x / c.width) * 100 + '%';
    rect.style.top = (y / c.height) * 100 + '%';
    rect.style.width = (w / c.width) * 100 + '%';
    rect.style.height = (h / c.height) * 100 + '%';
    cropSel = { x, y, w, h };
    $('#crop-size').textContent = `${Math.round(w)} × ${Math.round(h)} px`;
  };
  layer.onpointerup = () => {
    start = null;
    if (cropSel && cropSel.w > 12 && cropSel.h > 12) {
      $('#ed-crop-apply').hidden = false;
    } else {
      cropSel = null;
      rect.hidden = true;
      $('#ed-crop-apply').hidden = true;
    }
  };
}

/* map a point in canvas (display/output) space back to source image px */
function canvasToSource(px, py) {
  const img = st.img;
  const cx = (st.crop ? st.crop.x : 0) + (st.crop ? st.crop.w : img.width) / 2;
  const cy = (st.crop ? st.crop.y : 0) + (st.crop ? st.crop.h : img.height) / 2;
  const { w: W, h: H } = outDims();
  const a = (st.rotation * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  // forward: fu,fv -> x' = fu cos - fv sin ; y' = fu sin + fv cos
  const dx = px - W / 2, dy = py - H / 2;
  let fu = dx * cos + dy * sin;
  let fv = -dx * sin + dy * cos;
  if (st.flipH) fu = -fu;
  if (st.flipV) fv = -fv;
  return { x: cx + fu, y: cy + fv };
}

function applyCrop() {
  if (!cropSel) return;
  const p1 = canvasToSource(cropSel.x, cropSel.y);
  const p2 = canvasToSource(cropSel.x + cropSel.w, cropSel.y + cropSel.h);
  const img = st.img;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = clamp(Math.round(Math.min(p1.x, p2.x)), 0, img.width - 1);
  const y = clamp(Math.round(Math.min(p1.y, p2.y)), 0, img.height - 1);
  const w = clamp(Math.round(Math.abs(p2.x - p1.x)), 1, img.width - x);
  const h = clamp(Math.round(Math.abs(p2.y - p1.y)), 1, img.height - y);
  endCrop();
  st.scaleTo = null; // avoid double-applying previous resize to the new crop
  mutate({ crop: { x, y, w, h } });
  toast(`Cropped to ${w} × ${h} ✂️`, 'ok');
}

/* ---------- controls ---------- */
function buildFilterControls() {
  const wrap = $('#filter-controls');
  FILTERS.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'filter-row';
    row.innerHTML = `
      <span>${f.label}</span>
      <input type="range" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${f.def}" data-key="${f.key}">
      <output>${f.def}${f.unit}</output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.addEventListener('input', () => {
      if (!st) return;
      st.filters[f.key] = parseFloat(input.value);
      out.textContent = input.value + f.unit;
      render();
    });
    input.addEventListener('change', () => { if (st) mutate({}); });
    wrap.appendChild(row);
  });
}

function buildPresets() {
  const wrap = $('#preset-controls');
  Object.entries(PRESETS).forEach(([name, vals]) => {
    const b = document.createElement('button');
    b.className = 'btn ghost slim';
    b.textContent = name;
    b.addEventListener('click', () => {
      if (!st) { toast('Load an image first ✨', 'warn'); return; }
      const f = defaultFilters();
      Object.entries(vals).forEach(([k, v]) => f[k] = v);
      mutate({ filters: f });
    });
    wrap.appendChild(b);
  });
}

function syncFilterInputs() {
  if (!st) return;
  $$('#filter-controls input').forEach((input) => {
    const f = FILTERS.find((x) => x.key === input.dataset.key);
    input.value = st.filters[f.key];
    input.parentElement.querySelector('output').textContent = st.filters[f.key] + f.unit;
  });
}

/* ---------- export ---------- */
function exportName() {
  const base = origName.replace(/\.[^.]+$/, '') || 'image';
  const fmt = $('#ed-format').value;
  const ext = fmt === 'image/png' ? 'png' : fmt === 'image/webp' ? 'webp' : 'jpg';
  return `${base}-edited-${Date.now().toString(36)}.${ext}`;
}

function toBlob() {
  const fmt = $('#ed-format').value;
  const q = parseFloat($('#ed-quality').value) || 0.92;
  return new Promise((res) => outCanvas().toBlob((b) => res(b), fmt, q));
}

async function saveToFiles() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  const blob = await toBlob();
  const name = exportName();
  await addFile(blob, name);
  await refreshFiles();
  toast(`Saved “${name}” to Files 💾`, 'ok');
  emit('nav', 'files');
}

async function doDownload() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  const blob = await toBlob();
  download(blob, exportName());
  toast('Image downloaded ⬇️', 'ok');
}
