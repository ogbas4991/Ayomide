/* Ayomide Studio — Tools hub: AI image, GIF, collage, batch, PDF, EXIF, QR, trimmer, insights */
import { $, $$, toast, download, emit, loadImage, fmtBytes, fmtDate, esc, isImage, isVideo } from './utils.js';
import { allFiles, addFile, getFile } from './db.js';
import { pickImages, pickAudio, refresh as refreshFiles } from './files.js';
import { generateImage, STYLES, ocrImage, summarizeText } from './aiimage.js';
import { canvasFramesToGif } from './gif.js';
import { imagesToPdf } from './pdfmake.js';
import { parseExif, stripExif } from './exif.js';
import { drawQR, scanQR } from './qr.js';
import { batchProcess } from './batch.js';
import { makeZip } from './exporter.js';

const REGISTRY = [];
const tool = (def) => REGISTRY.push(def);

/* ================= AI IMAGE ================= */
tool({
  id: 'ai-image', name: 'AI Image Generator', icon: '🖌️',
  desc: 'Describe it — get a real image. Free endpoint or your own API.',
  async render(el) {
    el.innerHTML = `
      <p class="muted">Works without any API key (free public endpoint), or through your connected provider.</p>
      <textarea id="aiimg-prompt" rows="3" placeholder="e.g. a vibrant Lagos market at sunset, anime style"></textarea>
      <div class="chip-row" id="aiimg-styles"></div>
      <div class="row" style="margin-top:10px">
        <label class="inline">Size
          <select id="aiimg-size">
            <option value="1024x1024" selected>Square 1024</option>
            <option value="1280x720">Landscape 1280×720</option>
            <option value="720x1280">Vertical 720×1280</option>
          </select>
        </label>
        <button id="aiimg-go" class="btn primary">✨ Generate</button>
      </div>
      <div id="aiimg-result" style="margin-top:14px"></div>`;
    let style = '';
    const chips = el.querySelector('#aiimg-styles');
    STYLES.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (s.id === '' ? ' active' : '');
      b.textContent = s.label;
      b.addEventListener('click', () => {
        style = s.id;
        [...chips.children].forEach((c) => c.classList.remove('active'));
        b.classList.add('active');
      });
      chips.appendChild(b);
    });
    el.querySelector('#aiimg-go').addEventListener('click', async () => {
      const prompt = el.querySelector('#aiimg-prompt').value.trim();
      if (!prompt) { toast('Describe the image first ✍️', 'warn'); return; }
      const btn = el.querySelector('#aiimg-go');
      btn.disabled = true;
      btn.textContent = '✨ Generating… (up to ~30s)';
      const [w, h] = el.querySelector('#aiimg-size').value.split('x').map(Number);
      try {
        const blob = await generateImage(prompt + (style ? ', ' + style : ''), { width: w, height: h });
        const url = URL.createObjectURL(blob);
        const name = 'ai-' + Date.now().toString(36) + '.png';
        el.querySelector('#aiimg-result').innerHTML = `
          <img src="${url}" style="max-width:100%;border-radius:12px;border:1px solid var(--border)">
          <div class="btn-row">
            <button class="btn primary" id="aiimg-save">💾 Save to Files</button>
            <button class="btn" id="aiimg-edit">🎨 Edit it</button>
            <button class="btn ghost" id="aiimg-dl">⬇️ Download</button>
            <button class="btn ghost" id="aiimg-vid">🎬 Make video</button>
          </div>`;
        const saveRec = async () => { const rec = await addFile(blob, name); await refreshFiles(); return rec; };
        el.querySelector('#aiimg-save').addEventListener('click', async () => { await saveRec(); toast('Saved to Files 💾', 'ok'); });
        el.querySelector('#aiimg-edit').addEventListener('click', async () => {
          const rec = await saveRec();
          emit('open-editor-with', { id: rec.id });
        });
        el.querySelector('#aiimg-vid').addEventListener('click', async () => {
          const rec = await saveRec();
          emit('open-video-with', { ids: [rec.id] });
        });
        el.querySelector('#aiimg-dl').addEventListener('click', () => download(blob, name));
        toast('Image generated ✨', 'ok');
      } catch (err) {
        toast('Generation failed: ' + err.message, 'error', 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ Generate';
      }
    });
  }
});

/* ================= GIF ================= */
tool({
  id: 'gif', name: 'GIF Maker', icon: '🎞️',
  desc: 'Images or video clips → animated GIF',
  async render(el) {
    el.innerHTML = `
      <div class="btn-row">
        <button id="gif-imgs" class="btn primary">📁 Images from Files</button>
        <button id="gif-up" class="btn ghost">⬆️ Upload images</button>
        <button id="gif-vid" class="btn">🎬 From a video</button>
        <input type="file" id="gif-up-input" accept="image/*" multiple hidden>
        <input type="file" id="gif-vid-input" accept="video/*" hidden>
      </div>
      <div class="row" style="margin-top:8px">
        <label class="inline">Speed <select id="gif-fps"><option>5</option><option selected>10</option><option>15</option></select> fps</label>
        <label class="inline">Width <select id="gif-w"><option>240</option><option selected>320</option><option>480</option><option>640</option></select> px</label>
        <button id="gif-go" class="btn primary">🎞️ Make GIF</button>
      </div>
      <p class="muted" id="gif-status">No frames yet.</p>
      <div id="gif-result"></div>`;
    let frames = [];
    const status = el.querySelector('#gif-status');

    const addImages = async (blobs) => {
      frames = [];
      const w = +el.querySelector('#gif-w').value;
      for (const b of blobs.slice(0, 40)) {
        const url = URL.createObjectURL(b);
        const img = await loadImage(url);
        URL.revokeObjectURL(url);
        const h = Math.round(img.naturalHeight * w / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        frames.push(c);
      }
      status.textContent = `${frames.length} frame(s) loaded.`;
    };

    el.querySelector('#gif-imgs').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: true, title: 'Pick GIF frames (in order)' });
      if (recs.length) await addImages(recs.map((r) => r.blob));
    });
    el.querySelector('#gif-up').addEventListener('click', () => el.querySelector('#gif-up-input').click());
    el.querySelector('#gif-up-input').addEventListener('change', async (e) => { await addImages([...e.target.files]); e.target.value = ''; });
    el.querySelector('#gif-vid').addEventListener('click', () => el.querySelector('#gif-vid-input').click());
    el.querySelector('#gif-vid-input').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      toast('Sampling video frames…');
      const w = +el.querySelector('#gif-w').value;
      frames = await videoToFrames(f, { width: w, maxFrames: 20 });
      status.textContent = `${frames.length} frame(s) sampled from video.`;
    });

    el.querySelector('#gif-go').addEventListener('click', async () => {
      if (!frames.length) { toast('Add some frames first 🖼️', 'warn'); return; }
      const btn = el.querySelector('#gif-go');
      btn.disabled = true;
      btn.textContent = '⏳ Encoding…';
      try {
        // normalize frame heights
        const h = frames[0].height;
        const norm = frames.map((c) => {
          if (c.height === h) return c;
          const c2 = document.createElement('canvas');
          c2.width = Math.round(c.width * h / c.height);
          c2.height = h;
          const ctx = c2.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(c, 0, 0, c2.width, h);
          return c2;
        });
        const blob = await canvasFramesToGif(norm, { fps: +el.querySelector('#gif-fps').value, loop: true });
        const url = URL.createObjectURL(blob);
        const name = 'ayomide-' + Date.now().toString(36) + '.gif';
        el.querySelector('#gif-result').innerHTML = `
          <img src="${url}" style="max-width:100%;border-radius:12px;border:1px solid var(--border)">
          <p class="muted">${fmtBytes(blob.size)}</p>
          <div class="btn-row">
            <button class="btn primary" id="gif-save">💾 Save to Files</button>
            <button class="btn ghost" id="gif-dl">⬇️ Download</button>
          </div>`;
        el.querySelector('#gif-save').addEventListener('click', async () => { await addFile(blob, name); await refreshFiles(); toast('GIF saved 💾', 'ok'); });
        el.querySelector('#gif-dl').addEventListener('click', () => download(blob, name));
        toast('GIF ready 🎞️', 'ok');
      } catch (err) {
        toast('GIF failed: ' + err.message, 'error', 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = '🎞️ Make GIF';
      }
    });
  }
});

async function videoToFrames(file, { width = 320, maxFrames = 20 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Cannot read video')); });
    const dur = Math.min(v.duration || 3, 12);
    const h = Math.round(v.videoHeight * width / v.videoWidth) || 240;
    const out = [];
    for (let i = 0; i < maxFrames; i++) {
      const t = (dur * i) / maxFrames;
      await new Promise((res) => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done);
        v.currentTime = Math.min(t, dur - 0.05);
      });
      const c = document.createElement('canvas');
      c.width = width; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, width, h);
      out.push(c);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ================= COLLAGE ================= */
tool({
  id: 'collage', name: 'Collage Maker', icon: '🖼️',
  desc: 'Combine 2–6 photos into one layout',
  async render(el) {
    el.innerHTML = `
      <div class="btn-row">
        <button id="col-pick" class="btn primary">📁 Pick 2–6 images</button>
        <button id="col-up" class="btn ghost">⬆️ Upload</button>
        <input type="file" id="col-up-input" accept="image/*" multiple hidden>
      </div>
      <div class="row" style="margin-top:8px">
        <label class="inline">Layout
          <select id="col-layout">
            <option value="2col">2 columns</option>
            <option value="2row">2 rows</option>
            <option value="3col">3 columns</option>
            <option value="grid4" selected>Grid 2×2</option>
            <option value="grid6">Grid 2×3</option>
            <option value="feature">1 big + 2</option>
          </select>
        </label>
        <label class="inline">Gap <input id="col-gap" type="range" min="0" max="40" value="12"></label>
        <input type="color" id="col-bg" value="#0b0d14" title="Background">
        <label class="check"><input id="col-round" type="checkbox" checked> Rounded</label>
      </div>
      <button id="col-go" class="btn primary" style="margin-top:8px">🖼️ Create collage</button>
      <div id="col-result" style="margin-top:12px"></div>`;
    let imgs = [];
    const load = async (blobs) => {
      imgs = [];
      for (const b of blobs.slice(0, 6)) {
        const url = URL.createObjectURL(b);
        imgs.push(await loadImage(url));
        URL.revokeObjectURL(url);
      }
      toast(`${imgs.length} image(s) loaded`, 'ok');
    };
    el.querySelector('#col-pick').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: true, title: 'Pick 2–6 images' });
      if (recs.length) await load(recs.map((r) => r.blob));
    });
    el.querySelector('#col-up').addEventListener('click', () => el.querySelector('#col-up-input').click());
    el.querySelector('#col-up-input').addEventListener('change', async (e) => { await load([...e.target.files]); e.target.value = ''; });

    const redraw = () => { if (imgs.length >= 2) make(); };
    ['#col-gap', '#col-bg', '#col-round', '#col-layout'].forEach((s) => el.querySelector(s).addEventListener('input', redraw));

    async function make() {
      const layout = el.querySelector('#col-layout').value;
      const gap = +el.querySelector('#col-gap').value;
      const bg = el.querySelector('#col-bg').value;
      const round = el.querySelector('#col-round').checked;
      const W = 1280;
      const rects = layoutRects(layout, imgs.length, W, gap);
      const cellH = 720 / (layout === '2row' || layout === 'grid4' || layout === 'grid6' || layout === 'feature' ? 2 : 1);
      const rows = layout === '3col' || layout === '2col' ? 1 : 2;
      const H = Math.round(rects[0].h * rows + gap * (rows + 1));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      imgs.slice(0, rects.length).forEach((img, i) => {
        drawCover(ctx, img, rects[i], round ? Math.min(24, rects[i].w / 8) : 0);
      });
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const name = 'collage-' + Date.now().toString(36) + '.png';
      const url = URL.createObjectURL(blob);
      el.querySelector('#col-result').innerHTML = `
        <img src="${url}" style="max-width:100%;border-radius:12px;border:1px solid var(--border)">
        <div class="btn-row">
          <button class="btn primary" id="col-save">💾 Save to Files</button>
          <button class="btn ghost" id="col-dl">⬇️ Download</button>
        </div>`;
      el.querySelector('#col-save').addEventListener('click', async () => { await addFile(blob, name); await refreshFiles(); toast('Collage saved 💾', 'ok'); });
      el.querySelector('#col-dl').addEventListener('click', () => download(blob, name));
    }

    el.querySelector('#col-go').addEventListener('click', () => {
      if (imgs.length < 2) { toast('Pick at least 2 images 🖼️', 'warn'); return; }
      make();
    });
  }
});

function layoutRects(layout, n, W, gap) {
  const pad = gap;
  const inner = W - pad * 3;
  const half = (inner - gap) / 2;
  const third = (inner - gap * 2) / 3;
  const H = 720;
  const cell = (x, y, w, h) => ({ x, y, w, h });
  switch (layout) {
    case '2col': return [cell(pad, pad, half, H - pad * 2), cell(pad * 2 + half, pad, half, H - pad * 2)];
    case '2row': {
      const h = (H - pad * 3) / 2;
      return [cell(pad, pad, inner, h), cell(pad, pad * 2 + h, inner, h)];
    }
    case '3col': return [cell(pad, pad, third, H - pad * 2), cell(pad * 2 + third, pad, third, H - pad * 2), cell(pad * 3 + third * 2, pad, third, H - pad * 2)];
    case 'grid6': {
      const h = (H - pad * 3) / 2;
      return [0, 1, 2, 3, 4, 5].map((i) => cell(pad + (i % 3) * (third + gap), pad + Math.floor(i / 3) * (h + gap), third, h));
    }
    case 'feature':
      return [cell(pad, pad, half, H - pad * 2), cell(pad * 2 + half, pad, half, (H - pad * 3) / 2), cell(pad * 2 + half, pad * 2 + (H - pad * 3) / 2, half, (H - pad * 3) / 2)];
    default: { // grid4
      const h = (H - pad * 3) / 2;
      return [0, 1, 2, 3].map((i) => cell(pad + (i % 2) * (half + gap), pad + Math.floor(i / 2) * (h + gap), half, h));
    }
  }
}

function drawCover(ctx, img, r, radius) {
  const s = Math.max(r.w / img.naturalWidth, r.h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  const dx = r.x + (r.w - dw) / 2, dy = r.y + (r.h - dh) / 2;
  ctx.save();
  ctx.beginPath();
  if (radius && ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/* ================= BATCH ================= */
tool({
  id: 'batch', name: 'Batch Tools', icon: '⚡',
  desc: 'Convert / resize / compress / watermark many images at once',
  async render(el) {
    el.innerHTML = `
      <div class="row">
        <button id="bt-src-all" class="btn primary">All images</button>
        <button id="bt-src-pick" class="btn">📁 Choose…</button>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="inline">Convert to
          <select id="bt-format"><option value="">keep format</option><option value="image/webp">WebP</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select>
        </label>
        <label class="inline">Max dim <input id="bt-maxdim" type="number" placeholder="px" style="width:80px"></label>
        <label class="inline">Target <input id="bt-kb" type="number" placeholder="KB" style="width:80px"> KB</label>
      </div>
      <div class="row">
        <input id="bt-wm" type="text" placeholder="Watermark text (optional)">
      </div>
      <button id="bt-go" class="btn primary" style="margin-top:10px">⚡ Process</button>
      <div class="progress" id="bt-prog-wrap" hidden style="margin-top:10px"><div id="bt-prog"></div></div>
      <p class="muted" id="bt-status"></p>
      <div id="bt-result"></div>`;
    let sources = null; // null = all
    el.querySelector('#bt-src-all').addEventListener('click', () => { sources = null; el.querySelector('#bt-status').textContent = 'Source: ALL images in Files.'; });
    el.querySelector('#bt-src-pick').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: true, title: 'Pick images to batch-process' });
      if (recs.length) { sources = recs; el.querySelector('#bt-status').textContent = `Source: ${recs.length} picked image(s).`; }
    });

    el.querySelector('#bt-go').addEventListener('click', async () => {
      const files = sources ? sources : (await allFiles()).filter((f) => isImage(f.type) && !f.vault);
      if (!files.length) { toast('No images selected.', 'warn'); return; }
      const opts = {
        format: el.querySelector('#bt-format').value || null,
        maxDim: +el.querySelector('#bt-maxdim').value || null,
        targetKB: +el.querySelector('#bt-kb').value || null,
        watermark: el.querySelector('#bt-wm').value.trim() ? { text: el.querySelector('#bt-wm').value.trim(), pos: 'br', opacity: 60, size: 30 } : null
      };
      if (!opts.format && !opts.maxDim && !opts.targetKB && !opts.watermark) { toast('Pick at least one operation.', 'warn'); return; }
      const btn = el.querySelector('#bt-go');
      btn.disabled = true;
      el.querySelector('#bt-prog-wrap').hidden = false;
      const results = [];
      for (let i = 0; i < files.length; i++) {
        try {
          results.push({ name: files[i].name, blob: await batchProcess([files[i].blob], opts).then((r) => r[0].blob) });
        } catch { }
        el.querySelector('#bt-prog').style.width = ((i + 1) / files.length * 100) + '%';
      }
      btn.disabled = false;
      const origTotal = files.reduce((n, f) => n + f.size, 0);
      const newTotal = results.reduce((n, r) => n + r.blob.size, 0);
      el.querySelector('#bt-status').textContent =
        `${results.length}/${files.length} processed · ${fmtBytes(origTotal)} → ${fmtBytes(newTotal)}${origTotal > newTotal ? ` (saved ${fmtBytes(origTotal - newTotal)})` : ''}`;
      el.querySelector('#bt-result').innerHTML = `
        <div class="btn-row">
          <button class="btn primary" id="bt-save">💾 Save all to Files</button>
          <button class="btn ghost" id="bt-zip">📦 Download ZIP</button>
        </div>`;
      el.querySelector('#bt-save').addEventListener('click', async () => {
        for (const r of results) await addFile(r.blob, 'bt-' + r.name);
        await refreshFiles();
        toast(`Saved ${results.length} files 💾`, 'ok');
      });
      el.querySelector('#bt-zip').addEventListener('click', async () => {
        const entries = [];
        for (const r of results) entries.push({ name: r.name, data: new Uint8Array(await r.blob.arrayBuffer()) });
        download(makeZip(entries), 'ayomide-batch.zip');
      });
      toast('Batch done ⚡', 'ok');
    });
  }
});

/* ================= PDF ================= */
tool({
  id: 'pdf', name: 'Images → PDF', icon: '📕',
  desc: 'Turn photos/scans into a single PDF document',
  async render(el) {
    el.innerHTML = `
      <div class="btn-row">
        <button id="pdf-pick" class="btn primary">📁 Pick images</button>
        <button id="pdf-up" class="btn ghost">⬆️ Upload</button>
        <input type="file" id="pdf-up-input" accept="image/*" multiple hidden>
      </div>
      <p class="muted" id="pdf-status">No images yet — one page per image, in picking order.</p>
      <button id="pdf-go" class="btn primary" hidden>📕 Create PDF</button>
      <div id="pdf-result" style="margin-top:10px"></div>`;
    let imgs = [];
    const set = (list) => { imgs = list; el.querySelector('#pdf-go').hidden = !imgs.length; el.querySelector('#pdf-status').textContent = imgs.length ? `${imgs.length} page(s) ready.` : 'No images yet.'; };
    const load = async (blobs) => {
      const out = [];
      for (const b of blobs) {
        const url = URL.createObjectURL(b);
        out.push(await loadImage(url));
        URL.revokeObjectURL(url);
      }
      set(out);
    };
    el.querySelector('#pdf-pick').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: true, title: 'Pick images (one page each)' });
      if (recs.length) await load(recs.map((r) => r.blob));
    });
    el.querySelector('#pdf-up').addEventListener('click', () => el.querySelector('#pdf-up-input').click());
    el.querySelector('#pdf-up-input').addEventListener('change', async (e) => { await load([...e.target.files]); e.target.value = ''; });
    el.querySelector('#pdf-go').addEventListener('click', async () => {
      if (!imgs.length) return;
      const btn = el.querySelector('#pdf-go');
      btn.disabled = true;
      try {
        const blob = await imagesToPdf(imgs);
        const name = 'ayomide-' + Date.now().toString(36) + '.pdf';
        el.querySelector('#pdf-result').innerHTML = `
          <div class="btn-row">
            <button class="btn primary" id="pdf-save">💾 Save to Files (${fmtBytes(blob.size)})</button>
            <button class="btn ghost" id="pdf-dl">⬇️ Download</button>
          </div>`;
        el.querySelector('#pdf-save').addEventListener('click', async () => { await addFile(blob, name); await refreshFiles(); toast('PDF saved 💾', 'ok'); });
        el.querySelector('#pdf-dl').addEventListener('click', () => download(blob, name));
        toast(`PDF ready — ${imgs.length} page(s) 📕`, 'ok');
      } catch (err) {
        toast('PDF failed: ' + err.message, 'error');
      } finally { btn.disabled = false; }
    });
  }
});

/* ================= EXIF ================= */
tool({
  id: 'exif', name: 'EXIF Viewer & Stripper', icon: '🕵️',
  desc: 'See & remove hidden GPS/camera data from photos before sharing',
  async render(el) {
    el.innerHTML = `
      <div class="btn-row">
        <button id="ex-pick" class="btn primary">📁 Pick a photo</button>
        <button id="ex-up" class="btn ghost">⬆️ Upload</button>
        <input type="file" id="ex-up-input" accept="image/jpeg" hidden>
      </div>
      <p class="muted">Works on JPEGs (most camera/WhatsApp-save photos). Stripping removes GPS location,
      camera model, timestamps and more — the image itself is untouched.</p>
      <div id="ex-result" style="margin-top:10px"></div>`;
    const analyze = async (blob, name) => {
      const info = await parseExif(blob);
      const rows = info.tags.map((t) => `<tr><td>${esc(t.label)}</td><td>${esc(String(t.value))}</td></tr>`).join('');
      const gpsHtml = info.gps
        ? `<p>📍 <b>GPS location embedded!</b> <a href="https://www.openstreetmap.org/?mlat=${info.gps.lat.toFixed(5)}&mlon=${info.gps.lon.toFixed(5)}#map=15/${info.gps.lat.toFixed(5)}/${info.gps.lon.toFixed(5)}" target="_blank" rel="noopener">View on map ↗</a></p>`
        : '';
      el.querySelector('#ex-result').innerHTML = `
        <h4>${esc(name)}</h4>
        ${info.hasExif ? `<table class="exif-table">${rows}</table>${gpsHtml}` : '<p>✅ No EXIF metadata found — this photo is already clean.</p>'}
        <div class="btn-row">
          <button class="btn primary" id="ex-strip">🧼 Strip EXIF & save copy</button>
        </div>`;
      el.querySelector('#ex-strip').addEventListener('click', async () => {
        const { blob: clean } = await stripExif(blob);
        const nm = name.replace(/\.jpe?g$/i, '') + '-clean.jpg';
        await addFile(clean, nm);
        await refreshFiles();
        download(clean, nm);
        toast('EXIF stripped — clean copy saved & downloaded 🧼', 'ok');
        analyze(clean, nm);
      });
    };
    el.querySelector('#ex-pick').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: false, title: 'Pick a JPEG photo' });
      if (recs[0]) analyze(recs[0].blob, recs[0].name);
    });
    el.querySelector('#ex-up').addEventListener('click', () => el.querySelector('#ex-up-input').click());
    el.querySelector('#ex-up-input').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) analyze(f, f.name);
    });
  }
});

/* ================= QR ================= */
tool({
  id: 'qr', name: 'QR Studio', icon: '📱',
  desc: 'Generate styled QR codes & scan QR from images',
  async render(el) {
    el.innerHTML = `
      <div class="chip-row">
        <button class="chip active" data-qt="gen">✏️ Generate</button>
        <button class="chip" data-qt="scan">📷 Scan</button>
      </div>
      <div id="qr-gen">
        <textarea id="qr-text" rows="2" placeholder="Text or URL for the QR code">https://ogbas4991.github.io/Ayomide/</textarea>
        <div class="row" style="margin-top:8px">
          <label class="inline">Dark <input type="color" id="qr-dark" value="#0b0d14"></label>
          <label class="inline">Light <input type="color" id="qr-light" value="#ffffff"></label>
          <label class="inline">Logo <input type="file" id="qr-logo" accept="image/*"></label>
        </div>
        <button id="qr-go" class="btn primary" style="margin-top:8px">📱 Generate QR</button>
      </div>
      <div id="qr-scan" hidden>
        <div class="btn-row">
          <button id="qr-scan-pick" class="btn primary">📁 Pick image with QR</button>
          <button id="qr-scan-up" class="btn ghost">⬆️ Upload</button>
          <input type="file" id="qr-scan-input" accept="image/*" hidden>
        </div>
        <p class="muted">Scanning works on Android Chrome/Edge (camera apps can scan your generated codes too).</p>
      </div>
      <div id="qr-result" style="margin-top:12px"></div>`;
    let mode = 'gen';
    let logo = null;
    [...el.querySelectorAll('[data-qt]')].forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.qt;
      [...el.querySelectorAll('[data-qt]')].forEach((x) => x.classList.toggle('active', x === b));
      el.querySelector('#qr-gen').hidden = mode !== 'gen';
      el.querySelector('#qr-scan').hidden = mode !== 'scan';
    }));
    el.querySelector('#qr-logo').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const url = URL.createObjectURL(f);
      logo = await loadImage(url);
      URL.revokeObjectURL(url);
      toast('Logo added — it goes in the QR center 👍', 'ok');
    });
    el.querySelector('#qr-go').addEventListener('click', () => {
      const text = el.querySelector('#qr-text').value.trim();
      if (!text) { toast('Enter text or a URL first.', 'warn'); return; }
      try {
        const c = document.createElement('canvas');
        drawQR(c, text, {
          dark: el.querySelector('#qr-dark').value,
          light: el.querySelector('#qr-light').value,
          logo
        });
        const name = 'qr-' + Date.now().toString(36) + '.png';
        c.toBlob(async (blob) => {
          const url = URL.createObjectURL(blob);
          el.querySelector('#qr-result').innerHTML = '';
          el.querySelector('#qr-result').append(c, Object.assign(document.createElement('div'), {
            innerHTML: `<div class="btn-row">
              <button class="btn primary" id="qr-save">💾 Save to Files</button>
              <button class="btn ghost" id="qr-dl">⬇️ Download PNG</button>
            </div>`
          }));
          c.style.maxWidth = '100%';
          c.style.borderRadius = '12px';
          c.style.border = '1px solid var(--border)';
          el.querySelector('#qr-save').addEventListener('click', async () => { await addFile(blob, name); await refreshFiles(); toast('QR saved 💾', 'ok'); });
          el.querySelector('#qr-dl').addEventListener('click', () => download(blob, name));
        }, 'image/png');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    const scanIt = async (blob) => {
      try {
        const text = await scanQR(blob);
        el.querySelector('#qr-result').innerHTML = `
          <p style="word-break:break-all"><b>Scanned:</b></p>
          <textarea rows="3">${esc(text)}</textarea>`;
        toast('QR decoded ✅', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    el.querySelector('#qr-scan-pick').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: false, title: 'Pick an image with a QR code' });
      if (recs[0]) scanIt(recs[0].blob);
    });
    el.querySelector('#qr-scan-up').addEventListener('click', () => el.querySelector('#qr-scan-input').click());
    el.querySelector('#qr-scan-input').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) scanIt(f);
    });
  }
});

/* ================= OCR ================= */
tool({
  id: 'ocr', name: 'OCR — Text from Images', icon: '🔤',
  desc: 'Extract text from photos & scanned documents',
  async render(el) {
    el.innerHTML = `
      <div class="btn-row">
        <button id="ocr-pick" class="btn primary">📁 Pick an image</button>
        <button id="ocr-up" class="btn ghost">⬆️ Upload</button>
        <input type="file" id="ocr-up-input" accept="image/*" hidden>
      </div>
      <p class="muted">Uses your connected AI provider (Settings → AI chat provider) for accurate recognition.
      Without one, it tries the browser's built-in detector (rarely available).</p>
      <div id="ocr-result" style="margin-top:10px"></div>`;
    const run = async (blob, name) => {
      const out = el.querySelector('#ocr-result');
      out.innerHTML = '<p class="muted">⏳ Reading the image…</p>';
      try {
        const text = await ocrImage(blob);
        out.innerHTML = `
          <h4>${esc(name)}</h4>
          <textarea rows="10" id="ocr-text"></textarea>
          <div class="btn-row">
            <button class="btn primary" id="ocr-copy">📋 Copy text</button>
            <button class="btn" id="ocr-save">📄 Save as .txt to Files</button>
          </div>`;
        out.querySelector('#ocr-text').value = text || '(no text found)';
        out.querySelector('#ocr-copy').addEventListener('click', async (e) => {
          try { await navigator.clipboard.writeText(text || ''); toast('Copied 📋', 'ok'); }
          catch { toast('Select the text and copy manually.', 'warn'); }
        });
        out.querySelector('#ocr-save').addEventListener('click', async () => {
          const txt = out.querySelector('#ocr-text').value;
          const b = new Blob([txt], { type: 'text/plain' });
          await addFile(b, (name || 'image').replace(/\.[^.]+$/, '') + '-text.txt');
          await refreshFiles();
          toast('Saved as text file 📄', 'ok');
        });
        if (text) toast('Text extracted ✅', 'ok');
        else toast('No readable text found in that image.', 'warn');
      } catch (err) {
        out.innerHTML = '';
        toast(err.message, 'error', 6000);
      }
    };
    el.querySelector('#ocr-pick').addEventListener('click', async () => {
      const recs = await pickImages({ multiple: false, title: 'Pick an image with text' });
      if (recs[0]) run(recs[0].blob, recs[0].name);
    });
    el.querySelector('#ocr-up').addEventListener('click', () => el.querySelector('#ocr-up-input').click());
    el.querySelector('#ocr-up-input').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) run(f, f.name);
    });
  }
});

/* ================= VIDEO TRIMMER ================= */
tool({
  id: 'trim', name: 'Video Trimmer', icon: '✂️',
  desc: 'Cut a section of a stored video, change speed, export',
  async render(el) {
    el.innerHTML = `
      <div class="btn-row"><button id="tr-pick" class="btn primary">📁 Pick a video</button></div>
      <div id="tr-body" hidden>
        <video id="tr-video" controls playsinline style="width:100%;border-radius:12px;background:#000"></video>
        <div class="row" style="margin-top:10px">
          <label class="inline">Start <input id="tr-start" type="number" min="0" step="0.5" value="0" style="width:76px">s</label>
          <label class="inline">End <input id="tr-end" type="number" min="0" step="0.5" value="5" style="width:76px">s</label>
          <label class="inline">Speed
            <select id="tr-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
          </label>
          <label class="check"><input id="tr-mute" type="checkbox"> Mute</label>
        </div>
        <button id="tr-go" class="btn primary" style="margin-top:8px">✂️ Trim & export</button>
      </div>
      <div id="tr-result" style="margin-top:10px"></div>`;
    let src = null;
    el.querySelector('#tr-pick').addEventListener('click', async () => {
      const vids = (await allFiles()).filter((f) => isVideo(f.type) && !f.vault);
      if (!vids.length) { toast('No videos in Files — upload one first.', 'warn'); return; }
      const { modal: m } = await import('./utils.js');
      const list = document.createElement('div');
      list.className = 'btn-row wrap';
      const mm = modal({ title: 'Choose a video', body: list });
      vids.forEach((rec) => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = `🎬 ${rec.name} (${fmtBytes(rec.size)})`;
        b.addEventListener('click', async () => {
          mm.close();
          src = rec;
          const v = el.querySelector('#tr-video');
          v.src = URL.createObjectURL(rec.blob);
          await new Promise((r) => { v.onloadedmetadata = r; });
          el.querySelector('#tr-end').value = Math.min(5, Math.floor(v.duration));
          el.querySelector('#tr-end').max = v.duration;
          el.querySelector('#tr-start').max = v.duration;
          el.querySelector('#tr-body').hidden = false;
        });
        list.appendChild(b);
      });
    });
    el.querySelector('#tr-go').addEventListener('click', async () => {
      if (!src) return;
      const v = el.querySelector('#tr-video');
      const start = Math.max(0, +el.querySelector('#tr-start').value || 0);
      const end = Math.min(v.duration || 1e9, +el.querySelector('#tr-end').value || 5);
      if (end - start < 0.3) { toast('End must be after start (min 0.3s).', 'warn'); return; }
      const speed = +el.querySelector('#tr-speed').value;
      const mute = el.querySelector('#tr-mute').checked;
      const btn = el.querySelector('#tr-go');
      btn.disabled = true;
      btn.textContent = '⏳ Re-encoding in real time…';
      try {
        const blob = await trimVideo(src.blob, { start, end, speed, mute });
        const name = 'trim-' + Date.now().toString(36) + (blob.type.includes('mp4') ? '.mp4' : '.webm');
        el.querySelector('#tr-result').innerHTML = `
          <video controls playsinline src="${URL.createObjectURL(blob)}" style="width:100%;border-radius:12px;background:#000"></video>
          <div class="btn-row">
            <button class="btn primary" id="tr-save">💾 Save to Files</button>
            <button class="btn ghost" id="tr-dl">⬇️ Download</button>
          </div>`;
        el.querySelector('#tr-save').addEventListener('click', async () => { await addFile(blob, name); await refreshFiles(); toast('Saved 💾', 'ok'); });
        el.querySelector('#tr-dl').addEventListener('click', () => download(blob, name));
        toast('Trim done ✂️', 'ok');
      } catch (err) {
        toast('Trim failed: ' + err.message, 'error', 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = '✂️ Trim & export';
      }
    });
  }
});

async function trimVideo(blob, { start, end, speed = 1, mute = false }) {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.src = url;
    v.muted = mute;
    v.playsInline = true;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Cannot read video')); });
    const W = v.videoWidth || 640, H = v.videoHeight || 360;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(v, 0, 0, W, H);

    const fps = 30;
    const canvasStream = c.captureStream(fps);
    let tracks;
    try {
      const es = v.captureStream ? v.captureStream() : null;
      const audioTracks = es && !mute ? es.getAudioTracks() : [];
      tracks = [...canvasStream.getVideoTracks(), ...audioTracks];
    } catch { tracks = canvasStream.getVideoTracks(); }
    const stream = new MediaStream(tracks);

    const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2'))
      ? 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
      : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm');
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });

    v.currentTime = start;
    await new Promise((res) => { const d = () => { v.removeEventListener('seeked', d); res(); }; v.addEventListener('seeked', d); });
    rec.start(200);
    v.playbackRate = speed;
    await v.play();

    await new Promise((resolve) => {
      const loop = () => {
        if (v.currentTime >= end || v.ended) { resolve(); return; }
        ctx.drawImage(v, 0, 0, W, H);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    v.pause();
    await new Promise((r) => setTimeout(r, 250));
    rec.stop();
    await stopped;
    tracks.forEach((t) => t.stop());
    return new Blob(chunks, { type: mime });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ================= INSIGHTS ================= */
tool({
  id: 'insights', name: 'Insights', icon: '📊',
  desc: 'Storage stats, file types, largest files & activity',
  async render(el) {
    const files = await allFiles();
    const total = files.reduce((n, f) => n + f.size, 0);
    const byType = {};
    files.forEach((f) => {
      const k = f.vault ? '🔒 vault' : (f.type || 'other').split('/')[0];
      byType[k] = { n: (byType[k]?.n || 0) + 1, size: (byType[k]?.size || 0) + f.size };
    });
    const days = {};
    files.forEach((f) => {
      const d = new Date(f.addedAt).toISOString().slice(0, 10);
      days[d] = (days[d] || 0) + 1;
    });
    const last14 = [...Array(14)].map((_, i) => {
      const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
      return { d, n: days[d] || 0 };
    });
    const maxDay = Math.max(1, ...last14.map((x) => x.n));
    const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 8);
    const dupGroups = new Map();
    files.filter((f) => f.hash).forEach((f) => {
      dupGroups.set(f.hash, (dupGroups.get(f.hash) || 0) + 1);
    });
    const dupes = [...dupGroups.values()].filter((n) => n > 1).reduce((n, g) => n + g - 1, 0);

    el.innerHTML = `
      <div class="insight-cards">
        <div class="card"><b>${files.length}</b><span>files</span></div>
        <div class="card"><b>${fmtBytes(total)}</b><span>total size</span></div>
        <div class="card"><b>${files.filter((f) => f.vault).length}</b><span>in vault 🔒</span></div>
        <div class="card"><b>${dupes || 0}</b><span>likely duplicates</span></div>
      </div>
      <h4>By type</h4>
      ${Object.entries(byType).sort((a, b) => b[1].size - a[1].size).map(([k, v]) => `
        <div class="bar-row"><span class="bar-label">${esc(k)}</span>
          <div class="bar"><div style="width:${Math.max(2, v.size / total * 100)}%"></div></div>
          <span class="muted">${v.n} · ${fmtBytes(v.size)}</span></div>`).join('')}
      <h4 style="margin-top:16px">Last 14 days</h4>
      <div class="day-chart">${last14.map((x) => `
        <div class="day-col" title="${x.d}: ${x.n} file(s)"><div class="day-bar" style="height:${x.n / maxDay * 60 + 3}px"></div><span>${x.d.slice(8)}</span></div>`).join('')}
      </div>
      <h4 style="margin-top:16px">Largest files</h4>
      <ol class="big-list">${biggest.map((f) => `<li><span class="bar-label">${fileEmoji(f)} ${esc(f.name)}</span><span class="muted">${fmtBytes(f.size)} · ${fmtDate(f.addedAt)}</span></li>`).join('')}</ol>`;
  }
});

function fileEmoji(f) {
  return f.vault ? '🔒' : (f.type || '').startsWith('image/') ? '🖼️' : (f.type || '').startsWith('video/') ? '🎬' : (f.type || '').startsWith('audio/') ? '🎵' : '📄';
}

/* ================= hub wiring ================= */
export async function init() {
  const grid = $('#tools-grid');
  grid.innerHTML = '';
  REGISTRY.forEach((t) => {
    const card = document.createElement('button');
    card.className = 'tool-card';
    card.innerHTML = `<div class="tool-icon">${t.icon}</div><b>${t.name}</b><span class="muted">${t.desc}</span>`;
    card.addEventListener('click', () => openTool(t.id));
    grid.appendChild(card);
  });
  $('#tool-back').addEventListener('click', () => {
    $('#tool-detail').hidden = true;
    grid.hidden = false;
    $('#tool-body').innerHTML = '';
  });
}

export async function openTool(id) {
  const t = REGISTRY.find((x) => x.id === id);
  if (!t) return;
  emit('nav', 'tools');
  const grid = $('#tools-grid');
  await new Promise((r) => setTimeout(r, 0)); // let nav settle
  grid.hidden = true;
  const detail = $('#tool-detail');
  detail.hidden = false;
  detail.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  $('#tool-body').innerHTML = `<h3 class="tool-title">${t.icon} ${t.name}</h3>`;
  await t.render($('#tool-body'));
}

export const toolIds = () => REGISTRY.map((t) => ({ id: t.id, name: t.name, icon: t.icon }));
