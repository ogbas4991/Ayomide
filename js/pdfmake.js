/* Ayomide Studio — images → PDF (minimal PDF 1.4 writer, JPEG embedding, zero deps) */

/* Pure core: pages = [{bytes: Uint8Array (JPEG), w, h}] */
export function jpegPagesToPdf(pages) {
  const enc = new TextEncoder();
  const objects = []; // 1-based ids; entries: {text} | {dict, stream}

  const push = (entry) => { objects.push(entry); return objects.length; };

  const catalogId = 1;
  const pagesId = 2;
  push(null); // catalog placeholder (id 1)
  push(null); // pages placeholder (id 2)

  const kidIds = [];
  for (const p of pages) {
    const xobjId = push({
      dict: `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>`,
      stream: p.bytes
    });
    const content = `q ${p.w} 0 0 ${p.h} 0 0 cm /Im${xobjId} Do Q`;
    const contentId = push({
      text: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    });
    const pageId = push({
      text: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${p.w} ${p.h}] ` +
        `/Resources << /XObject << /Im${xobjId} ${xobjId} 0 R >> >> /Contents ${contentId} 0 R >>`
    });
    kidIds.push(pageId);
  }

  objects[catalogId - 1] = { text: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` };
  objects[pagesId - 1] = { text: `<< /Type /Pages /Kids [${kidIds.map((id) => id + ' 0 R').join(' ')}] /Count ${kidIds.length} >>` };

  const parts = [];
  const offsets = [];
  const header = enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  parts.push(header);
  let pos = header.length;

  objects.forEach((entry, idx) => {
    const id = idx + 1;
    offsets[id] = pos;
    const head = enc.encode(`${id} 0 obj\n`);
    parts.push(head);
    pos += head.length;
    if (entry.stream) {
      const d = enc.encode(entry.dict + '\nstream\n');
      const tail = enc.encode('\nendstream\nendobj\n');
      parts.push(d, entry.stream, tail);
      pos += d.length + entry.stream.length + tail.length;
    } else {
      const b = enc.encode(entry.text + '\nendobj\n');
      parts.push(b);
      pos += b.length;
    }
  });

  const xrefStart = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  parts.push(enc.encode(xref));
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  parts.push(enc.encode(trailer));

  return new Blob(parts, { type: 'application/pdf' });
}

/* Browser wrapper: drawables (Image/canvas) → compressed pages → PDF */
export async function imagesToPdf(images) {
  const pages = [];
  for (const img of images) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, 1600 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    const jpegBlob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
    pages.push({ bytes: new Uint8Array(await jpegBlob.arrayBuffer()), w: cw, h: ch });
  }
  return jpegPagesToPdf(pages);
}
