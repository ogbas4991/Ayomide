/* Ayomide Studio — JPEG EXIF parser & stripper (privacy: remove GPS/camera data) */

const TAG_NAMES = {
  0x10F: 'Camera make', 0x110: 'Camera model', 0x112: 'Orientation', 0x131: 'Software',
  0x132: 'Date & time', 0x9003: 'Date taken', 0x8827: 'ISO', 0x829D: 'Aperture (f-number)',
  0x829A: 'Exposure time', 0x920A: 'Focal length', 0xA002: 'Pixel width', 0xA003: 'Pixel height'
};

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readValue(view, tiffStart, entry, little) {
  const type = view.getUint16(entry + 2, little);
  const count = view.getUint32(entry + 4, little);
  const size = (TYPE_SIZES[type] || 1) * count;
  let off = entry + 8;
  if (size > 4) off = tiffStart + view.getUint32(entry + 8, little);
  try {
    if (type === 2) { // ascii
      let s = '';
      for (let i = 0; i < count - 1 && i < 64; i++) s += String.fromCharCode(view.getUint8(off + i));
      return s.trim();
    }
    if (type === 3) return view.getUint16(off, little);
    if (type === 4) return view.getUint32(off, little);
    if (type === 5) { // rational
      const num = view.getUint32(off, little);
      const den = view.getUint32(off + 4, little);
      return den ? num / den : null;
    }
    if (type === 1) return view.getUint8(off);
  } catch { return null; }
  return null;
}

function parseIFD(view, tiffStart, ifdOffset, little, out) {
  const entryCount = view.getUint16(tiffStart + ifdOffset, little);
  const GPS_REF = { 1: 0x1, 2: 0x2, 3: 0x3, 4: 0x4 };
  for (let i = 0; i < entryCount && i < 200; i++) {
    const entry = tiffStart + ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    if (tag === 0x8769) { // Exif sub-IFD
      const sub = view.getUint32(entry + 8, little);
      if (sub) parseIFD(view, tiffStart, sub, little, out);
      continue;
    }
    if (tag === 0x8825) { // GPS sub-IFD
      const sub = view.getUint32(entry + 8, little);
      if (sub) parseGPS(view, tiffStart, sub, little, out);
      continue;
    }
    const name = TAG_NAMES[tag];
    if (!name) continue;
    const v = readValue(view, tiffStart, entry, little);
    if (v === null || v === undefined || v === '') continue;
    out.tags.push({ label: name, value: v });
  }
}

function parseGPS(view, tiffStart, ifdOffset, little, out) {
  const count = view.getUint16(tiffStart + ifdOffset, little);
  const vals = {};
  for (let i = 0; i < count && i < 40; i++) {
    const entry = tiffStart + ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    vals[tag] = readValue(view, tiffStart, entry, little);
    // rationals of 3 components: read manually
    if (tag === 2 || tag === 4) {
      const type = view.getUint16(entry + 2, little);
      if (type === 5) {
        const n = view.getUint32(entry + 4, little);
        const base = tiffStart + view.getUint32(entry + 8, little);
        const parts = [];
        for (let j = 0; j < Math.min(3, n); j++) {
          const num = view.getUint32(base + j * 8, little);
          const den = view.getUint32(base + j * 8 + 4, little);
          parts.push(den ? num / den : 0);
        }
        vals[tag] = parts;
      }
    }
  }
  const lat = vals[2], lon = vals[4];
  if (Array.isArray(lat) && Array.isArray(lon)) {
    const dms = (a) => a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600;
    let la = dms(lat), lo = dms(lon);
    if (vals[1] === 'S' || vals[1] === 's') la = -la;
    if (vals[3] === 'W' || vals[3] === 'w') lo = -lo;
    out.gps = { lat: la, lon: lo };
  }
  if (vals[6] != null) out.tags.push({ label: 'Altitude (m)', value: Math.round(vals[6]) });
}

export async function parseExif(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const out = { tags: [], gps: null, hasExif: false, size: buf.length };
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return out;

  let pos = 2;
  while (pos + 4 < buf.length) {
    if (buf[pos] !== 0xFF) break;
    const marker = buf[pos + 1];
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { pos += 2; continue; }
    const len = view.getUint16(pos + 2);
    if (marker === 0xE1 && pos + 4 + 6 <= buf.length) {
      const sig = String.fromCharCode(...buf.subarray(pos + 4, pos + 10));
      if (sig.startsWith('Exif')) {
        out.hasExif = true;
        const tiffStart = pos + 10;
        const little = buf[tiffStart] === 0x49;
        const ifd0 = view.getUint32(tiffStart + 4, little);
        try { parseIFD(view, tiffStart, ifd0, little, out); } catch { }
      }
    }
    if (marker === 0xDA) break; // scan (image data) — done with metadata
    pos += 2 + len;
  }
  return out;
}

/* Remove Exif APP1 segments — returns clean JPEG blob */
export async function stripExif(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('Not a JPEG');
  const parts = [buf.subarray(0, 2)];
  let pos = 2;
  let removed = 0;
  while (pos + 4 < buf.length) {
    if (buf[pos] !== 0xFF) break;
    const marker = buf[pos + 1];
    if (marker === 0xDA) { parts.push(buf.subarray(pos)); break; }
    const len = view.getUint16(pos + 2);
    const isExifApp1 = marker === 0xE1 &&
      String.fromCharCode(...buf.subarray(pos + 4, Math.min(pos + 10, buf.length))).startsWith('Exif');
    if (!isExifApp1) parts.push(buf.subarray(pos, pos + 2 + len));
    else removed++;
    pos += 2 + len;
  }
  const clean = new Blob(parts, { type: 'image/jpeg' });
  return { blob: clean, removed };
}
