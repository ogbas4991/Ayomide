# Ayomide Studio 🎨🎬

A **Progressive Web App (PWA)** that works entirely in your browser — even offline — with optional self-hosted cloud sync.

**Live site:** https://ogbas4991.github.io/Ayomide/

## Features

| Feature | What it does |
|---|---|
| 💬 **Chat** | Built-in offline assistant, 🎙 voice input, 🔊 spoken replies, multiple threads, image attachments. Optional OpenAI-compatible provider with **streaming** replies and **vision** (the AI sees your images). Chat commands *do things*: “compress all images to 100kb”, “watermark all images with © Ayomide”. |
| 📁 **Files** | Folders, tags, gallery view + lightbox, duplicate finder, bulk select, previews, encrypted Vault (AES-256), ZIP import/export. |
| 🎨 **Editor** | Auto-enhance, rotate/flip, crop presets, resize, filters, undo/redo, draw & annotate (brush/arrows/text/emoji/pixelate), watermark, **background removal & chroma key**. |
| 🎬 **Image → Video** | Ken Burns motion, fades, **music** + **voiceover recording**, animated text titles, all resolutions incl. Reels. |
| 🧰 **Tools** | **AI image generator** (free, no key), **GIF maker** (images or video), **collage maker**, **batch tools** (convert/resize/compress/watermark), **images → PDF**, **EXIF viewer & stripper** (remove GPS), **QR studio** (styled codes + scanning), **video trimmer + speed**, **OCR**, **insights dashboard**. |
| ☁️ **Cloud sync** | Self-hosted sync server with **end-to-end encryption** option — the server only ever stores ciphertext. |
| 📲 **PWA** | Installable, offline, share-sheet target, file handling, app shortcuts, ⌘/Ctrl+K command palette, themes (dark/light/auto + accent colours), **English / Yorùbá / Pidgin** UI. |

## Tech

- No frontend build step, no frameworks, no dependencies — plain HTML/CSS/ES modules.
- Custom from-scratch engines (all validated against standard decoders): **QR generator** (ISO 18004 — verified with zxing-cpp), **GIF encoder** (median-cut + LZW — verified with Pillow), **PDF writer** (verified with pypdf), **EXIF parser**, **ZIP reader/writer**.
- **Storage:** IndexedDB — device-only unless you enable sync.
- **Video:** canvas + MediaRecorder, audio mixed live via WebAudio.
- **Vault/E2EE:** WebCrypto (PBKDF2 150k + AES-256-GCM).
- **PWA:** manifest (share target, file handlers, shortcuts) + service worker v3.

## Run locally

```bash
node server/index.js   # site + sync server → http://localhost:3000
```

## Cloud sync server

`server/index.js` — **zero-dependency Node** (scrypt auth, HMAC tokens, 500MB/user quota) that also serves the PWA.

**Deploy free (Render):** push the repo → <https://render.com/deploy> with your repo URL (uses `render.yaml`).
> Render free = ephemeral disk (resets on redeploy). For persistent data use Railway/Fly.io with a volume or a paid Render disk. Env: `PORT`, `DATA_DIR`.

**Use:** Settings → Cloud sync → server URL + email + password → *Create account* → *Sync now*. Tick **End-to-end encryption** and set a passphrase for zero-knowledge sync.

## Deploy the PWA

GitHub Pages serves `main` — every push redeploys. First-time: Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.
