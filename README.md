# Ayomide Studio 🎨🎬

A **Progressive Web App (PWA)** that works entirely in your browser — even offline.

**Live site:** https://ogbas4991.github.io/Ayomide/

## Features

| Feature | What it does |
|---|---|
| 💬 **Chat** | Built-in assistant that runs locally (offline). Attach images, ask how to use the app. Optionally connect any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Ollama…) in Settings for real AI replies. |
| 📁 **Files** | Upload anything via drag & drop or picker. Preview images/video/audio/text, rename, download, delete. Everything stays on your device (IndexedDB). |
| 🎨 **Editor** | Rotate, flip, crop (drag a box), resize, and apply filters (brightness, contrast, saturation, hue, blur, grayscale, sepia) with one-tap presets. Undo/redo. Export as PNG/JPEG/WebP — save to Files or download. |
| 🎬 **Image → Video** | Turn one or more images into a real video file with Ken-Burns motion (zoom in/out, pan), fade transitions, custom duration, resolution (720p/1080p/square/vertical Reels), fps and background colour. |
| 📦 **Export** | Download any single file, or export everything (files + chat history) as a ZIP. Zero-dependency ZIP writer built in. |
| 📲 **Installable PWA** | Install to your home screen, launches standalone, fully offline via a service worker. |

## Tech

- No build step, no frameworks, no external dependencies — plain HTML/CSS/ES modules.
- **Storage:** IndexedDB (files, chat, settings) — nothing ever leaves the device.
- **Image → Video:** `<canvas>` animation captured with `MediaRecorder` (records MP4 where supported, otherwise WebM).
- **PWA:** web app manifest + service worker (pre-cached app shell, stale-while-revalidate).

## Run locally

Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy

Live at: **https://ogbas4991.github.io/Ayomide/**

GitHub Pages serves this repo's `main` branch — every push to `main` redeploys automatically.

**First-time setup (repo admin, ~30 seconds):**
1. Open **Settings → Pages** in the repo
2. Source: **Deploy from a branch**
3. Branch: **`main`** / `(root)` → **Save**

The site also runs anywhere static files run (Netlify, Vercel, Cloudflare, any web server) — no build step required.
