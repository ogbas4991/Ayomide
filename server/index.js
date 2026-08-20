/* Ayomide Studio — sync server (zero dependencies, pure Node)
 *
 * Endpoints (all under /api, JSON unless noted):
 *   POST /api/auth/register {email,password}   -> {token}
 *   POST /api/auth/login    {email,password}   -> {token}
 *   GET  /api/me                              -> {email}
 *   GET  /api/files                           -> {files:[{id,name,type,size,addedAt,updated,folder,tags,vault,iv}]}
 *   PUT  /api/files/:id?name=&type=... (body = raw bytes)
 *   GET  /api/files/:id/blob                  -> raw bytes
 *   DELETE /api/files/:id
 *   GET  /api/chat                            -> {rows:[...]}
 *   PUT  /api/chat {rows:[...]}               -> merges by id
 *   GET  /api/health                          -> {ok:true}
 *
 * Also serves the PWA static files from the repo root, so ONE deployment
 * gives you both the app and its sync backend at the same URL.
 *
 * Storage: JSON metadata + blobs on disk under DATA_DIR (default ./data).
 * NOTE: on Render's free plan the filesystem is ephemeral — fine for testing.
 * For persistence use Railway/Fly.io with a volume, or a paid Render disk.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');          // repo root (static site)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;
const MAX_BODY = 110 * 1024 * 1024;                   // 110MB
const QUOTA = 500 * 1024 * 1024;                      // 500MB per user

/* ---------- tiny JSON db ---------- */
const dbFile = path.join(DATA_DIR, 'db.json');
let db = { users: {}, files: {}, chat: {}, secret: null };

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, dbFile);
}
if (fs.existsSync(dbFile)) {
  try { db = { ...db, ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) }; } catch { /* fresh */ }
}
if (!db.secret) { db.secret = crypto.randomBytes(32).toString('hex'); saveDb(); }

const blobDir = (uid) => path.join(DATA_DIR, 'blobs', uid);
const blobPath = (uid, fid) => path.join(blobDir(uid), fid);

/* ---------- auth ---------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function auth(req) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!payload) return null;
  return db.users[payload.uid] ? payload.uid : null;
}

/* ---------- helpers ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.zip': 'application/zip', '.webm': 'video/webm', '.mp4': 'video/mp4'
};

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    ...(typeof data === 'string' || Buffer.isBuffer(data) ? {} : { 'Content-Type': 'application/json' }),
    ...headers
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  try { return JSON.parse(buf.toString() || '{}'); } catch { return {}; }
}

function userQuotaUsed(uid) {
  return Object.values(db.files[uid] || {}).reduce((n, f) => n + (f.size || 0), 0);
}

/* ---------- static files ---------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback for non-API GETs
      if (!rel.startsWith('/api') && !path.extname(rel)) {
        return serveStatic(req, res, '/index.html');
      }
      return send(res, 404, { error: 'Not found' });
    }
    const ext = path.extname(file).toLowerCase();
    const stream = fs.createReadStream(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    stream.pipe(res);
  });
}

/* ---------- API router ---------- */
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = parts.slice(1);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (route[0] === 'health') return send(res, 200, { ok: true, name: 'ayomide-sync' });

  if (route[0] === 'auth' && (route[1] === 'register' || route[1] === 'login')) {
    const { email, password } = await readJson(req);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'Valid email required' });
    if (!password || password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
    const key = email.toLowerCase();
    if (route[1] === 'register') {
      if (db.users[key]) return send(res, 409, { error: 'Account already exists — sign in instead' });
      const salt = crypto.randomBytes(16).toString('hex');
      db.users[key] = { email: key, salt, hash: hashPassword(password, salt), created: Date.now() };
      db.files[key] = db.files[key] || {};
      db.chat[key] = db.chat[key] || {};
      saveDb();
    } else {
      const u = db.users[key];
      if (!u || hashPassword(password, u.salt) !== u.hash) return send(res, 401, { error: 'Wrong email or password' });
    }
    const uid = key;
    const token = sign({ uid, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 });
    return send(res, 200, { token, email: uid });
  }

  const uid = auth(req);
  if (!uid) return send(res, 401, { error: 'Unauthorized' });

  if (route[0] === 'me') return send(res, 200, { email: uid });

  if (route[0] === 'files') {
    db.files[uid] = db.files[uid] || {};
    const fid = route[1] && decodeURIComponent(route[1]);

    if (req.method === 'GET' && !fid) {
      const files = Object.values(db.files[uid]).map(({ blobFile, ...meta }) => meta);
      return send(res, 200, { files });
    }

    if (!fid || !/^[A-Za-z0-9_-]{1,80}$/.test(fid)) return send(res, 400, { error: 'Bad file id' });

    if (req.method === 'PUT') {
      const q = url.searchParams;
      const buf = await readBody(req);
      if (!buf.length) return send(res, 400, { error: 'Empty body' });
      const existing = db.files[uid][fid];
      if (!existing && userQuotaUsed(uid) + buf.length > QUOTA) {
        return send(res, 413, { error: 'Storage quota exceeded (500MB)' });
      }
      fs.mkdirSync(blobDir(uid), { recursive: true });
      await fsp.writeFile(blobPath(uid, fid), buf);
      db.files[uid][fid] = {
        id: fid,
        name: q.get('name') || 'file',
        type: q.get('type') || '',
        size: buf.length,
        addedAt: +(q.get('addedAt') || Date.now()),
        updated: +(q.get('updated') || Date.now()),
        folder: q.get('folder') || 'root',
        tags: (q.get('tags') || '').split(',').filter(Boolean),
        vault: q.get('vault') === '1',
        iv: q.get('iv') || '',
        enc: q.get('enc') === '1',
        encIv: q.get('encIv') || ''
      };
      saveDb();
      return send(res, 200, { ok: true, id: fid });
    }

    if (req.method === 'GET' && route[2] === 'blob') {
      const meta = db.files[uid][fid];
      if (!meta) return send(res, 404, { error: 'Not found' });
      try {
        const buf = await fsp.readFile(blobPath(uid, fid));
        return send(res, 200, buf, { 'Content-Type': meta.type || 'application/octet-stream' });
      } catch {
        return send(res, 404, { error: 'Blob missing' });
      }
    }

    if (req.method === 'GET' && fid) {
      const meta = db.files[uid][fid];
      return meta ? send(res, 200, { file: meta }) : send(res, 404, { error: 'Not found' });
    }

    if (req.method === 'DELETE') {
      if (db.files[uid][fid]) {
        delete db.files[uid][fid];
        fsp.unlink(blobPath(uid, fid)).catch(() => { });
        saveDb();
      }
      return send(res, 200, { ok: true });
    }
  }

  if (route[0] === 'chat') {
    db.chat[uid] = db.chat[uid] || {};
    if (req.method === 'GET') return send(res, 200, { rows: Object.values(db.chat[uid]) });
    if (req.method === 'PUT') {
      const { rows } = await readJson(req);
      let n = 0;
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r && r.id) { db.chat[uid][r.id] = r; n++; }
      }
      saveDb();
      return send(res, 200, { ok: true, merged: n });
    }
  }

  return send(res, 404, { error: 'Unknown API route' });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    send(res, err.message === 'Payload too large' ? 413 : 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ayomide Studio sync server + static site: http://0.0.0.0:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
});
