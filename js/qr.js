/* Ayomide Studio — QR code generator (byte mode, versions 1–10, ECC level M) + scanner */
/* Generator written from the QR specification (ISO/IEC 18004). */

/* ---- GF(256) arithmetic ---- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

function rsGenPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gmul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse(); // highest-degree last? we keep ascending below instead
}

function rsEncode(data, ecLen) {
  // generator polynomial coefficients (ascending), reversed for synthetic division
  const gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j + 1] ^= gen[j];
      next[j] ^= gmul(gen[j], EXP[i]);
    }
    gen.splice(0, gen.length, ...next);
  }
  gen.reverse();
  const rem = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) for (let i = 0; i < ecLen; i++) rem[i] ^= gmul(gen[i + 1], factor);
  }
  return rem;
}

/* ---- version tables (ECC level M) ----
   [totalCodewords, [[blockTotal, blockData], ...]] */
const VERSIONS = {
  1: [26, [[26, 16]]],
  2: [44, [[44, 28]]],
  3: [70, [[70, 44]]],
  4: [100, [[50, 32], [50, 32]]],
  5: [134, [[67, 43], [67, 43]]],
  6: [[172].slice(0) && 172, [[43, 27], [43, 27], [43, 27], [43, 27]]],
  7: [196, [[49, 31], [49, 31], [49, 31], [49, 31]]],
  8: [242, [[60, 38], [60, 38], [61, 39], [61, 39]]],
  9: [292, [[58, 36], [58, 36], [58, 36], [59, 37], [59, 37]]],
  10: [346, [[69, 43], [69, 43], [69, 43], [69, 43], [70, 44]]]
};
const ALIGN = { 1: [6], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const [, blocks] = VERSIONS[v];
    const dataCodewords = blocks.reduce((n, [tot, dat]) => n + dat, 0);
    // mode(4) + count(8 for v<10, 16 for v10) + terminator
    const countBits = v < 10 ? 8 : 16;
    const capacityBits = dataCodewords * 8;
    const need = 4 + countBits + byteLen * 8;
    if (need + 4 <= capacityBits || (need <= capacityBits && byteLen * 8 + 4 + countBits <= capacityBits - 0)) {
      if (need <= capacityBits) return v;
    }
    if (need <= capacityBits) return v;
  }
  return null;
}

function buildCodewords(bytes, version) {
  const [total, blocks] = VERSIONS[version];
  const dataCodewords = blocks.reduce((n, [, dat]) => n + dat, 0);
  const countBits = version < 10 ? 8 : 16;
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                 // byte mode
  push(bytes.length, countBits);   // char count
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords * 8;
  push(0, Math.min(4, capacity - bits.length));      // terminator
  while (bits.length % 8 !== 0) bits.push(0);         // byte align
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  const PAD = [0xEC, 0x11];
  for (let i = 0; data.length < dataCodewords; i++) data.push(PAD[i % 2]);

  // split into blocks, compute ECC, interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let off = 0;
  for (const [, dat] of blocks) {
    dataBlocks.push(data.slice(off, off + dat));
    off += dat;
  }
  for (const db of dataBlocks) ecBlocks.push(rsEncode(db, blocks[0][0] - blocks[0][1]));
  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) dataBlocks.forEach((b) => { if (i < b.length) out.push(b[i]); });
  const maxEc = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEc; i++) ecBlocks.forEach((b) => { if (i < b.length) out.push(b[i]); });
  return { codewords: out, total };
}

/* ---- matrix drawing ---- */
function makeMatrix(version, codewords, maskId) {
  const size = version * 4 + 17;
  const modules = [];
  const isFn = [];
  for (let y = 0; y < size; y++) { modules.push(new Uint8Array(size)); isFn.push(new Uint8Array(size)); }

  const setFn = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < size && y < size && !isFn[y][x]) {
      modules[y][x] = v ? 1 : 0;
      isFn[y][x] = 1;
    }
  };

  // finder patterns + separators
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  // alignment patterns
  const centers = ALIGN[version];
  for (const cy of centers) {
    for (const cx of centers) {
      if (isFn[cy][cx]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // timing patterns
  for (let i = 0; i < size; i++) {
    if (!isFn[6][i]) { modules[6][i] = i % 2 === 0 ? 1 : 0; isFn[6][i] = 1; }
    if (!isFn[i][6]) { modules[i][6] = i % 2 === 0 ? 1 : 0; isFn[i][6] = 1; }
  }

  // reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (i !== 6) { isFn[8][i] = 1; isFn[i][8] = 1; }           // skip timing col/row
  }
  for (let i = 0; i < 8; i++) {
    isFn[8][size - 1 - i] = 1;
    isFn[size - 1 - i][8] = 1;
  }
  modules[size - 8][8] = 1; isFn[size - 8][8] = 1; // dark module

  // version info (v >= 7)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
    const bitsV = ((version << 12) | rem) & 0x1FFFFF;
    for (let i = 0; i < 18; i++) {
      const b = (bitsV >> i) & 1;
      const a = size - 11 + (i % 3), bcol = Math.floor(i / 3);
      modules[bcol][a] = b; isFn[bcol][a] = 1;   // near top-right
      modules[a][bcol] = b; isFn[a][bcol] = 1;   // near bottom-left
    }
  }

  // place data with zigzag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  const bitAt = (i) => (i < totalBits ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0);
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the timing column
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (const x of [right, right - 1]) {
        if (isFn[y][x]) continue;
        modules[y][x] = bitAt(bitIdx);
        bitIdx++;
      }
    }
    upward = !upward;
  }

  // masking
  const mask = (x, y) => {
    switch (maskId) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFn[y][x] && mask(x, y)) modules[y][x] ^= 1;
    }
  }

  // format info (ECC level M = 0b00)
  const fmtData = (0b00 << 3) | maskId;
  let fmt = fmtData << 10;
  for (let i = 4; i >= 0; i--) if ((fmt >> (i + 10)) & 1) fmt ^= 0x537 << i;
  const fmtBits = ((fmtData << 10) | fmt) ^ 0x5412;

  for (let i = 0; i <= 5; i++) modules[i][8] = (fmtBits >> i) & 1;
  modules[7][8] = (fmtBits >> 6) & 1;
  modules[8][8] = (fmtBits >> 7) & 1;
  modules[8][7] = (fmtBits >> 8) & 1;
  for (let i = 9; i < 15; i++) modules[8][14 - i] = (fmtBits >> i) & 1;
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = (fmtBits >> i) & 1;
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = (fmtBits >> i) & 1;
  modules[size - 8][8] = 1; // dark module stays set

  return { size, modules };
}

function penalty(modules, size) {
  let score = 0;
  // rule 1: runs of same colour
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (modules[y][x] === modules[y][x - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (modules[y][x] === modules[y - 1][x]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  // rule 4: dark ratio
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += modules[y][x];
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

export { buildCodewords, pickVersion };

export function qrMatrix(text, forceMask = null) {
  const bytes = new TextEncoder().encode(String(text));
  if (bytes.length === 0) throw new Error('QR text is empty');
  const version = pickVersion(bytes.length);
  if (!version) throw new Error('Text too long for QR (max ~200 chars here)');
  const { codewords } = buildCodewords(bytes, version);
  let best = null, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    if (forceMask !== null && m !== forceMask) continue;
    const mx = makeMatrix(version, codewords, m);
    const s = penalty(mx.modules, mx.size);
    if (s < bestScore) { bestScore = s; best = mx; }
  }
  return best;
}

/* Render a QR to a canvas — with colours & optional center logo */
export function drawQR(canvas, text, { scale = 8, margin = 4, dark = '#0b0d14', light = '#ffffff', logo = null } = {}) {
  const { size, modules } = qrMatrix(text);
  const dim = (size + margin * 2) * scale;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = dark;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    }
  }
  if (logo) {
    const lw = dim * 0.2;
    ctx.fillStyle = light;
    ctx.fillRect(dim / 2 - lw / 2, dim / 2 - lw / 2, lw, lw);
    try {
      ctx.drawImage(logo, dim / 2 - lw / 2 + 4, dim / 2 - lw / 2 + 4, lw - 8, lw - 8);
    } catch { /* bad logo */ }
  }
  return dim;
}

/* Scan a QR from an image blob (uses BarcodeDetector where available) */
export async function scanQR(blob) {
  if (!('BarcodeDetector' in window)) {
    throw new Error('QR scanning is not supported in this browser (try Chrome on Android)');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const codes = await det.detect(img);
    if (!codes.length) throw new Error('No QR code found in that image');
    return codes[0].rawValue;
  } finally {
    URL.revokeObjectURL(url);
  }
}
