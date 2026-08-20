/* Ayomide Studio — ZIP exporter (store method, no dependencies) */
import { download, toast } from './utils.js';
import { allFiles, allChat } from './db.js';

/* ----- CRC-32 ----- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/**
 * Build a ZIP archive (stored, uncompressed) from [{name, data: Uint8Array|string}]
 */
export function makeZip(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameU8 = enc.encode(entry.name);
    const data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);   // local header signature
    lh.setUint16(4, 20, true);           // version needed
    lh.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    lh.setUint16(8, 0, true);            // method: store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); // compressed size
    lh.setUint32(22, data.length, true); // uncompressed size
    lh.setUint16(26, nameU8.length, true);
    lh.setUint16(28, 0, true);           // extra len
    parts.push(new Uint8Array(lh.buffer), nameU8, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);   // central header signature
    ch.setUint16(4, 20, true);           // version made by
    ch.setUint16(6, 20, true);           // version needed
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameU8.length, true);
    // 30 extra len, 32 comment len, 34 disk number, 36 internal attrs = 0
    ch.setUint32(38, 0, true);           // external attrs
    ch.setUint32(42, offset, true);      // local header offset
    central.push(new Uint8Array(ch.buffer), nameU8);

    offset += 30 + nameU8.length + data.length;
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  // 4,6 disk numbers = 0
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

const u8 = async (blob) => new Uint8Array(await blob.arrayBuffer());

async function chatTranscript() {
  const rows = await allChat();
  const lines = rows.map((r) => {
    const who = r.role === 'user' ? 'You' : 'Assistant';
    const when = new Date(r.ts).toLocaleString();
    const img = r.image ? ' [image attached]' : '';
    return `[${when}] ${who}:${img} ${r.text}`;
  });
  return { txt: lines.join('\n'), json: JSON.stringify(rows, null, 2) };
}

/* Export every stored file + chat history + a readme */
export async function exportEverything() {
  const files = await allFiles();
  const { txt, json } = await chatTranscript();
  const entries = [];

  entries.push({
    name: 'README.txt',
    data: `Ayomide Studio export\nDate: ${new Date().toLocaleString()}\nFiles: ${files.length}\n\nThis archive contains every file you stored in the app plus your chat history.\nTo restore, upload these files again through the Files tab.\n`
  });

  const used = new Set();
  for (const f of files) {
    let name = f.name || 'file';
    let i = 1;
    while (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
      i++;
    }
    used.add(name.toLowerCase());
    entries.push({ name: `files/${name}`, data: await u8(f.blob) });
  }

  if (txt) {
    entries.push({ name: 'chat/transcript.txt', data: txt });
    entries.push({ name: 'chat/history.json', data: json });
  }

  if (!files.length && !txt) {
    toast('Nothing to export yet — upload some files or chat first.', 'warn');
    return;
  }

  const zip = makeZip(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  download(zip, `ayomide-studio-export-${stamp}.zip`);
  toast(`Exported ${files.length} file(s) + chat history`, 'ok');
}

/* Export only files (used by Files tab) */
export async function exportAllFiles() {
  const files = await allFiles();
  if (!files.length) { toast('No files to export yet.', 'warn'); return; }
  const entries = [];
  const used = new Set();
  for (const f of files) {
    let name = f.name || 'file';
    let i = 1;
    while (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
      i++;
    }
    used.add(name.toLowerCase());
    entries.push({ name, data: await u8(f.blob) });
  }
  download(makeZip(entries), 'ayomide-files.zip');
  toast(`Exported ${files.length} file(s)`, 'ok');
}
