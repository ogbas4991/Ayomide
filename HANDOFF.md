# HANDOFF — Ayomide Studio v3 (from previous Arena session)

This file is for the NEXT coding session (or a human collaborator) picking up this work.

## Current state

- **GitHub `main`** has: v1 (live on Pages at https://ogbas4991.github.io/Ayomide/) **+ two artwork images the owner committed** (icon + logo source material).
- **This working tree** (from the previous session) contains **v2 + v3 + terminal UI + custom branding** on top of v1 — 5 commits, never pushed (the session lost GitHub write access):
  1. `feat: v2` — voice chat, threads, streaming AI, annotations, watermark, auto-enhance, crop presets, music+titles in videos, folders/tags/gallery/dupes/bulk, ZIP import, app lock + AES-256 vault, share target, cloud sync server (zero-dep Node `server/index.js`)
  2. `feat: v3` — AI image gen (free endpoint), vision chat, smart chat actions, OCR, summaries, GIF maker (custom LZW encoder), collage, batch tools, images→PDF, EXIF stripper, QR studio (from-scratch ISO-18004 generator), video trimmer, insights, command palette, themes, EN/Yorùbá/Pidgin i18n, E2E-encrypted sync
  3. `feat: terminal shell UI` — mono type, neon-on-black, window chrome, scanlines, $-prompt chat
  4. `feat: in-app custom branding` — Settings → Appearance → set your own icon & logo at runtime
  5. `docs: handoff` (this file)

## What to do next (in order)

1. **Branding**: the owner's two images are committed in this repo (find them: `git ls-files | grep -iE '\.(jpg|jpeg|png)$'` — likely at repo root). Run:
   ```bash
   python3 tools/make-branding.py <squarer-image> <other-image>   # squarer → icon, other → logo
   ```
   Then bump `sw.js` `VERSION` (e.g. v3.2.1) so installed apps refresh.
   *Ask the owner which image they prefer as the icon if ambiguous.*
2. **Commit + push** to a branch, open a PR to `main`, and merge it — GitHub Pages redeploys automatically.
3. If anything conflicts with `main` (the image commit), keep both: images + regenerated icons.

## Quick verification before pushing

```bash
for f in js/*.js sw.js server/index.js; do node --check "$f"; done   # all must pass
node server/index.js &   # site + API on :3000 — click through: chat, files, editor, video, tools
```

All heavy engines were validated in the previous session with real decoders:
QR → zxing-cpp (4/4), GIF → Pillow (pixel-exact), PDF → pypdf, EXIF → round-trip, E2EE → live server round-trip, 11/11 DOM boot tests.

## Notes

- No build step, no frontend dependencies. Sync server: zero-dependency Node (`node server/index.js`, env `PORT`, `DATA_DIR`; `render.yaml` included).
- The in-app branding feature (Settings → Appearance) lets the owner set icon/logo per-device at runtime — shipped icons are the defaults for everyone else.
- Repo file map: `js/` (18 modules incl. `tools.js` hub, `branding.js`), `css/app.css` (terminal shell theme), `server/index.js` (site+API), `tools/make-branding.py`, `icons/` (placeholder terminal `>_` artwork pending regeneration from the owner's images).
