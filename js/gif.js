/* Ayomide Studio — animated GIF encoder (median-cut palette + LZW, zero deps) + GIF maker tool core */

/* ---- median cut quantizer ---- */
export function buildPalette(rgba, maxColors = 255) {
  const pixels = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    pixels.push([(rgba[i] >> 4) << 4, (rgba[i + 1] >> 4) << 4, (rgba[i + 2] >> 4) << 4]);
  }
  const sample = [];
  const step = Math.max(1, Math.floor(pixels.length / 20000));
  for (let i = 0; i < pixels.length; i += step) sample.push(pixels[i]);

  let boxes = [sample];
  while (boxes.length < maxColors) {
    // split the box with the largest channel range
    let bi = -1, br = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of box) { lo = Math.min(lo, p[ch]); hi = Math.max(hi, p[ch]); }
        if (hi - lo > br) { br = hi - lo; bi = i; }
      }
    });
    if (bi < 0 || br <= 0) break;
    const box = boxes[bi];
    const ch = box.reduce((a, p) => {
      const ranges = [0, 1, 2].map((c) => {
        let lo = 255, hi = 0;
        for (const q of box) { lo = Math.min(lo, q[c]); hi = Math.max(hi, q[c]); }
        return hi - lo;
      });
      return ranges.indexOf(Math.max(...ranges));
    }, 0);
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }

  const palette = [];
  const cache = new Map();
  for (const box of boxes) {
    if (!box.length) continue;
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    palette.push([Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)]);
  }
  if (!palette.length) palette.push([0, 0, 0]);
  return palette;
}

export function mapToPalette(rgba, palette) {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let bd = Infinity;
      idx = 0;
      for (let p = 0; p < palette.length; p++) {
        const dr = palette[p][0] - r, dg = palette[p][1] - g, db = palette[p][2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; idx = p; }
      }
      cache.set(key, idx);
    }
    out[j] = rgba[i + 3] < 128 ? 255 : idx; // 255 reserved as transparent
  }
  return out;
}

/* ---- GIF LZW compressor (min code size 8) ---- */
function lzw(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let nextCode = eoiCode + 1;

  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;      // GIF packs codes LSB-first
    curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 255);
      cur >>= 8;
      curBits -= 8;
    }
  };

  emit(clearCode);
  let prefix = null;
  for (const k of indices) {
    if (prefix === null) { prefix = k; continue; }
    const key = (prefix << 12) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
    } else {
      emit(prefix);
      if (nextCode === 4096) {
        emit(clearCode);
        dict = new Map();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      } else {
        dict.set(key, nextCode++);
        if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
      }
      prefix = k;
    }
  }
  if (prefix !== null) emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

/* ---- GIF assembly ---- */
export function encodeGif(frames, { width, height, loop = true, transparentIndex = 255, palette = null } = {}) {
  /* frames: [{indices: Uint8Array, delayCs}], palette required (or frames[0].rgba to derive one) */
  const pal = palette || buildPalette(frames[0].rgba || new Uint8Array(0));
  const bytes = [];

  const w16 = (v) => bytes.push(v & 255, (v >> 8) & 255);

  // header
  for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));
  w16(width); w16(height);
  bytes.push(0xF0 | 7); // GCT flag, 256 colors
  bytes.push(0, 0);     // bg, aspect
  for (const [r, g, b] of pal) bytes.push(r, g, b);
  while (bytes.length < 13 + 256 * 3) bytes.push(0);

  if (loop) {
    for (const c of 'NETSCAPE2.0') bytes.push(c.charCodeAt(0));
    bytes.push(3, 1, 0, 0, 0);
  }

  for (const f of frames) {
    // graphic control extension
    bytes.push(0x21, 0xF9, 4);
    bytes.push(f.transparent ? 0x01 : 0x00); // transparency flag
    w16(f.delayCs ?? 10);
    bytes.push(f.transparent ? transparentIndex : 0);
    bytes.push(0);

    // image descriptor
    bytes.push(0x2C);
    w16(0); w16(0); w16(width); w16(height);
    bytes.push(0); // no LCT

    bytes.push(8); // LZW min code size
    const data = lzw(f.indices, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0); // block terminator
  }

  bytes.push(0x3B); // trailer
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

/* ---- helper: canvas frames -> gif ---- */
export async function canvasFramesToGif(canvases, { fps = 10, loop = true, transparent = false } = {}) {
  if (!canvases.length) throw new Error('No frames');
  const w = canvases[0].width;
  const h = canvases[0].height;
  // build a global palette from a sample of all frames
  let sample = new Uint8Array(0);
  const per = Math.max(1, Math.floor(canvases.length / 4));
  for (let i = 0; i < canvases.length; i += per) {
    const d = canvases[i].getContext('2d').getImageData(0, 0, w, h).data;
    const merged = new Uint8Array(sample.length + d.length);
    merged.set(sample); merged.set(d, sample.length);
    sample = merged;
  }
  const palette = buildPalette(sample, 255);
  const delayCs = Math.round(100 / fps);
  const frames = canvases.map((c) => {
    const rgba = c.getContext('2d').getImageData(0, 0, w, h).data;
    return { indices: mapToPalette(rgba, palette), delayCs, transparent, rgba };
  });
  return encodeGif(frames, { width: w, height: h, loop, palette });
}
