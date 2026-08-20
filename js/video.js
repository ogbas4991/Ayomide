/* Ayomide Studio — image → video: motion, fades, music, titles (canvas + MediaRecorder + WebAudio) */
import { $, uid, toast, download, loadImage, fmtBytes, emit } from './utils.js';
import { addFile, getFile } from './db.js';
import { pickImages, pickAudio, refresh as refreshFiles } from './files.js';

const EFFECTS = {
  'none': 'No motion',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'pan-left': 'Pan left',
  'pan-right': 'Pan right'
};

let clips = [];         // {id, name, blob, img, dur, effect, title:{text,pos,color,size,anim}|null}
let audioTrack = null;  // {name, blob, volume}
let lastResult = null;
let rendering = false;

const canvas = () => $('#video-canvas');

export async function init() {
  $('#vid-pick').addEventListener('click', pick);
  $('#vid-pick-2').addEventListener('click', pick);
  $('#vid-upload').addEventListener('click', () => $('#vid-upload-input').click());
  $('#vid-upload-2').addEventListener('click', () => $('#vid-upload-input').click());
  $('#vid-upload-input').addEventListener('change', async (e) => {
    await addBlobs([...e.target.files]);
    e.target.value = '';
  });

  // music
  $('#vid-audio-pick').addEventListener('click', async () => {
    const rec = await pickAudio();
    if (rec) setAudio(rec.blob, rec.name);
  });
  $('#vid-audio-upload').addEventListener('click', () => $('#vid-audio-input').click());
  $('#vid-audio-input').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) setAudio(f, f.name);
  });
  $('#vid-audio-vol').addEventListener('input', (e) => { if (audioTrack) audioTrack.volume = parseFloat(e.target.value); });
  $('#vid-audio-remove').addEventListener('click', () => { audioTrack = null; $('#vid-audio-row').hidden = true; });
  $('#vid-voiceover').addEventListener('click', voiceover);

  $('#vid-res').addEventListener('change', previewFirstFrame);
  $('#vid-bg').addEventListener('input', previewFirstFrame);
  $('#vid-fade').addEventListener('input', (e) => { $('#vid-fade-val').textContent = (+e.target.value).toFixed(1) + 's'; });
  $('#btn-render').addEventListener('click', startRender);

  $('#vid-save').addEventListener('click', saveResult);
  $('#vid-download').addEventListener('click', () => {
    if (!lastResult) return;
    download(lastResult.blob, `ayomide-video-${Date.now().toString(36)}.${lastResult.ext}`);
    toast('Video downloaded ⬇️', 'ok');
  });
  $('#vid-back').addEventListener('click', () => {
    $('#video-result').hidden = true;
    $('#video-stage').hidden = false;
    previewFirstFrame();
  });

  syncUI();
}

function setAudio(blob, name, loop = true) {
  audioTrack = { name, blob, volume: parseFloat($('#vid-audio-vol').value) || 0.8, loop };
  $('#vid-audio-name').textContent = (loop ? '🎵 ' : '🎙 ') + name;
  $('#vid-audio-row').hidden = false;
  toast(loop ? 'Music added — it will be mixed into the video 🎵' : 'Voiceover ready — it plays once during the video 🎙', 'ok');
}

let voRec = null, voChunks = [], voStream = null;
async function voiceover() {
  const btn = $('#vid-voiceover');
  if (voRec && voRec.state === 'recording') { voRec.stop(); return; }
  try {
    voStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Microphone access denied.', 'error');
    return;
  }
  voChunks = [];
  voRec = new MediaRecorder(voStream);
  voRec.ondataavailable = (e) => { if (e.data.size) voChunks.push(e.data); };
  voRec.onstop = () => {
    const blob = new Blob(voChunks, { type: voRec.mimeType || 'audio/webm' });
    voStream.getTracks().forEach((t) => t.stop());
    btn.textContent = '🎙 Voiceover';
    btn.classList.remove('recording');
    setAudio(blob, 'voiceover-' + Date.now().toString(36) + '.webm', false);
  };
  voRec.start();
  btn.textContent = '⏺ Stop recording';
  btn.classList.add('recording');
  toast('Recording your voice… tap stop when done 🎙', 'info', 5000);
}

async function pick() {
  const recs = await pickImages({ multiple: true, title: 'Add images as video clips' });
  await addFileIds(recs.map((r) => r.id));
}

export async function addFileIds(ids) {
  for (const id of ids) {
    const rec = await getFile(id);
    if (rec) await addBlob(rec.blob, rec.name);
  }
}

async function addBlobs(blobs) {
  for (const b of blobs) await addBlob(b, b.name);
}

async function addBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    $('#video-result').hidden = true;
    clips.push({
      id: uid(), name: name || 'image', blob, img,
      dur: clips.length ? 4 : 5,
      effect: 'zoom-in',
      title: null
    });
    syncUI();
    previewFirstFrame();
  } catch {
    toast(`Couldn't read “${name}” as an image.`, 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- clip list UI ---------- */
function syncUI() {
  const list = $('#clip-list');
  list.innerHTML = '';
  $('#video-placeholder').style.display = clips.length ? 'none' : 'block';
  if (clips.length) {
    if ($('#video-result').hidden) $('#video-stage').hidden = false;
  } else {
    $('#video-stage').hidden = true;
    $('#video-result').hidden = true;
  }

  clips.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'clip-item';
    li.style.flexWrap = 'wrap';
    const opts = Object.entries(EFFECTS).map(([k, v]) =>
      `<option value="${k}" ${c.effect === k ? 'selected' : ''}>${v}</option>`).join('');
    const t = c.title || {};
    li.innerHTML = `
      <img src="${c.img.src}" alt="">
      <div class="clip-info">
        <b>${c.name}</b>
        <select data-effect>${opts}</select>
      </div>
      <div class="clip-dur">
        <input type="number" min="1" max="15" step="0.5" value="${c.dur}" data-dur title="Seconds">s
      </div>
      <div class="clip-btns">
        <button data-up title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button data-down title="Move down" ${i === clips.length - 1 ? 'disabled' : ''}>▼</button>
        <button data-title title="Add a text title">🅣</button>
        <button data-del title="Remove">✕</button>
      </div>
      <div class="title-editor" data-title-editor hidden>
        <input type="text" data-title-text placeholder="Title text (e.g. Lagos Nights ✨)" value="${t.text || ''}">
        <div class="row">
          <select data-title-pos>
            <option value="top" ${t.pos === 'top' ? 'selected' : ''}>Top</option>
            <option value="center" ${t.pos === 'center' ? 'selected' : ''}>Center</option>
            <option value="bottom" ${!t.pos || t.pos === 'bottom' ? 'selected' : ''}>Bottom</option>
          </select>
          <select data-title-anim>
            <option value="fade" ${!t.anim || t.anim === 'fade' ? 'selected' : ''}>Fade in</option>
            <option value="slide-up" ${t.anim === 'slide-up' ? 'selected' : ''}>Slide up</option>
            <option value="none" ${t.anim === 'none' ? 'selected' : ''}>Static</option>
          </select>
          <input type="color" data-title-color value="${t.color || '#ffffff'}" title="Colour">
          <label class="inline">Size <input type="range" min="24" max="120" value="${t.size || 52}" data-title-size></label>
        </div>
      </div>`;
    li.querySelector('[data-effect]').addEventListener('change', (e) => { c.effect = e.target.value; previewFirstFrame(); });
    li.querySelector('[data-dur]').addEventListener('change', (e) => {
      c.dur = Math.max(1, Math.min(15, parseFloat(e.target.value) || 4));
      e.target.value = c.dur;
    });
    li.querySelector('[data-up]').addEventListener('click', () => { if (i > 0) { [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]]; syncUI(); previewFirstFrame(); } });
    li.querySelector('[data-down]').addEventListener('click', () => { if (i < clips.length - 1) { [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]]; syncUI(); previewFirstFrame(); } });
    li.querySelector('[data-del]').addEventListener('click', () => { clips.splice(i, 1); syncUI(); previewFirstFrame(); });

    const tBtn = li.querySelector('[data-title]');
    const tEd = li.querySelector('[data-title-editor]');
    tBtn.addEventListener('click', () => {
      if (!c.title) c.title = { text: '', pos: 'bottom', color: '#ffffff', size: 52, anim: 'fade' };
      tEd.hidden = !tEd.hidden;
    });
    tEd.querySelector('[data-title-text]').addEventListener('input', (e) => { c.title.text = e.target.value; previewFirstFrame(); });
    tEd.querySelector('[data-title-pos]').addEventListener('change', (e) => { c.title.pos = e.target.value; previewFirstFrame(); });
    tEd.querySelector('[data-title-anim]').addEventListener('change', (e) => { c.title.anim = e.target.value; previewFirstFrame(); });
    tEd.querySelector('[data-title-color]').addEventListener('input', (e) => { c.title.color = e.target.value; previewFirstFrame(); });
    tEd.querySelector('[data-title-size]').addEventListener('input', (e) => { c.title.size = +e.target.value; previewFirstFrame(); });

    list.appendChild(li);
  });

  const total = clips.reduce((n, c) => n + c.dur, 0);
  $('#btn-render').disabled = !clips.length || rendering;
  $('#btn-render').textContent = clips.length
    ? `🎬 Render video (${total.toFixed(1)}s${audioTrack ? ' + 🎵' : ''})`
    : '🎬 Render video';
}

function resWH() {
  const [w, h] = $('#vid-res').value.split('x').map(Number);
  return { W: w, H: h };
}

function previewFirstFrame() {
  if (!clips.length || rendering) return;
  const { W, H } = resWH();
  const c = canvas();
  c.width = W; c.height = H;
  drawFrame(0, W, H);
  // show first-clip title in preview
  const ctx = c.getContext('2d');
  drawTitle(ctx, clips[0], W, H, clips[0].dur / 2, 1);
}

/* ---------- drawing ---------- */
function drawClipFrame(ctx, clip, W, H, p) {
  const img = clip.img;
  let z = 1, ox = 0, oy = 0;
  switch (clip.effect) {
    case 'zoom-in': z = 1 + 0.25 * p; break;
    case 'zoom-out': z = 1.25 - 0.25 * p; break;
    case 'pan-left': z = 1.18; ox = 0.5 - p; break;
    case 'pan-right': z = 1.18; ox = p - 0.5; break;
    default: z = 1;
  }
  const s = Math.max(W / img.width, H / img.height) * z;
  const dw = img.width * s, dh = img.height * s;
  const overX = Math.max(0, (dw - W) / 2);
  const overY = Math.max(0, (dh - H) / 2);
  ctx.drawImage(img, (W - dw) / 2 + ox * overX, (H - dh) / 2 + oy * overY, dw, dh);
}

function drawTitle(ctx, clip, W, H, local, baseAlpha) {
  const t = clip.title;
  if (!t || !t.text) return;
  const fs = Math.round((t.size || 52) * H / 1080);
  ctx.save();
  ctx.font = `700 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  const pad = H * 0.08;
  const pos = t.pos || 'bottom';
  let y = pos === 'top' ? pad : pos === 'center' ? H / 2 : H - pad;
  ctx.textBaseline = pos === 'top' ? 'top' : pos === 'center' ? 'middle' : 'alphabetic';
  let alpha = baseAlpha, dy = 0;
  const anim = t.anim || 'fade';
  if (anim !== 'none') {
    const inR = Math.min(1, local / 0.6);
    const outR = Math.min(1, Math.max(0, (clip.dur - local)) / 0.6);
    const ramp = Math.max(0, Math.min(inR, outR));
    alpha *= ramp;
    if (anim === 'slide-up') dy = (1 - ramp) * fs * 0.8;
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = fs * 0.3;
  ctx.fillStyle = t.color || '#ffffff';
  ctx.fillText(t.text, W / 2, y + dy);
  ctx.restore();
}

function drawFrame(t, W, H) {
  const ctx = canvas().getContext('2d');
  ctx.fillStyle = $('#vid-bg').value || '#0b0d14';
  ctx.fillRect(0, 0, W, H);
  if (!clips.length) return;

  const fade = $('#vid-transition').value === 'fade' ? parseFloat($('#vid-fade').value) || 0.6 : 0;
  const total = clips.reduce((n, c) => n + c.dur, 0);
  t = Math.max(0, Math.min(t, total));

  let start = 0, idx = clips.length - 1;
  for (let i = 0; i < clips.length; i++) {
    if (t < start + clips[i].dur) { idx = i; break; }
    start += clips[i].dur;
  }
  const c = clips[idx];
  const local = Math.max(0, Math.min(t - start, c.dur));

  let alpha = 1;
  if (fade > 0) {
    if (idx > 0 && local < fade) alpha *= local / fade;
    if (idx < clips.length - 1 && local > c.dur - fade) alpha *= Math.max(0, (c.dur - local) / fade);
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  drawClipFrame(ctx, c, W, H, c.dur ? local / c.dur : 0);
  ctx.globalAlpha = 1;
  drawTitle(ctx, c, W, H, local, alpha);
}

/* ---------- recorder ---------- */
function pickMime(hasAudio) {
  const cands = hasAudio ? [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm']
  ] : [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm']
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, ext] of cands) {
    try { if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }; } catch { /* continue */ }
  }
  return null;
}

export async function startRender() {
  if (rendering) return;
  if (!clips.length) { toast('Add at least one image first 🖼️', 'warn'); return; }
  const hasAudio = !!audioTrack;
  const pick = pickMime(hasAudio);
  if (!pick) { toast('This browser cannot record video (MediaRecorder unsupported).', 'error'); return; }

  rendering = true;
  $('#video-result').hidden = true;
  $('#video-stage').hidden = false;
  const btn = $('#btn-render');
  btn.disabled = true;
  $('#video-progress-wrap').hidden = false;
  $('#video-render-note').hidden = false;

  const { W, H } = resWH();
  const fps = parseInt($('#vid-fps').value, 10) || 30;
  const c = canvas();
  c.width = W; c.height = H;
  drawFrame(0, W, H);

  const videoStream = c.captureStream(fps);
  let stream = videoStream;

  // audio setup
  let audioCtx = null, audioSrc = null;
  if (hasAudio) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      const buf = await audioCtx.decodeAudioData(await audioTrack.blob.arrayBuffer());
      const dest = audioCtx.createMediaStreamDestination();
      audioSrc = audioCtx.createBufferSource();
      audioSrc.buffer = buf;
      audioSrc.loop = audioTrack.loop !== false;
      const gain = audioCtx.createGain();
      gain.gain.value = audioTrack.volume;
      audioSrc.connect(gain).connect(dest);
      audioSrc.start();
      stream = new MediaStream([...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } catch (err) {
      toast('Could not decode the audio — rendering without music.', 'warn');
      stream = videoStream;
      hasAudioFailedStop(audioCtx, audioSrc);
      audioCtx = null; audioSrc = null;
    }
  }

  let rec;
  try {
    rec = new MediaRecorder(stream, { mimeType: pick.mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
  } catch (err) {
    toast('Could not start the recorder: ' + err.message, 'error');
    rendering = false;
    cleanupAudio();
    syncUI();
    return;
  }

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });

  const total = clips.reduce((n, cl) => n + cl.dur, 0);
  const t0 = performance.now();
  rec.start(200);

  await new Promise((resolve) => {
    const loop = (now) => {
      const t = (now - t0) / 1000;
      if (t >= total) { drawFrame(total, W, H); resolve(); return; }
      drawFrame(t, W, H);
      $('#video-progress').style.width = (t / total) * 100 + '%';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  await new Promise((r) => setTimeout(r, 300)); // hold the final frame briefly
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  cleanupAudio();

  $('#video-progress').style.width = '100%';
  $('#video-progress-wrap').hidden = true;
  $('#video-render-note').hidden = true;

  const blob = new Blob(chunks, { type: pick.mime });
  if (!blob.size) {
    toast('Recording produced an empty video — try fewer/smaller clips or another browser.', 'error');
    rendering = false;
    syncUI();
    return;
  }

  lastResult = {
    blob, ext: pick.ext,
    info: `${W}×${H} · ${fps}fps · ${total.toFixed(1)}s${hasAudio ? ' · 🎵' : ''} · ${fmtBytes(blob.size)} · .${pick.ext}`
  };
  $('#video-player').src = URL.createObjectURL(blob);
  $('#video-stage').hidden = true;
  $('#video-result').hidden = false;
  $('#vid-info').textContent = lastResult.info + ' — save it or download to keep it!';
  toast('Video ready! 🎬', 'ok', 5000);
  rendering = false;
  syncUI();

  function cleanupAudio() {
    try { audioSrc?.stop(); } catch { }
    try { audioCtx?.close(); } catch { }
  }
}

function hasAudioFailedStop(ctx, src) {
  try { src?.stop(); } catch { }
  try { ctx?.close(); } catch { }
}

async function saveResult() {
  if (!lastResult) return;
  const name = `ayomide-video-${Date.now().toString(36)}.${lastResult.ext}`;
  await addFile(lastResult.blob, name);
  await refreshFiles();
  $('#vid-info').textContent = `Saved “${name}” to Files ✅ · ${lastResult.info}`;
  toast(`Saved “${name}” to Files 💾`, 'ok');
}
