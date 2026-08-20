/* Ayomide Studio — image editor: crop, filters, draw/annotate, watermark, auto-enhance */
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

const EMOJIS = ['😀', '😂', '😍', '🥳', '😎', '🤔', '👍', '🙌', '🔥', '💖', '✨', '🎉', '⭐', '💯', '🇳🇬', '💰',
  '📸', '🎬', '🎵', '🍕', '☕', '🌸', '🌈', '⚡', '❤️', '👀', '🙏', '💪', '🤝', '🚀', '🏆', '🎯',
  '📌', '💬', '✅', '❌', '🌟', '🎊', '☀️', '🌙', '💧', '🦋', ' 🎁', '🏆', '⚠️', 'ℹ️'];

let st = null;
let history = [];
let hIndex = -1;
let cropping = false;
let cropSel = null;
let origName = 'image';

let tool = 'none';
let drawing = null;
let pendingEmoji = null;

const canvas = () => $('#editor-canvas');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export async function init() {
  buildFilterControls();
  buildPresets();
  buildEmojiPalette();
  bindTools();
  bindWatermark();

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
  $('#ed-auto').addEventListener('click', autoEnhance);

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
    const w = parseInt($('#ed-w').value, 10);
    if (w > 0) $('#ed-h').value = Math.round(w * outDims().h / outDims().w);
  });
  $('#ed-h').addEventListener('input', () => {
    if (!$('#ed-lock').checked || !st) return;
    const h = parseInt($('#ed-h').value, 10);
    if (h > 0) $('#ed-w').value = Math.round(h * outDims().w / outDims().h);
  });

  $('#ed-reset-filters').addEventListener('click', () => mutate({ filters: defaultFilters() }));
  $('#ed-clear-marks').addEventListener('click', () => { if (st?.annotations?.length) mutate({ annotations: [] }); });

  $('#ed-save').addEventListener('click', saveToFiles);
  $('#ed-download').addEventListener('click', doDownload);
  $('#ed-undo').addEventListener('click', undo);
  $('#ed-redo').addEventListener('click', redo);
  $('#ed-new').addEventListener('click', () => { st = null; history = []; hIndex = -1; showStage(false); });

  $('#ed-cutout').addEventListener('click', cutoutBackground);
  $('#ed-chroma').addEventListener('click', chromaKeyModal);
}

function state() { return st; }
function defaultFilters() {
  const o = {};
  FILTERS.forEach((f) => o[f.key] = f.def);
  return o;
}
function defaultWatermark() {
  return { on: false, text: '', pos: 'br', color: '#ffffff', size: 26, opacity: 55 };
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
      crop: null, filters: defaultFilters(), scaleTo: null,
      annotations: [], watermark: defaultWatermark()
    };
    origName = st.name;
    history = [snapshot()];
    hIndex = 0;
    showStage(true);
    render();
    syncFilterInputs();
    syncWatermarkInputs();
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
    filters: st.filters, scaleTo: st.scaleTo, annotations: st.annotations, watermark: st.watermark
  }));
}

function mutate(patch) {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  Object.assign(st, patch);
  history = history.slice(0, hIndex + 1);
  history.push(snapshot());
  if (history.length > 40) history.shift();
  hIndex = history.length - 1;
  render();
  syncFilterInputs();
}

function restore(snap) {
  Object.assign(st, JSON.parse(JSON.stringify(snap)));
  render();
  syncFilterInputs();
  syncWatermarkInputs();
}

function undo() { if (st && hIndex > 0) restore(history[--hIndex]); }
function redo() { if (st && hIndex >= 0 && hIndex < history.length - 1) restore(history[++hIndex]); }

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
  if (!st.filters) return '';
  const f = st.filters;
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) hue-rotate(${f.hue}deg) blur(${f.blur}px) grayscale(${f.grayscale}%) sepia(${f.sepia}%)`;
}

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

/* ---------- annotations ---------- */
function drawAnnotations(ctx, list) {
  for (const a of list || []) {
    ctx.save();
    if (a.type === 'brush') {
      ctx.strokeStyle = a.color; ctx.lineWidth = a.size;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      a.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    } else if (a.type === 'arrow') {
      const { x1, y1, x2, y2 } = a;
      ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = a.size;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(10, a.size * 3);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath(); ctx.fill();
    } else if (a.type === 'rect') {
      ctx.strokeStyle = a.color; ctx.lineWidth = a.size;
      ctx.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
    } else if (a.type === 'text') {
      ctx.font = `700 ${a.size * 4.5}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = a.color;
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = a.size;
      ctx.textBaseline = 'top';
      ctx.fillText(a.text, a.x, a.y);
    } else if (a.type === 'emoji') {
      ctx.font = `${a.size * 3.2}px -apple-system, "Segoe UI", Roboto, "Noto Color Emoji", sans-serif`;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(a.ch, a.x, a.y);
    } else if (a.type === 'pixel') {
      const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2);
      const w = Math.abs(a.x2 - a.x1), h = Math.abs(a.y2 - a.y1);
      if (w < 4 || h < 4) { ctx.restore(); continue; }
      const bw = Math.max(3, Math.round(w / 26));
      const bh = Math.max(3, Math.round(h / 26));
      const t = document.createElement('canvas');
      t.width = bw; t.height = bh;
      const tctx = t.getContext('2d');
      tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, bw, bh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, bw, bh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.restore();
  }
}

function drawWatermark(ctx, W, H) {
  const wm = st.watermark;
  if (!wm || !wm.on || !wm.text || !wm.text.trim()) return;
  const fs = Math.round(wm.size * (H / 1080) * 1.8);
  const pad = Math.round(Math.min(W, H) * 0.045);
  ctx.save();
  ctx.globalAlpha = wm.opacity / 100;
  ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = wm.color;
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = fs * 0.25;
  ctx.textAlign = wm.pos[1] === 'l' ? 'left' : wm.pos[1] === 'r' ? 'right' : 'center';
  ctx.textBaseline = wm.pos[0] === 't' ? 'top' : wm.pos[0] === 'b' ? 'bottom' : 'middle';
  const x = wm.pos[1] === 'l' ? pad : wm.pos[1] === 'r' ? W - pad : W / 2;
  const y = wm.pos[0] === 't' ? pad : wm.pos[0] === 'b' ? H - pad : H / 2;
  ctx.fillText(wm.text, x, y);
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
  drawAnnotations(ctx, drawing ? st.annotations.concat([drawing]) : st.annotations);
  drawWatermark(ctx, w, h);
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
  drawAnnotations(ctx, st.annotations);
  drawWatermark(ctx, w, h);
  return c;
}

/* ---------- tools ---------- */
function bindTools() {
  $$('#ed-tools button').forEach((b) => {
    b.addEventListener('click', () => {
      tool = b.dataset.tool;
      $$('#ed-tools button').forEach((x) => x.classList.toggle('active', x === b));
      $('#emoji-palette').hidden = tool !== 'emoji';
      hideTextInput();
      drawing = null;
      if (st) render();
    });
  });
  $('#ed-color').addEventListener('input', (e) => { color = e.target.value; });
  $('#ed-size').addEventListener('input', (e) => { size = parseInt(e.target.value, 10); });

  const c = canvas();
  c.style.touchAction = 'none';
  c.addEventListener('pointerdown', onPointerDown);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', onPointerUp);
}

let color = '#22d3ee', size = 6;

function toPx(e) {
  const c = canvas();
  const r = c.getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) / r.width * c.width, 0, c.width),
    y: clamp((e.clientY - r.top) / r.height * c.height, 0, c.height)
  };
}

function onPointerDown(e) {
  if (!st || cropping || tool === 'none') return;
  const p = toPx(e);
  if (tool === 'text') { showTextInput(p, e); return; }
  if (tool === 'emoji') {
    if (pendingEmoji) {
      mutate({ annotations: st.annotations.concat([{ type: 'emoji', x: p.x, y: p.y, ch: pendingEmoji, size, color: '#fff' }]) });
      pendingEmoji = null;
    }
    return;
  }
  canvas().setPointerCapture(e.pointerId);
  if (tool === 'brush') drawing = { type: 'brush', pts: [p], color, size };
  else drawing = { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, size };
  render();
}

function onPointerMove(e) {
  if (!drawing) return;
  const p = toPx(e);
  if (drawing.type === 'brush') drawing.pts.push(p);
  else { drawing.x2 = p.x; drawing.y2 = p.y; }
  render();
}

function onPointerUp() {
  if (!drawing) return;
  const d = drawing;
  drawing = null;
  const min = d.type === 'brush' ? 3 : 8;
  const moved = d.type === 'brush'
    ? d.pts.length > 2
    : (Math.abs(d.x2 - d.x1) > min || Math.abs(d.y2 - d.y1) > min);
  if (moved) mutate({ annotations: st.annotations.concat([d]) });
  else render();
}

function showTextInput(p, e) {
  const input = $('#ed-text-tool-input');
  const stage = $('#editor-stage');
  const r = stage.getBoundingClientRect();
  input.style.left = (e.clientX - r.left) + 'px';
  input.style.top = (e.clientY - r.top) + 'px';
  input.hidden = false;
  input.value = '';
  input.dataset.x = p.x;
  input.dataset.y = p.y;
  setTimeout(() => input.focus(), 30);
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      const text = input.value.trim();
      if (text) {
        mutate({
          annotations: st.annotations.concat([{
            type: 'text', x: +input.dataset.x, y: +input.dataset.y, text, color, size
          }])
        });
      }
      hideTextInput();
    }
    if (ev.key === 'Escape') hideTextInput();
  };
}
function hideTextInput() { const i = $('#ed-text-tool-input'); if (i) { i.hidden = true; i.onkeydown = null; } }

function buildEmojiPalette() {
  const wrap = $('#emoji-palette');
  EMOJIS.forEach((ch) => {
    const b = document.createElement('button');
    b.textContent = ch.trim();
    b.addEventListener('click', () => { pendingEmoji = b.textContent; toast('Now tap the image to place “' + b.textContent + '”'); });
    wrap.appendChild(b);
  });
}

function bindWatermark() {
  const upd = () => {
    if (!st) return;
    st.watermark = {
      on: $('#wm-on').checked,
      text: $('#wm-text').value,
      pos: $('#wm-pos').value,
      color: $('#wm-color').value,
      size: +$('#wm-size').value,
      opacity: +$('#wm-opacity').value
    };
    render();
  };
  const push = () => { if (st) mutate({}); };
  ['#wm-on', '#wm-text', '#wm-pos', '#wm-color', '#wm-size', '#wm-opacity'].forEach((sel) => {
    $(sel).addEventListener('input', upd);
    $(sel).addEventListener('change', push);
  });
}

function syncWatermarkInputs() {
  if (!st?.watermark) return;
  const wm = st.watermark;
  $('#wm-on').checked = wm.on;
  $('#wm-text').value = wm.text || '';
  $('#wm-pos').value = wm.pos;
  $('#wm-color').value = wm.color;
  $('#wm-size').value = wm.size;
  $('#wm-opacity').value = wm.opacity;
}

/* ---------- auto enhance ---------- */
function autoEnhance() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  const g = geoDims();
  const scale = Math.min(1, 120 / Math.max(g.w, g.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(g.w * scale));
  c.height = Math.max(1, Math.round(g.h * scale));
  const ctx = c.getContext('2d');
  drawGeometry(ctx, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(1, sum2 / n - mean * mean));
  const f = { ...st.filters };
  f.brightness = Math.round(clamp(100 * (115 / Math.max(25, mean)), 82, 132));
  f.contrast = Math.round(clamp(100 * (54 / Math.max(12, std)), 88, 148));
  f.saturate = Math.round(clamp(f.saturate * 1.12, 100, 160));
  mutate({ filters: f });
  toast(`✨ Enhanced — brightness ${f.brightness}%, contrast ${f.contrast}%, saturation ${f.saturate}%`, 'ok', 4500);
}

/* ---------- crop overlay ---------- */
function startCrop() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  cropping = true; cropSel = null;
  hideTextInput();
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
      x: clamp((e.clientX - r.left) / r.width * c.width, 0, c.width),
      y: clamp((e.clientY - r.top) / r.height * c.height, 0, c.height)
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
    let x1 = Math.min(start.x, p.x), y1 = Math.min(start.y, p.y);
    let w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    // aspect-ratio constraint
    const ratio = $('#ed-crop-ratio').value;
    if (ratio !== 'free') {
      const [rw, rh] = ratio.split(':').map(Number);
      h = Math.min(w * rh / rw, c.height);
      w = h * rw / rh;
      if (p.x < start.x) x1 = start.x - w;
      if (p.y < start.y) y1 = start.y - h;
      x1 = clamp(x1, 0, c.width - w);
      y1 = clamp(y1, 0, c.height - h);
    }
    rect.style.left = (x1 / c.width) * 100 + '%';
    rect.style.top = (y1 / c.height) * 100 + '%';
    rect.style.width = (w / c.width) * 100 + '%';
    rect.style.height = (h / c.height) * 100 + '%';
    cropSel = { x: x1, y: y1, w, h };
    $('#crop-size').textContent = `${Math.round(w)} × ${Math.round(h)} px`;
  };
  layer.onpointerup = () => {
    start = null;
    if (cropSel && cropSel.w > 12 && cropSel.h > 12) $('#ed-crop-apply').hidden = false;
    else { cropSel = null; rect.hidden = true; $('#ed-crop-apply').hidden = true; }
  };
}

function canvasToSource(px, py) {
  const img = st.img;
  const cx = (st.crop ? st.crop.x : 0) + (st.crop ? st.crop.w : img.width) / 2;
  const cy = (st.crop ? st.crop.y : 0) + (st.crop ? st.crop.h : img.height) / 2;
  const { w: W, h: H } = outDims();
  const a = (st.rotation * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
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
  const x = clamp(Math.round(Math.min(p1.x, p2.x)), 0, img.width - 1);
  const y = clamp(Math.round(Math.min(p1.y, p2.y)), 0, img.height - 1);
  const w = clamp(Math.round(Math.abs(p2.x - p1.x)), 1, img.width - x);
  const h = clamp(Math.round(Math.abs(p2.y - p1.y)), 1, img.height - y);
  endCrop();
  st.scaleTo = null;
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

function showStage(show) {
  $('#editor-placeholder').style.display = show ? 'none' : 'block';
  $('#editor-stage').hidden = !show;
}

/* ---------- magic: cutout & chroma key (baked into a new base) ---------- */
function baseOutCanvas() {
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

async function bake(canvas) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const url = URL.createObjectURL(blob);
  try {
    st.img = await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  st.crop = null;
  st.scaleTo = null;
  mutate({});
}

function cutoutBackground() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  const c = baseOutCanvas();
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const tol = 44 * 44 * 3;
  const visited = new Uint8Array(W * H);
  const stack = [];
  const seeds = [];
  for (let x = 0; x < W; x++) { seeds.push(x, x + (H - 1) * W); }
  for (let y = 0; y < H; y++) { seeds.push(y * W, W - 1 + y * W); }
  for (const si of seeds) {
    if (visited[si]) continue;
    const sr = d[si * 4], sg = d[si * 4 + 1], sb = d[si * 4 + 2];
    stack.push(si);
    visited[si] = 1;
    while (stack.length) {
      const i = stack.pop();
      const p = i * 4;
      const dr = d[p] - sr, dg = d[p + 1] - sg, db = d[p + 2] - sb;
      if (dr * dr + dg * dg + db * db > tol) continue;
      d[p + 3] = 0;
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && !visited[i + 1]) { visited[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !visited[i - W]) { visited[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && !visited[i + W]) { visited[i + W] = 1; stack.push(i + W); }
    }
  }
  ctx.putImageData(img, 0, 0);
  bake(c).then(() => toast('Background removed 🪄 — best on plain/solid backgrounds. Undo won\'t revert a bake; use ＋ New to reload.', 'info', 6000));
}

function chromaKeyModal() {
  if (!st) { toast('Load an image first ✨', 'warn'); return; }
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="muted">Replaces a colour (e.g. a green screen) everywhere in the image.</p>
    <div class="row">
      <label class="inline">Colour <input type="color" id="ck-color" value="#22c55e"></label>
      <label class="inline grow">Tolerance <input type="range" id="ck-tol" min="4" max="120" value="42"></label>
    </div>
    <label class="check"><input type="checkbox" id="ck-trans" checked> Make transparent (uncheck → replace with the colour)</label>`;
  modal({
    title: '🟩 Chroma key',
    body,
    actions: [
      { label: 'Cancel', cls: 'ghost' },
      {
        label: 'Apply', cls: 'primary', onClick: async (close) => {
          close();
          const color = body.querySelector('#ck-color').value;
          const tol = +body.querySelector('#ck-tol').value;
          const transparent = body.querySelector('#ck-trans').checked;
          const [tr, tg, tb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
          const c = baseOutCanvas();
          const ctx = c.getContext('2d');
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const d = img.data;
          const lim = tol * tol * 3;
          for (let p = 0; p < d.length; p += 4) {
            const dr = d[p] - tr, dg = d[p + 1] - tg, db = d[p + 2] - tb;
            if (dr * dr + dg * dg + db * db <= lim) {
              if (transparent) d[p + 3] = 0;
              else { d[p] = tr; d[p + 1] = tg; d[p + 2] = tb; }
            }
          }
          ctx.putImageData(img, 0, 0);
          await bake(c);
          toast('Chroma key applied 🟩', 'ok');
        }
      }
    ]
  });
}
