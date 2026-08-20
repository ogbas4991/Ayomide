/* Ayomide Studio — smart assistant actions: chat commands that actually DO things */
import { allFiles, updateFile } from './db.js';
import { batchProcess } from './batch.js';
import { isImage, fmtBytes, emit } from './utils.js';

export async function tryAction(text) {
  const t = text.toLowerCase();

  // compress all images (optionally to ≤N kb)
  let m = t.match(/compress|reduce (the )?(size|file)/);
  if (m && /all|images|photos|pictures/.test(t)) {
    const kb = (t.match(/(\d+)\s*(kb|kilobyte)/) || [])[1];
    return runBatch({
      op: 'compress',
      targetKB: kb ? +kb : 150,
      format: 'image/jpeg',
      label: `compressed (≤${kb || 150}KB)`
    });
  }

  // watermark all images
  m = t.match(/watermark\s+(all|everything|my (images|photos|pictures))\s*(with\s+["“']?(.+?)["”']?)?$/);
  if (m) {
    const wmText = (text.match(/["“']([^"”']{1,60})["”']/) || [])[1];
    if (!wmText) {
      return { text: 'Sure — what text should the watermark say? Try: “watermark all images with © Ayomide” 💧' };
    }
    return runBatch({ op: 'watermark', watermark: { text: wmText, pos: 'br', opacity: 60, size: 30 }, label: 'watermarked' });
  }

  // convert all images to webp/png/jpeg
  m = t.match(/convert\s+(all|everything|my)?\s*(images?|photos?|pictures?)?\s*(files?)?\s*to\s+(webp|png|jpe?g)/);
  if (m) {
    const fmt = m[4] === 'webp' ? 'image/webp' : m[4] === 'png' ? 'image/png' : 'image/jpeg';
    return runBatch({ op: 'convert', format: fmt, label: `converted to ${m[4]}` });
  }

  // resize all images
  m = t.match(/resize\s+(all|everything|my)\s*(images?|photos?)?\s*(to\s*)?(\d{3,4})\s*(px|pixels)?/);
  if (m) {
    return runBatch({ op: 'resize', maxDim: +m[4], label: `resized to ${m[4]}px` });
  }

  return null;
}

async function runBatch(opts) {
  const files = (await allFiles()).filter((f) => isImage(f.type) && !f.vault);
  if (!files.length) {
    return { text: 'No (non-vault) images found in Files yet — upload some and try again 📁', actions: [{ label: '📁 Open Files', act: 'nav:files' }] };
  }
  emit('nav', 'files');
  const before = files.reduce((n, f) => n + f.size, 0);
  let done = 0, ok = 0, after = 0;
  for (const f of files) {
    try {
      const out = await batchProcess([f.blob], opts);
      if (out[0].ok && out[0].blob.size < f.size * 1.15) {
        const ext = opts.format === 'image/webp' ? '.webp' : opts.format === 'image/png' ? '.png' : '.jpg';
        const base = f.name.replace(/\.[^.]+$/, '');
        await updateFile(f.id, {
          blob: out[0].blob,
          size: out[0].blob.size,
          type: out[0].blob.type,
          name: base + '-' + (opts.op === 'watermark' ? 'wm' : opts.op) + (opts.format ? ext : (f.name.match(/\.[^.]+$/)?.[0] || '.jpg')),
          hash: null
        });
        after += out[0].blob.size;
        ok++;
      } else {
        after += f.size;
      }
    } catch { after += f.size; }
    done++;
  }
  emit('files:changed');
  const saved = before - after;
  const { refresh } = await import('./files.js');
  await refresh();
  const lines = [
    `✅ Done! Processed ${ok}/${files.length} image(s) — ${opts.label}.`,
    saved > 0 ? `Saved ${fmtBytes(saved)} of storage 🎉` : 'Sizes were already optimal for most files.',
    'Originals were replaced by the results (undo = re-upload). Tip: use the Batch tool for copies + ZIP output.'
  ];
  return { text: lines.join('\n') };
}
