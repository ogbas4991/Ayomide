/* Ayomide Studio — chat with built-in assistant (optional external AI provider) */
import { $, esc, fmtTime, toast, emit, loadImage, blobToDataURL, shrinkImage, safeMath } from './utils.js';
import { addChat, allChat, clearChat, kvGet } from './db.js';
import { exportEverything } from './exporter.js';

let history = [];
let attachment = null; // { dataUrl, name }
let busy = false;

const SUGGESTIONS = [
  '👋 What can you do?',
  '🎬 Convert an image to video',
  '✂️ How do I edit an image?',
  '📦 Export my files',
  '📤 How do I upload files?'
];

export async function init() {
  const form = $('#chat-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('#chat-attach').addEventListener('click', () => $('#chat-attach-input').click());
  $('#chat-attach-input').addEventListener('change', onAttachPick);
  $('#chat-attach-remove').addEventListener('click', () => setAttachment(null));

  const sugg = $('#chat-suggest');
  SUGGESTIONS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.addEventListener('click', () => { $('#chat-input').value = s; send(); });
    sugg.appendChild(b);
  });

  history = await allChat();
  if (!history.length) {
    const welcome = await addChat({
      role: 'assistant',
      text: "👋 Hi, I'm your Ayomide Studio assistant — I run right here in your browser, even offline.\n\nI can help you chat, upload & manage files, edit images, and turn images into videos. Ask me how, or use the buttons below.",
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
  const actions = (row.actions || []).map((a, i) =>
    `<button data-act="${esc(a.act)}" data-i="${i}">${esc(a.label)}</button>`).join('');
  el.innerHTML = `
    ${avatar}
    <div>
      <div class="bubble">${esc(row.text).replace(/\n/g, '<br>')}${img}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      <div class="meta">${fmtTime(row.ts)}</div>
    </div>`;
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

let typingEl = null;
function showTyping() {
  typingEl = document.createElement('div');
  typingEl.className = 'msg typing';
  typingEl.innerHTML = '<div class="avatar">🤖</div><div class="bubble"><span class="dot-b"></span><span class="dot-b"></span><span class="dot-b"></span></div>';
  $('#chat-list').appendChild(typingEl);
  scrollBottom();
}
function hideTyping() { typingEl?.remove(); typingEl = null; }

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
  else { box.hidden = true; }
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

  const userRow = await addChat({ role: 'user', text: text || '📷', image: img?.dataUrl || null });
  history.push(userRow);
  appendMsg(userRow);
  busy = true;
  showTyping();

  let reply;
  try {
    if (img) reply = await imageReply(img);
    else reply = await getReply(text);
  } catch (err) {
    reply = { text: '⚠️ ' + err.message };
  }
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 450));
  hideTyping();
  const row = await addChat({ role: 'assistant', text: reply.text, actions: reply.actions || null });
  history.push(row);
  appendMsg(row);
  busy = false;
}

/* ---------- external AI provider ---------- */
async function getReply(text) {
  const cfg = await kvGet('ai', {});
  if (cfg.enabled && cfg.url && cfg.key) {
    try {
      return { text: await aiReply(cfg, text) };
    } catch (err) {
      toast('AI provider failed — falling back to the local assistant.', 'warn');
    }
  }
  return localReply(text);
}

async function aiReply(cfg, text) {
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
    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages: msgs, stream: false })
  });
  if (!res.ok) throw new Error(`Provider error ${res.status}`);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content;
  if (!out) throw new Error('Empty response from provider');
  return String(out).trim();
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
    const tab = map[navMatch[2]];
    return { text: `Opening ${navMatch[2]} for you… ✅`, actions: [{ label: `Go to ${navMatch[2]}`, act: 'nav:' + tab }] };
  }

  const R = [
    {
      re: /((image|photo|picture|pic)[^.]*?(video|reel|slideshow|mp4))|((video|reel)[^.]*?(image|photo|picture))|convert[^.]*(video)|turn[^.]*(video)|image to video|photo to video|make (a |me )?video/,
      reply: () => ({
        text: "🎬 Easy! The Image → Video tab turns your images into a real video file:\n\n1. Go to Image → Video (or tap the button below)\n2. Pick one or more images — from Files or upload\n3. Choose duration, motion (zoom/pan), resolution (landscape, square or Reels) and fades\n4. Tap 🎬 Render video, then save it to Files or download it\n\nA single image works great with the 'Zoom in' effect for an animated background or loop.",
        actions: [{ label: '🎬 Open Image → Video', act: 'nav:video' }]
      })
    },
    {
      re: /how.{0,20}edit|edit(or)?[^.]*(image|photo|picture)|crop|rotate|flip|filter|resize|brighten/,
      reply: () => ({
        text: "🎨 The Editor has you covered:\n\n• Rotate ⟲ ⟳ and flip ⇋ ⇵\n• Crop — drag a box on the image\n• Resize with locked aspect ratio\n• Filters: brightness, contrast, saturation, hue, blur, grayscale, sepia + one-tap presets\n• Undo/redo history\n• Export as PNG, JPEG or WebP — save to Files or download",
        actions: [{ label: '🎨 Open Editor', act: 'nav:editor' }]
      })
    },
    {
      re: /export|download|backup|zip|save (all|my|everything)/,
      reply: () => ({
        text: "📦 Two ways to export:\n\n• Export a single file — open the Files tab and tap ⬇️ on any file\n• Export everything — Files → “Export all (.zip)” bundles every stored file plus your chat history into one ZIP",
        actions: [
          { label: '📦 Export everything now', act: 'op:export' },
          { label: '📁 Open Files', act: 'nav:files' }
        ]
      })
    },
    {
      re: /upload|add (a )?file|import|attach/,
      reply: () => ({
        text: "📤 To upload files:\n\nGo to the Files tab and either drag & drop files anywhere on the drop zone, or click “Choose files”. Images, videos, audio, documents — anything goes. Everything is stored safely on your device, not in the cloud.",
        actions: [
          { label: '📤 Upload a file', act: 'op:upload' },
          { label: '📁 Open Files', act: 'nav:files' }
        ]
      })
    },
    {
      re: /install|pwa|home screen|offline|add to (home|device)/,
      reply: () => ({
        text: "📲 Ayomide Studio is a Progressive Web App — it installs like a native app and works offline:\n\n• Chrome/Edge (desktop): click the install icon in the address bar, or the “Install app” button in the sidebar\n• Android: menu ⋮ → “Add to Home screen” / “Install app”\n• iPhone/iPad (Safari): Share → “Add to Home Screen”\n\nOnce installed it opens in its own window with no browser bar."
      })
    },
    {
      re: /(who are you|your name|what are you|about you)/,
      reply: () => ({
        text: "I'm the Ayomide Studio assistant 🤖 — a built-in helper that runs 100% in your browser (no server, no account, works offline). I can guide you through chatting, file management, image editing, image-to-video, and exporting.\n\nTip: in Settings you can connect your own OpenAI-compatible API key to make me a full AI chatbot."
      })
    },
    {
      re: /privacy|my data|cloud|server|safe/,
      reply: () => ({
        text: "🔒 Your privacy is the whole design: files and chat history live in your browser's local storage on this device only. Nothing is uploaded to any server — the app itself even works offline. If you connect an external AI provider in Settings, only chat messages you send are sent to that provider."
      })
    },
    {
      re: /help|what can you do|features|capab|guide|how (do|to) (i )?use/,
      reply: () => ({
        text: "Here's what Ayomide Studio can do 👇\n\n💬 Chat — talk to me right here, attach images, get help anytime\n📁 Files — upload (drag & drop), preview, rename, edit, delete, download\n🎨 Editor — crop, rotate, flip, resize, filters, export PNG/JPEG/WebP\n🎬 Image → Video — turn images into video with zoom/pan motion & fades\n📦 Export — download any file or everything as a ZIP\n\nEverything works offline and stays on your device.",
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
        text: "🧹 I can clear things for you:\n\n• Clear the chat history — Settings → “Clear chat history”\n• Delete files — Files tab → ✕ on a card, or Settings → “Delete all files”\n\nWant me to take you there?",
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
      reply: () => ({ text: "You're very welcome! 😊 Anything else — editing, a video, exporting files — just say the word." })
    },
    {
      re: /(api|key|openai|groq|openrouter|ollama|connect).{0,40}(ai|model|chat)?|real ai|chatgpt|gpt/,
      reply: () => ({
        text: "🔌 Want a full AI chatbot? Head to Settings → “AI chat provider” and connect any OpenAI-compatible API (OpenAI, Groq, OpenRouter, local Ollama…):\n\n1. Tick “Use external AI provider”\n2. Enter the Base URL, API key and model name\n3. Save, then “Test connection”\n\nUntil then I'll keep answering locally — your key is stored only on this device.",
        actions: [{ label: '⚙️ Open Settings', act: 'nav:settings' }]
      })
    }
  ];

  for (const { re, reply } of R) {
    if (re.test(text)) return reply();
  }

  return {
    text: "I'm mostly built for helping you run this studio 😄 — but try me on:\n\n• “How do I turn an image into a video?”\n• “How do I edit / crop an image?”\n• “Export my files”\n• “How do I upload?”\n• “Install this app”\n\nOr connect your own AI provider in Settings and I become a full chatbot.",
    actions: [
      { label: '🎬 Video', act: 'nav:video' },
      { label: '🎨 Editor', act: 'nav:editor' },
      { label: '⚙️ Settings', act: 'nav:settings' }
    ]
  };
}

/* ---------- message action buttons ---------- */
export async function resetChat() {
  history = [];
  $('#chat-list').innerHTML = '';
  const hello = await addChat({
    role: 'assistant',
    text: 'Chat cleared. 🧹 Fresh start — what would you like to do?',
    actions: [
      { label: '📁 Files', act: 'nav:files' },
      { label: '🎨 Editor', act: 'nav:editor' },
      { label: '🎬 Video', act: 'nav:video' }
    ]
  });
  history.push(hello);
  appendMsg(hello);
}
async function runAction(act) {
  if (act.startsWith('nav:')) emit('nav', act.slice(4));
  else if (act === 'op:upload') { emit('nav', 'files'); setTimeout(() => emit('op', 'upload'), 80); }
  else if (act === 'op:export') exportEverything();
  else if (act === 'op:clear') {
    if (await confirmDialog('Clear chat?', 'This deletes the entire chat history from this device.', { danger: true, okLabel: 'Clear' })) {
      await clearChat();
      history = [];
      $('#chat-list').innerHTML = '';
      const welcome = await addChat({
        role: 'assistant',
        text: 'Chat cleared. 🧹 Fresh start — what would you like to do?'
      });
      history.push(welcome);
      appendMsg(welcome);
    }
  }
}
