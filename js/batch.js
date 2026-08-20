/* Ayomide Studio — batch image processing core (shared by the batch tool & chat actions) */
import { loadImage } from './utils.js';

export async function processImage(blob, opts = {}) {
  const {
    format = null,        // 'image/webp' | 'image/jpeg' | 'image/png' | null (keep)
    quality = 0.9,
    maxDim = null,        // longest side limit
    targetKB = null,      // smart compress until under this size
    watermark = null      // {text, pos='br', color='#fff', opacity=55, size=26}
  } = opts;

  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (maxDim) {
      const s = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    if (watermark && watermark.text) drawWatermark(ctx, w, h, watermark);

    const fmt = format || (blob.type === 'image/png' ? 'image/png' : 'image/jpeg');
    let out = await new Promise((res) => c.toBlob(res, fmt, quality));

    if (targetKB && out.size > targetKB * 1024 && fmt !== 'image/png') {
      // binary search quality, then progressively downscale
      let lo = 0.25, hi = 0.95, best = out;
      for (let i = 0; i < 6 && best.size > targetKB * 1024; i++) {
        const mid = (lo + hi) / 2;
        const cand = await new Promise((res) => c.toBlob(res, fmt, mid));
        if (cand.size > targetKB * 1024) hi = mid; else { best = cand; lo = mid; }
      }
      let scale = 0.9;
      while (best.size > targetKB * 1024 && scale > 0.2) {
        const c2 = document.createElement('canvas');
        c2.width = Math.max(1, Math.round(w * scale));
        c2.height = Math.max(1, Math.round(h * scale));
        const ctx2 = c2.getContext('2d');
        ctx2.imageSmoothingQuality = 'high';
        ctx2.drawImage(c, 0, 0, c2.width, c2.height);
        if (watermark && watermark.text) drawWatermark(ctx2, c2.width, c2.height, watermark);
        best = await new Promise((res) => c2.toBlob(res, fmt, 0.82));
        scale -= 0.1;
      }
      out = best;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function drawWatermark(ctx, W, H, wm) {
  const fs = Math.round((wm.size || 26) * (H / 1080) * 1.8);
  const pad = Math.round(Math.min(W, H) * 0.045);
  ctx.save();
  ctx.globalAlpha = (wm.opacity ?? 55) / 100;
  ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = wm.color || '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = fs * 0.25;
  const pos = wm.pos || 'br';
  ctx.textAlign = pos[1] === 'l' ? 'left' : pos[1] === 'r' ? 'right' : 'center';
  ctx.textBaseline = pos[0] === 't' ? 'top' : pos[0] === 'b' ? 'bottom' : 'middle';
  const x = pos[1] === 'l' ? pad : pos[1] === 'r' ? W - pad : W / 2;
  const y = pos[0] === 't' ? pad : pos[0] === 'b' ? H - pad : H / 2;
  ctx.fillText(wm.text, x, y);
  ctx.restore();
}

export async function batchProcess(blobs, opts, onProgress = null) {
  const results = [];
  for (let i = 0; i < blobs.length; i++) {
    try {
      results.push({ ok: true, blob: await processImage(blobs[i], opts) });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
    onProgress?.(i + 1, blobs.length);
  }
  return results;
}
