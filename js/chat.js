/* Ayomide Studio — chat: threads, voice input, TTS, streaming AI, vision, actions, local assistant */
import { $, esc, fmtTime, toast, emit, uid, loadImage, blobToDataURL, shrinkImage, safeMath, speak, stopSpeak, isText, modal } from './utils.js';
import { addChat, allChat, clearChat, kvGet, kvSet, allThreads, putThread, deleteThread, putChatRow, deleteChatRow, allFiles } from './db.js';
import { exportEverything } from './exporter.js';
import { tryAction } from './actions.js';
import { summarizeText } from './aiimage.js';
import { openTool } from './tools.js';

let history = [];
let threads = [];
let threadId = 'default';
let attachment = null;
let busy = false;
let ttsOn = false;
let recog = null;
let listening = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUGGESTIONS = [
  '👋 What can you do?',
  '🎬 Convert an image to video',
  '✂️ How do I edit an image?',
  '📦 Export my files',
  '🎙 Tell me about voice chat'
];

export async function init() {
  const form = $('#chat-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('#chat-attach').addEventListener('click', () => $('#chat-attach-input').click());
  $('#chat-attach-input').addEventListener('change', onAttachPick);
  $('#chat-attach-remove').addEventListener('click', () => setAttachment(null));

  ttsOn = !!(await kvGet('tts', false));
  const ttsBtn = $('#chat-tts');
  ttsBtn.classList.toggle('on', ttsOn);
  ttsBtn.textContent = ttsOn ? '🔊' : '🔇';
  ttsBtn.addEventListener('click', async () => {
    ttsOn = !ttsOn;
    await kvSet('tts', ttsOn);
    ttsBtn.classList.toggle('on', ttsOn);
    ttsBtn.textContent = ttsOn ? '🔊' : '🔇';
    if (!ttsOn) stopSpeak(); else toast('Replies will now be read aloud 🔊');
  });

  $('#chat-mic').addEventListener('click', toggleMic);

  $('#btn-new-thread').addEventListener('click', () => newThread());
  $('#btn-del-thread').addEventListener('click', () => deleteCurrentThread());
  $('#thread-select').addEventListener('change', (e) => loadThread(e.target.value));

  const sugg = $('#chat-suggest');
  SUGGESTIONS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.addEventListener('click', () => { $('#chat-input').value = s; send(); });
    sugg.appendChild(b);
  });

  await refreshThreads();
  const last = await kvGet('lastThread', null);
  await loadThread(threads.some((t) => t.id === last) ? last : (threads[0]?.id || 'default'));
}

/* ---------- threads ---------- */
async function refreshThreads() {
  threads = await allThreads();
  if (!threads.length) {
    await putThread({ id: 'default', title: 'Chat', updatedAt: Date.now() });
    threads = await allThreads();
  }
  const sel = $('#thread-select');
  sel.innerHTML = '';
  threads.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.title || 'Chat';
    sel.appendChild(o);
  });
  sel.value = threadId;
}

async function newThread() {
  const id = uid();
  await putThread({ id, title: 'New chat', updatedAt: Date.now() });
  threadId = id;
  await refreshThreads();
  await loadThread(id);
}

async function deleteCurrentThread() {
  const t = threads.find((x) => x.id === threadId);
  if (!await confirm2(`Delete “${t?.title || 'chat'}”?`, 'The whole conversation will be removed from this device.')) return;
  const rows = await allChat(threadId);
  for (const r of rows) await deleteChatRow(r.id);
  await deleteThread(threadId);
  threads = await allThreads();
  if (!threads.length) await putThread({ id: 'default', title: 'Chat', updatedAt: Date.now() });
  threadId = (await allThreads())[0].id;
  await refreshThreads();
  await loadThread(threadId);
  toast('Conversation deleted 🗑');
}

async function confirm2(title, text) {
  return new Promise((resolve) => {
    import('./utils.js').then(({ confirmDialog }) =>
      confirmDialog(title, text, { danger: true, okLabel: 'Delete' }).then(resolve));
  });
}

async function maybeTitleThread(text) {
  const t = threads.find((x) => x.id === threadId);
  if (t && (!t.title || t.title === 'Chat' || t.title === 'New chat') && text) {
    t.title = text.slice(0, 34) + (text.length > 34 ? '…' : '');
    t.updatedAt = Date.now();
    await putThread(t);
    await refreshThreads();
  }
}

export async function loadThread(id) {
  threadId = id;
  await kvSet('lastThread', id);
  $('#thread-select').value = id;
  history = await allChat(id);
  $('#chat-list').innerHTML = '';
  if (!history.length) {
    const welcome = await addChat({
      role: 'assistant', threadId: id,
      text: "👋 Hi, I'm your Ayomide Studio assistant — I run right here in your browser, even offline.\n\nAsk me anything about the app, or try 🎙 voice input (tap the mic). You can also keep several conversations with the ＋ New button.",
      actions: [
        { label: '📁 Manage files', act: 'nav:files' },
        { label: '🎨 Open editor', act: 'nav:editor' },
        { label: '🎬 Make a video', act: 'nav:video' }
      ]
    });
    history.push(welcome);
  }
  history.forEach(appendMsg);
  scrollBottom();
}

/* ---------- rendering ---------- */
function appendMsg(row) {
  const el = document.createElement('div');
  el.className = `msg ${row.role}`;
  const avatar = row.role === 'user'
    ? '<div class="avatar user">🧑</div>'
    : '<div class="avatar">🤖</div>';
  const img = row.image ? `<img src="${row.image}" alt="attached image">` : '';
  const actions = (row.actions || []).map((a) =>
    `<button data-act="${esc(a.act)}">${esc(a.label)}</button>`).join('');
  el.innerHTML = `
    ${avatar}
    <div>
      <div class="bubble" data-prompt="${row.role === 'user' ? 'you@local:~$' : 'ayomide@studio:~#'}"><span class="txt"></span>${img}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      <div class="meta">${fmtTime(row.ts)}</div>
    </div>`;
  el.querySelector('.txt').innerHTML = esc(row.text).replace(/\n/g, '<br>');
  el.querySelectorAll('.actions button').forEach((b) => {
    b.addEventListener('click', () => runAction(b.dataset.act));
  });
  $('#chat-list').appendChild(el);
  scrollBottom();
}

function scrollBottom() {
  const sc = $('#chat-scroll');
  sc.scrollTop = sc.scrollHeight;
}

/* streaming bubble that we update as text arrives */
function streamBubble() {
  const el = document.createElement('div');
  el.className = 'msg typing';
  el.innerHTML = '<div class="avatar">🤖</div><div><div class="bubble" data-prompt="ayomide@studio:~#"><span class="dot-b"></span><span class="dot-b"></span><span class="dot-b"></span></div></div>';
  $('#chat-list').appendChild(el);
  scrollBottom();
  let started = false;
  return {
    set(text) {
      if (!started) {
        el.classList.remove('typing');
        el.querySelector('.bubble').innerHTML = '<span class="txt"></span>';
        started = true;
      }
      el.querySelector('.txt').innerHTML = esc(text).replace(/\n/g, '<br>');
      scrollBottom();
    }
  };
}

/* ---------- voice input ---------- */
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input is not supported in this browser (try Chrome or Edge).', 'warn', 5000); return; }
  if (listening) { try { recog.stop(); } catch { } return; }
  recog = new SR();
  recog.lang = navigator.language || 'en-US';
  recog.interimResults = true;
  recog.continuous = false;
  let finalText = '';
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    $('#chat-input').value = (finalText + interim).trim();
  };
  recog.onstart = () => { listening = true; $('#chat-mic').classList.add('listening'); toast('Listening… speak now 🎙'); };
  recog.onend = () => {
    listening = false;
    $('#chat-mic').classList.remove('listening');
    const text = $('#chat-input').value.trim();
    if (finalText.trim() && text) send();
  };
  recog.onerror = (e) => {
    listening = false;
    $('#chat-mic').classList.remove('listening');
    if (e.error !== 'aborted') toast('Voice error: ' + e.error, 'error');
  };
  try { recog.start(); } catch { }
}

/* ---------- attachments ---------- */
async function onAttachPick(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Only image attachments are supported.', 'warn'); return; }
  try {
    const small = await shrinkImage(file, 1024, 'image/jpeg', 0.82);
    const dataUrl = await blobToDataURL(small);
    setAttachment({ dataUrl, name: file.name });
  } catch {
    toast('Could not read that image.', 'error');
  }
}

function setAttachment(a) {
  attachment = a;
  const box = $('#chat-attach-box');
  if (a) { $('#chat-attach-thumb').src = a.dataUrl; box.hidden = false; }
  else box.hidden = true;
}

/* ---------- send ---------- */
async function send() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (busy) return;
  if (!text && !attachment) return;
  input.value = '';
  const img = attachment;
  setAttachment(null);
  stopSpeak();

  const userRow = await addChat({ role: 'user', threadId, text: text || '📷', image: img?.dataUrl || null });
  history.push(userRow);
  appendMsg(userRow);
  await maybeTitleThread(text);
  busy = true;

  const sb = streamBubble();
  let finalText = '';
  let actions = null;

  /* --- smart actions (chat commands that DO things) --- */
  try {
    if (/^\/?(summarize|summarise)\b/i.test(text)) {
      finalText = await summarizeFlow(sb);
      actions = null;
    } else {
      const act = await tryAction(text);
      if (act) { finalText = act.text; actions = act.actions || null; }
    }
  } catch (err) {
    finalText = '⚠️ ' + err.message;
  }

  /* --- vision (provider sees the attached image) --- */
  if (!finalText && img) {
    const cfg = await kvGet('ai', {});
    if (cfg.enabled && cfg.url && cfg.key) {
      try {
        finalText = await aiVision(cfg, img.dataUrl, text || 'Describe this image in detail.');
        await typewriter(finalText, sb.set);
      } catch { /* fall back to local analysis */ }
    }
    if (!finalText) {
      const r = await imageReply(img);
      finalText = r.text; actions = r.actions || null;
      await typewriter(finalText, sb.set);
    }
  }

  /* --- normal chat (streaming provider or local brain) --- */
  if (!finalText) {
    try {
      const cfg = await kvGet('ai', {});
      let streamed = false;
      if (cfg.enabled && cfg.url && cfg.key) {
        try {
          finalText = await aiReplyStream(cfg, text, (t) => { streamed = true; sb.set(t); });
        } catch (err) {
          toast('AI provider failed — using the local assistant.', 'warn');
        }
      }
      if (!streamed || !finalText) {
        const r = localReply(text);
        finalText = r.text; actions = r.actions || null;
        await typewriter(finalText, sb.set);
      }
    } catch (err) {
      finalText = '⚠️ ' + err.message;
      sb.set(finalText);
    }
  }

  const row = await addChat({ role: 'assistant', threadId, text: finalText, actions });
  history.push(row);
  sb.set(''); // clear placeholder element
  const last = $('#chat-list').lastChild;
  if (last?.classList.contains('typing')) last.remove();
  appendMsg(row);
  if (ttsOn) speak(finalText);
  busy = false;
}

/* pick a text file → summarize it */
async function summarizeFlow(sb) {
  const texts = (await allFiles()).filter((f) => !f.vault && isText(f.type, f.name) && f.size < 300_000);
  if (!texts.length) {
    return 'No text files found to summarize 📄 — upload one (txt/md/json/code) in the Files tab first, then try again.';
  }
  sb.set('Choosing a file…');
  const rec = await new Promise((resolve) => {
    const wrap = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'btn-row wrap';
    const m = modal({ title: 'Summarize which file?', body: wrap });
    texts.forEach((r) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `📄 ${r.name}`;
      b.addEventListener('click', () => { m.close(); resolve(r); });
      list.appendChild(b);
    });
    wrap.appendChild(list);
  });
  if (!rec) return 'Okay — cancelled.';
  const content = await rec.blob.text();
  const { text } = await summarizeText(content);
  await typewriter(text, sb.set);
  return text;
}

/* vision via OpenAI-compatible chat completions */
async function aiVision(cfg, dataUrl, question) {
  const res = await fetch(cfg.url.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error('vision HTTP ' + res.status);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('empty vision response');
  return out;
}

async function typewriter(text, set) {
  const step = Math.max(1, Math.round(text.length / 140));
  for (let i = step; i < text.length; i += step) {
    set(text.slice(0, i));
    await sleep(12);
  }
  set(text);
}

/* ---------- external AI provider (streaming) ---------- */
async function aiReplyStream(cfg, text, onDelta) {
  const msgs = history.slice(0, -1).slice(-12).map((r) => ({
    role: r.role === 'user' ? 'user' : 'assistant',
    content: (r.image ? '[image attached] ' : '') + r.text
  }));
  msgs.push({ role: 'user', content: text });
  msgs.unshift({
    role: 'system',
    content: 'You are Ayomide Assistant inside "Ayomide Studio", a PWA for chatting, file management, image editing and image-to-video conversion. Be concise, friendly and helpful. All user files stay on their device.'
  });

  const res = await fetch(cfg.url.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages: msgs, stream: true })
  });
  if (!res.ok) throw new Error(`Provider error ${res.status}`);
  if (!res.body) throw new Error('Streaming not supported by provider');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '', buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta?.content || '';
        if (d) { full += d; onDelta(full); }
      } catch { /* partial json */ }
    }
  }
  if (!full.trim()) throw new Error('Empty response from provider');
  return full.trim();
}

export async function testAI(cfg) {
  const res = await fetch(cfg.url.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the word OK' }] })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '(empty)';
}

/* ---------- image "analysis" (local) ---------- */
async function imageReply(img) {
  try {
    const im = await loadImage(img.dataUrl);
    const c = document.createElement('canvas');
    c.width = 12; c.height = 12;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return {
      text: `Nice image! 📷 Here's what I can see locally:\n• Name: ${img.name || 'attachment'}\n• Dimensions: ${im.width} × ${im.height}px\n• Average colour: ${hex}\n\nWant to do something with it?`,
      actions: [
        { label: '🎨 Edit this image', act: 'nav:editor' },
        { label: '🎬 Turn into video', act: 'nav:video' }
      ]
    };
  } catch {
    return { text: 'Got your image! Want me to show you how to edit it or turn it into a video?', actions: [{ label: '🎨 Editor', act: 'nav:editor' }, { label: '🎬 Video', act: 'nav:video' }] };
  }
}

/* ---------- local assistant brain ---------- */
function localReply(raw) {
  const text = raw.toLowerCase().trim();
  const math = safeMath(raw.replace(/[×x]/gi, '*').replace(/÷/g, '/'));
  if (math !== null) return { text: `${raw.trim()} = ${math} 🧮` };

  const navMatch = text.match(/open (the )?(chat|files?|editor|video|settings)\b/);
  if (navMatch) {
    const map = { chat: 'chat', file: 'files', files: 'files', editor: 'editor', video: 'video', settings: 'settings' };
    return { text: `Opening ${navMatch[2]} for you… ✅`, actions: [{ label: `Go to ${navMatch[2]}`, act: 'nav:' + map[navMatch[2]] }] };
  }

  const R = [
    {
      re: /(generate|create|make|draw).{0,24}(image|picture|art|logo|wallpaper)/,
      reply: () => ({
        text: "🖌️ I can do that! The AI Image Generator turns a description into a real image — free, no API key needed. From there you can edit it, watermark it, or drop it straight into a video.",
        actions: [{ label: '🖌️ Generate an image', act: 'tool:ai-image' }]
      })
    },
    {
      re: /\bgif\b/,
      reply: () => ({
        text: "🎞️ The GIF Maker turns images (or video clips) into animated GIFs — pick frames, speed and width, done.",
        actions: [{ label: '🎞️ Make a GIF', act: 'tool:gif' }]
      })
    },
    {
      re: /\bqr\b|barcode/,
      reply: () => ({
        text: "📱 QR Studio generates styled QR codes (your colours, even your logo in the middle) and can scan QR images on supported phones.",
        actions: [{ label: '📱 Open QR Studio', act: 'tool:qr' }]
      })
    },
    {
      re: /\bpdf\b/,
      reply: () => ({
        text: "📕 Images → PDF: pick your photos/scans and get one clean PDF — one page per image. Perfect for documents and receipts.",
        actions: [{ label: '📕 Create a PDF', act: 'tool:pdf' }]
      })
    },
    {
      re: /\bocr\b|extract (the )?text|read (the )?text|scan(ned)? (doc|document)/,
      reply: () => ({
        text: "🔤 OCR pulls text out of photos and scanned documents. It uses your connected AI provider (connect one in Settings for best results).",
        actions: [{ label: '🔤 Extract text', act: 'tool:ocr' }]
      })
    },
    {
      re: /exif|gps|location data|metadata/,
      reply: () => ({
        text: "🕵️ The EXIF tool shows hidden photo metadata (GPS location, camera, timestamps) and strips it with one tap — share safely.",
        actions: [{ label: '🕵️ Check a photo', act: 'tool:exif' }]
      })
    },
    {
      re: /collage|grid of photos|combine (photos|images)/,
      reply: () => ({
        text: "🖼️ The Collage Maker combines 2–6 photos into layouts (grid, feature, strips) with gaps, colours and rounded corners.",
        actions: [{ label: '🖼️ Make a collage', act: 'tool:collage' }]
      })
    },
    {
      re: /trim|cut (a )?video|video (to )?shorter/,
      reply: () => ({
        text: "✂️ The Video Trimmer cuts any stored video — set start/end, change speed (0.5×–2×), optionally mute, then export.",
        actions: [{ label: '✂️ Trim a video', act: 'tool:trim' }]
      })
    },
    {
      re: /batch|compress all|convert all|resize all|watermark all/,
      reply: () => ({
        text: "⚡ Batch Tools process many images at once — convert (WebP/JPEG/PNG), resize, smart-compress to a KB target, or watermark everything. You can also just tell me directly, e.g. “compress all images to 100kb” or “watermark all images with © Ayomide”.",
        actions: [{ label: '⚡ Open Batch Tools', act: 'tool:batch' }]
      })
    },
    {
      re: /voice|speak|microphone|talk to you|say it/,
      reply: () => ({
        text: "🎙 Voice mode: tap the mic button next to the message box and just talk — I'll type it out and send automatically.\n\nWant me to answer out loud too? Tap the 🔊 button and I'll read every reply to you.",
        actions: []
      })
    },
    {
      re: /thread|conversation|new chat|multiple chats/,
      reply: () => ({
        text: "🔗 You can keep as many conversations as you like: tap “＋ New” above the chat to start a fresh thread, and use the dropdown to switch between them. Each thread remembers its full history.",
        actions: []
      })
    },
    {
      re: /sync|cloud|another (device|phone|laptop)|backup online/,
      reply: () => ({
        text: "☁️ Cloud sync: go to Settings → Cloud sync, sign in to your own sync server (there's a free one-click deploy for Render in the README), and tap “Sync now”. Your files and chats stay identical across your devices.",
        actions: [{ label: '⚙️ Open Settings', act: 'nav:settings' }]
      })
    },
    {
      re: /vault|encrypt|private|hide/,
      reply: () => ({
        text: "🔒 The Vault: enable app lock in Settings first (PIN, optionally fingerprint). Then any file's card gets a 🔒 button — tapping it moves the file into the Vault, encrypted with AES-256. Without your PIN it's just noise.",
        actions: [{ label: '⚙️ Set up in Settings', act: 'nav:settings' }]
      })
    },
    {
      re: /music|audio|song|sound/,
      reply: () => ({
        text: "🎵 Add music to your videos: in Image → Video, scroll to the Music section, pick an audio file (from Files or upload), set the volume, and render. The track is mixed into the exported video file.",
        actions: [{ label: '🎬 Open Image → Video', act: 'nav:video' }]
      })
    },
    {
      re: /watermark|copyright|logo on/,
      reply: () => ({
        text: "💧 Watermarks: open an image in the Editor and scroll to the Watermark section — your text, position (9 spots), colour, size and opacity. It's baked into every export (Save or Download).",
        actions: [{ label: '🎨 Open Editor', act: 'nav:editor' }]
      })
    },
    {
      re: /draw|annotate|arrow|sticker|pixelate|blur.*hide|hide.*part/,
      reply: () => ({
        text: "✍️ In the Editor's Tools section you can: paint with a brush, add arrows & rectangles, place text and emoji stickers, and pixelate areas (perfect for hiding faces or sensitive info). Undo/redo works on every mark.",
        actions: [{ label: '🎨 Open Editor', act: 'nav:editor' }]
      })
    },
    {
      re: /((image|photo|picture|pic)[^.]*?(video|reel|slideshow|mp4))|((video|reel)[^.]*?(image|photo|picture))|convert[^.]*(video)|turn[^.]*(video)|image to video|photo to video|make (a |me )?video/,
      reply: () => ({
        text: "🎬 Easy! The Image → Video tab turns your images into a real video file:\n\n1. Go to Image → Video (button below)\n2. Pick one or more images, add a music track if you like\n3. Choose duration, motion (zoom/pan), resolution (landscape, square or Reels) and fades\n4. Tap 🎬 Render video, then save it to Files or download it",
        actions: [{ label: '🎬 Open Image → Video', act: 'nav:video' }]
      })
    },
    {
      re: /how.{0,20}edit|edit(or)?[^.]*(image|photo|picture)|crop|rotate|flip|filter|resize|brighten|enhance/,
      reply: () => ({
        text: "🎨 The Editor covers it all:\n\n• ✨ Auto-enhance (one tap)\n• Rotate ⟲ ⟳, flip ⇋ ⇵, crop with ratio presets (1:1, 4:5, 16:9, 9:16…)\n• Resize with locked aspect ratio\n• 7 filter sliders + presets, undo/redo\n• Draw, arrows, text, emoji stickers, pixelate\n• Watermark, then export PNG/JPEG/WebP",
        actions: [{ label: '🎨 Open Editor', act: 'nav:editor' }]
      })
    },
    {
      re: /export|download|backup|zip|save (all|my|everything)/,
      reply: () => ({
        text: "📦 Export options:\n\n• Single file — Files tab → ⬇️ on any card\n• Everything — Files → “Export all (.zip)” (files + chat history)\n• Import back — the 🧳 button restores any backup ZIP on any device\n\nTip:ZIP backups work across devices, and cloud sync keeps everything live.",
        actions: [
          { label: '📦 Export everything now', act: 'op:export' },
          { label: '📁 Open Files', act: 'nav:files' }
        ]
      })
    },
    {
      re: /upload|add (a )?file|import|attach|share (sheet|into)|send (files? )?here/,
      reply: () => ({
        text: "📤 To get files in:\n\n• Drag & drop or “Choose files” in the Files tab\n• On Android/Chrome you can share images from other apps straight to Ayomide Studio (it appears in the share sheet)\n• Organize with folders 📁 and tags, find duplicates with ♻️",
        actions: [
          { label: '📤 Upload a file', act: 'op:upload' },
          { label: '📁 Open Files', act: 'nav:files' }
        ]
      })
    },
    {
      re: /install|pwa|home screen|offline|add to (home|device)/,
      reply: () => ({
        text: "📲 Ayomide Studio is a Progressive Web App — install it and it works offline:\n\n• Chrome/Edge (desktop): install icon in the address bar, or “Install app” in the sidebar\n• Android: menu ⋮ → Add to Home screen / Install app\n• iPhone/iPad (Safari): Share → Add to Home Screen"
      })
    },
    {
      re: /(who are you|your name|what are you|about you)/,
      reply: () => ({
        text: "I'm the Ayomide Studio assistant 🤖 — a built-in helper that runs 100% in your browser (no server, no account, works offline). I can guide you through chatting (voice too!), file management, editing, image-to-video, exporting and sync.\n\nTip: connect your own OpenAI-compatible API in Settings and I become a full streaming AI chatbot."
      })
    },
    {
      re: /privacy|my data|cloud|server|safe/,
      reply: () => ({
        text: "🔒 Privacy by design: files and chats live in your browser's storage on this device. Nothing is uploaded unless you personally enable Cloud sync or connect an AI provider — and then only you have the credentials. Vault files are AES-256 encrypted at rest."
      })
    },
    {
      re: /help|what can you do|features|capab|guide|how (do|to) (i )?use/,
      reply: () => ({
        text: "Here's everything 👇\n\n💬 Chat — voice input 🎙, spoken replies 🔊, multiple threads\n📁 Files — folders, tags, gallery view, duplicate finder, ZIP import/export, encrypted Vault 🔒\n🎨 Editor — auto-enhance, crop presets, filters, draw/annotate, watermark\n🎬 Image → Video — motion, fades, music 🎵, text titles\n☁️ Sync — your files & chats on every device\n📦 Export — any file, or everything as ZIP\n\nAll offline-capable, on your device.",
        actions: [
          { label: '📁 Files', act: 'nav:files' },
          { label: '🎨 Editor', act: 'nav:editor' },
          { label: '🎬 Video', act: 'nav:video' }
        ]
      })
    },
    {
      re: /clear|delete|wipe|reset/,
      reply: () => ({
        text: "🧹 I can clear things:\n\n• This conversation — the 🗑 button above the chat\n• All chat history — Settings → Clear chat history\n• Files — the ✕ on any card, bulk-select, or Settings → Delete all files",
        actions: [{ label: '⚙️ Open Settings', act: 'nav:settings' }]
      })
    },
    {
      re: /joke|funny|laugh/,
      reply: () => {
        const jokes = [
          "Why did the image go to therapy? It had too many unresolved issues… and one very cropped past. 🖼️",
          "I asked the video how it was feeling. It said: “I'm just a series of good frames.” 🎬",
          "Why don't programmers like nature? Too many bugs and no debugger. 🐛",
          "My favourite kind of humor? Dry — like a perfectly compressed PNG. 😄"
        ];
        return { text: jokes[Math.floor(Math.random() * jokes.length)] };
      }
    },
    {
      re: /time|date|today|day is it/,
      reply: () => ({ text: `🕒 It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.` })
    },
    {
      re: /^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b/,
      reply: () => ({
        text: `Hey! 👋 ${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'} — what would you like to do today?`,
        actions: [
          { label: '🎬 Image → Video', act: 'nav:video' },
          { label: '🎨 Edit an image', act: 'nav:editor' },
          { label: '📁 My files', act: 'nav:files' }
        ]
      })
    },
    {
      re: /thank|thanks|thx|appreciate/,
      reply: () => ({ text: "You're very welcome! 😊 Anything else — editing, a video with music, exporting — just say the word (or tap 🎙 and say it out loud)." })
    },
    {
      re: /(api|key|openai|groq|openrouter|ollama|connect).{0,40}(ai|model|chat)?|real ai|chatgpt|gpt/,
      reply: () => ({
        text: "🔌 Want a full AI chatbot? Settings → AI chat provider — connect any OpenAI-compatible API (OpenAI, Groq, OpenRouter, local Ollama…). Replies then stream in live. Until then, I'll keep answering locally — your key is stored only on this device.",
        actions: [{ label: '⚙️ Open Settings', act: 'nav:settings' }]
      })
    }
  ];

  for (const { re, reply } of R) {
    if (re.test(text)) return reply();
  }

  return {
    text: "I'm mostly built for helping you run this studio 😄 — but try me on:\n\n• “Convert an image into a video with music”\n• “How do I edit / crop an image?”\n• “What's the vault?” · “Set up sync”\n• “Export my files” · “Tell me a joke”\n\nOr connect your own AI provider in Settings and I become a full chatbot.",
    actions: [
      { label: '🎬 Video', act: 'nav:video' },
      { label: '🎨 Editor', act: 'nav:editor' },
      { label: '⚙️ Settings', act: 'nav:settings' }
    ]
  };
}

/* ---------- message action buttons ---------- */
export async function resetChat() {
  await clearChat();
  await deleteThread(threadId).catch(() => { });
  await putThread({ id: threadId, title: 'Chat', updatedAt: Date.now() });
  await loadThread(threadId);
}

async function runAction(act) {
  if (act.startsWith('nav:')) emit('nav', act.slice(4));
  else if (act.startsWith('tool:')) openTool(act.slice(5));
  else if (act === 'op:upload') { emit('nav', 'files'); setTimeout(() => emit('op', 'upload'), 80); }
  else if (act === 'op:export') exportEverything();
  else if (act === 'op:clear') {
    const { confirmDialog } = await import('./utils.js');
    if (await confirmDialog('Clear chat?', 'This deletes the conversation history from this device.', { danger: true, okLabel: 'Clear' })) {
      await resetChat();
    }
  }
}

export { putChatRow };
