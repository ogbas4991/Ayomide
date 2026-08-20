/* Ayomide Studio — AI services: text-to-image, OCR, summarization */
import { kvGet } from './db.js';
import { toast, blobToDataURL, shrinkImage } from './utils.js';

const STYLES = [
  { id: '', label: 'None' },
  { id: 'photorealistic, high detail, 50mm photo', label: '📷 Photo' },
  { id: 'anime style, vibrant, studio ghibli inspired', label: '🌸 Anime' },
  { id: 'digital art, concept art, dramatic lighting', label: '🎨 Digital art' },
  { id: 'watercolor painting, soft edges', label: '🖌️ Watercolor' },
  { id: '3d render, octane, soft studio light', label: '🧊 3D render' },
  { id: 'minimalist flat vector illustration', label: '✏️ Flat' },
  { id: 'cyberpunk, neon, futuristic', label: '🌃 Cyberpunk' },
  { id: 'african wax print pattern, bold colors', label: '🇳🇬 Ankara' }
];

export { STYLES };

/* ---- text-to-image ---- */
export async function generateImage(prompt, { width = 1024, height = 1024 } = {}) {
  const ai = await kvGet('ai', {});
  // 1) user's provider (OpenAI-compatible images API)
  if (ai.enabled && ai.url && ai.key) {
    try {
      const res = await fetch(ai.url.replace(/\/+$/, '') + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.key },
        body: JSON.stringify({ prompt, n: 1, size: `${width}x${height}`, response_format: 'b64_json' })
      });
      if (res.ok) {
        const data = await res.json();
        const b64 = data.data?.[0]?.b64_json;
        const url = data.data?.[0]?.url;
        if (b64) return fetch('data:image/png;base64,' + b64).then((r) => r.blob());
        if (url) return fetch(url).then((r) => r.blob());
      }
    } catch { /* fall through to free endpoint */ }
  }
  // 2) free public endpoint (no key)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('Generation service returned ' + res.status);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size < 1000) throw new Error('Generation failed — try again');
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- OCR ---- */
export async function ocrImage(blob) {
  const ai = await kvGet('ai', {});
  if (ai.enabled && ai.url && ai.key) {
    const small = await shrinkImage(blob, 1400, 'image/jpeg', 0.85).catch(() => blob);
    const dataUrl = await blobToDataURL(small);
    const res = await fetch(ai.url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.key },
      body: JSON.stringify({
        model: ai.model || 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract ALL text from this image. Return only the text content, preserving line breaks. If there is no text, return "(none)".' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }]
      })
    });
    if (!res.ok) throw new Error('OCR via provider failed (HTTP ' + res.status + ')');
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text && text !== '(none)') return text;
    return '';
  }
  // browser-native detector (rare)
  if ('TextDetector' in window) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
      const det = new window.TextDetector();
      const results = await det.detect(img);
      return results.map((r) => r.rawValue).join('\n');
    } finally { URL.revokeObjectURL(url); }
  }
  throw new Error('Connect an AI provider in Settings (OpenAI/Groq/OpenRouter…) to use OCR');
}

/* ---- summaries ---- */
export function naiveSummary(text, maxSentences = 3) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [text.slice(0, 200)];
  const freq = new Map();
  const STOP = new Set('the a an and or of to in is are was were be been it this that for on with as at by from you your i we they he she not but if then than so do does did have has had will would can could'.split(' '));
  for (const w of text.toLowerCase().match(/[a-z']+/g) || []) {
    if (STOP.has(w) || w.length < 3) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const scored = sentences.map((s, i) => {
    let score = 0;
    for (const w of s.toLowerCase().match(/[a-z']+/g) || []) score += freq.get(w) || 0;
    return { s: s.trim(), score, i };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.i - b.i).map((x) => '• ' + x.s).join('\n');
}

export async function summarizeText(text, instruction = 'Summarize this concisely in 3-5 bullet points:') {
  const ai = await kvGet('ai', {});
  if (ai.enabled && ai.url && ai.key) {
    try {
      const res = await fetch(ai.url.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.key },
        body: JSON.stringify({
          model: ai.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: instruction + '\n\n' + text.slice(0, 12000) }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const out = data.choices?.[0]?.message?.content?.trim();
        if (out) return { text: out, source: 'ai' };
      }
    } catch { /* fall back */ }
  }
  return { text: 'Offline summary (connect an AI provider for smarter results):\n\n' + naiveSummary(text), source: 'local' };
}
