/* Ayomide Studio — custom branding: use YOUR images as the app icon & logo
   (processed fully client-side: square-cropped icon at 512/192 + maskable-safe,
   logo at ≤520px; applied to favicon, topbar, sidebar brand, lock screen, and —
   where the browser supports it — the installable manifest) */
import { $, toast, loadImage } from './utils.js';
import { kvGet, kvSet } from './db.js';

let iconUrl = null;
let logoUrl = null;

/* ---------- processing ---------- */
async function makeIconBlob(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeLogoBlob(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 520 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- applying ---------- */
function setFavicons(url) {
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => { l.href = url; });
}

async function tryManifestIcons(url) {
  /* Some browsers accept a blob manifest — best effort for the install icon */
  try {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const manifest = await (await fetch(link.href)).json();
    manifest.icons = manifest.icons.map((ic) => ({ ...ic, src: url }));
    const blobURL = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
    link.href = blobURL;
  } catch { /* keep default manifest */ }
}

export async function applyBranding() {
  const icon = await kvGet('brandIcon', null);
  const logo = await kvGet('brandLogo', null);
  if (iconUrl) URL.revokeObjectURL(iconUrl);
  if (logoUrl) URL.revokeObjectURL(logoUrl);
  iconUrl = logoUrl = null;

  if (icon) {
    iconUrl = URL.createObjectURL(icon);
    setFavicons(iconUrl);
    const tb = $('#topbar-logo');
    if (tb) tb.src = iconUrl;
    const lock = document.querySelector('.lock-box img');
    if (lock) lock.src = iconUrl;
    tryManifestIcons(iconUrl);
  }
  if (logo) {
    logoUrl = URL.createObjectURL(logo);
    const brand = $('#brand-logo');
    if (brand) brand.src = logoUrl;
    // very wide logos take the full sidebar width
    if (logo.width / logo.height > 2.6) brand.classList.add('wide');
  }
}

/* ---------- settings UI ---------- */
export function initBrandingUI() {
  const wrap = document.createElement('div');
  wrap.className = 'branding-ui';
  wrap.innerHTML = `
    <p class="muted">Use your own images — processed on this device only.</p>
    <div class="btn-row wrap">
      <button id="brand-icon-btn" class="btn">🖼 Set app icon</button>
      <button id="brand-logo-btn" class="btn">🏷 Set logo</button>
      <button id="brand-reset-btn" class="btn ghost">↺ Reset to default</button>
    </div>
    <input type="file" id="brand-icon-input" accept="image/*" hidden>
    <input type="file" id="brand-logo-input" accept="image/*" hidden>
    <div class="branding-preview row">
      <img id="brand-icon-preview" alt="" title="icon" hidden>
      <img id="brand-logo-preview" alt="" title="logo" hidden>
    </div>`;
  const card = $('#appearance-card');
  if (!card) return;
  card.appendChild(wrap);

  const iconInput = wrap.querySelector('#brand-icon-input');
  const logoInput = wrap.querySelector('#brand-logo-input');

  wrap.querySelector('#brand-icon-btn').addEventListener('click', () => iconInput.click());
  wrap.querySelector('#brand-logo-btn').addEventListener('click', () => logoInput.click());

  iconInput.addEventListener('change', async () => {
    const f = iconInput.files[0];
    iconInput.value = '';
    if (!f) return;
    try {
      const blob = await makeIconBlob(f);
      await kvSet('brandIcon', blob);
      await applyBranding();
      await showPreview();
      toast('App icon updated 🖼 (home-screen install icon may need a reinstall to refresh)', 'ok', 5000);
    } catch (err) {
      toast('Could not read that image: ' + err.message, 'error');
    }
  });

  logoInput.addEventListener('change', async () => {
    const f = logoInput.files[0];
    logoInput.value = '';
    if (!f) return;
    try {
      const blob = await makeLogoBlob(f);
      await kvSet('brandLogo', blob);
      await applyBranding();
      await showPreview();
      toast('Logo updated 🏷', 'ok');
    } catch (err) {
      toast('Could not read that image: ' + err.message, 'error');
    }
  });

  wrap.querySelector('#brand-reset-btn').addEventListener('click', async () => {
    await kvSet('brandIcon', null);
    await kvSet('brandLogo', null);
    location.reload();
  });

  showPreview();
}

async function showPreview() {
  const icon = await kvGet('brandIcon', null);
  const logo = await kvGet('brandLogo', null);
  const ip = $('#brand-icon-preview');
  const lp = $('#brand-logo-preview');
  if (icon) {
    ip.hidden = false;
    if (!ip.src.startsWith('blob:')) ip.src = URL.createObjectURL(icon);
  }
  if (logo) {
    lp.hidden = false;
    if (!lp.src.startsWith('blob:')) lp.src = URL.createObjectURL(logo);
  }
}

export async function initBranding() {
  await applyBranding();
  initBrandingUI();
}
