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

/* Export every stored file + chat history + a readme (vault files are skipped — they're encrypted) */
export async function exportEverything() {
  const files = (await allFiles()).filter((f) => !f.vault);
  const vaultCount = (await allFiles()).length - files.length;
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

/* Import files (and chat history) from a ZIP — handles our own exports plus regular zips */
export async function importZip(zipBlob, { addFile, putChatRow, allChat } ) {
  const entries = await readZip(zipBlob);
  if (!entries.length) { toast('That ZIP appears to be empty.', 'warn'); return { files: 0, chat: 0 }; }

  let fileCount = 0, chatCount = 0;
  const existingChat = new Set((await allChat()).map((r) => r.id));

  for (const e of entries) {
    if (e.name.endsWith('/') || /(^|\/)__MACOSX\//.test(e.name) || /(^|\/)\.DS_Store$/.test(e.name)) continue;
    let name = e.name;
    const isOurs = /^files\//.test(name);
    if (isOurs) name = name.replace(/^files\//, '');
    if (/^chat\/history\.json$/.test(e.name)) {
      try {
        const rows = JSON.parse(await e.blob.text());
        for (const r of rows) {
          if (r && r.id && !existingChat.has(r.id)) { await putChatRow(r); existingChat.add(r.id); chatCount++; }
        }
      } catch { /* malformed history */ }
      continue;
    }
    if (/^chat\//.test(e.name) || /^README\.txt$/.test(e.name)) continue;
    if (!name) continue;
    await addFile(e.blob, name.split('/').pop() || name);
    fileCount++;
  }
  return { files: fileCount, chat: chatCount };
}

/* Parse a ZIP archive (store + deflate) → [{name, method, blob}] */
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const td = new TextDecoder();

  // find End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = td.decode(buf.subarray(off + 46, off + 46 + nameLen));

    // local header
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + csize);

    let blob;
    if (method === 0) blob = new Blob([data]);
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress ZIP entries');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      blob = await new Response(stream).blob();
    } else throw new Error('Unsupported compression method ' + method);

    entries.push({ name, method, blob });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* Export only files (used by Files tab) */
export async function exportAllFiles() {
  const all = await allFiles();
  const files = all.filter((f) => !f.vault);
  const vaultCount = all.length - files.length;
  if (!files.length) {
    toast(vaultCount ? 'Only vault files found — restore them first to export.' : 'No files to export yet.', 'warn');
    return;
  }
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
  toast(`Exported ${files.length} file(s)${vaultCount ? ` (${vaultCount} vault file(s) skipped)` : ''}`, 'ok', 4500);
}
