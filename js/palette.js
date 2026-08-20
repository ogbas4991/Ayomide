/* Ayomide Studio — command palette (Ctrl+K / ⌘K) */
import { $, $$, esc, emit, on } from './utils.js';
import { toolIds, openTool } from './tools.js';

const COMMANDS = () => [
  { icon: '💬', label: 'Go to Chat', run: () => emit('nav', 'chat') },
  { icon: '📁', label: 'Go to Files', run: () => emit('nav', 'files') },
  { icon: '🎨', label: 'Go to Editor', run: () => emit('nav', 'editor') },
  { icon: '🎬', label: 'Go to Image → Video', run: () => emit('nav', 'video') },
  { icon: '🧰', label: 'Go to Tools', run: () => emit('nav', 'tools') },
  { icon: '⚙️', label: 'Go to Settings', run: () => emit('nav', 'settings') },
  ...toolIds().map((t) => ({ icon: t.icon, label: 'Tool: ' + t.name, run: () => openTool(t.id) })),
  { icon: '📤', label: 'Upload files', run: () => { emit('nav', 'files'); setTimeout(() => emit('op', 'upload'), 80); } },
  { icon: '📦', label: 'Export everything (.zip)', run: () => import('./exporter.js').then((m) => m.exportEverything()) },
  { icon: '🌓', label: 'Toggle light / dark theme', run: () => emit('op', 'toggle-theme') },
  { icon: '🔒', label: 'Lock the app now', run: () => emit('op', 'lock') }
];

let overlay = null;

export function init() {
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open();
    }
  });
  const btn = $('#btn-palette');
  if (btn) btn.addEventListener('click', open);
}

function open() {
  close();
  overlay = document.createElement('div');
  overlay.className = 'modal-back palette-back';
  overlay.innerHTML = `
    <div class="palette">
      <input placeholder="Type a command… (↑↓ + Enter)" autocomplete="off">
      <div class="palette-list"></div>
    </div>`;
  $('#modal-root').appendChild(overlay);
  const input = overlay.querySelector('input');
  const list = overlay.querySelector('.palette-list');
  let sel = 0;
  let items = [];

  const render = (q) => {
    const all = COMMANDS();
    items = q ? all.filter((c) => c.label.toLowerCase().includes(q)) : all;
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.map((c, i) =>
      `<button data-i="${i}" class="${i === sel ? 'sel' : ''}">${c.icon} ${esc(c.label)}</button>`).join('') ||
      '<p class="muted" style="padding:10px">No matching command.</p>';
    [...list.querySelectorAll('button')].forEach((b) => {
      b.addEventListener('click', () => pick(+b.dataset.i));
      b.addEventListener('mousemove', () => { sel = +b.dataset.i; mark(); });
    });
  };
  const mark = () => [...list.querySelectorAll('button')].forEach((b, i) => b.classList.toggle('sel', i === sel));
  const pick = (i) => { const c = items[i]; close(); c?.run(); };

  input.addEventListener('input', () => { sel = 0; render(input.value.trim().toLowerCase()); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') close();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  render('');
  input.focus();
}

function close() {
  overlay?.remove();
  overlay = null;
}
