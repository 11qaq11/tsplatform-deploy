// TsPlatform Cloud Server — 纯 Node.js 实现，零框架依赖
const http = require('http');
const fsMod = require('fs');
const pathMod = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.API_PORT || '3000', 10);
const DB_PATH = process.env.DB_PATH || '/data/tsplatform.db';
const STORAGE_PATH = process.env.STORAGE_PATH || '/data';
const API_BASE_URL = process.env.API_BASE_URL || `http://122.51.90.193:${PORT}`;

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const ADMIN_FEISHU_OPEN_ID = process.env.ADMIN_FEISHU_OPEN_ID || '';
const ADMIN_PANEL_ORIGIN = process.env.ADMIN_PANEL_ORIGIN || 'http://122.51.90.193:8080';
const FEISHU_REDIRECT_URI = `${API_BASE_URL}/api/v1/auth/feishu/callback`;

// Init database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    feishu_open_id TEXT UNIQUE,
    feishu_union_id TEXT,
    username TEXT,
    email TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled')),
    created_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT DEFAULT (datetime('now')),
    session_token TEXT,
    session_expires_at TEXT
  );
`);

// Migration for existing databases: add status column if missing
const userCols = db.prepare('PRAGMA table_info(users)').all().map((col) => col.name);
if (!userCols.includes('status')) {
  db.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled'))").run();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    user_message TEXT,
    agent_reply TEXT,
    model_name TEXT,
    token_usage INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,
    description TEXT,
    category TEXT,
    version TEXT,
    author TEXT,
    download_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    manifest TEXT,
    storage_path TEXT,
    status TEXT DEFAULT 'published',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS operation_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    operation_type TEXT,
    detail TEXT,
    duration_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS referenced_files (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    conversation_id TEXT,
    file_hash TEXT,
    file_name TEXT,
    file_size INTEGER,
    upload_status TEXT DEFAULT 'pending',
    storage_path TEXT,
    referenced_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS error_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    error_type TEXT,
    message TEXT,
    stack_trace TEXT,
    source TEXT DEFAULT 'server',
    occurred_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations(created_at);
  CREATE INDEX IF NOT EXISTS idx_tools_likes ON tools(like_count DESC);
  CREATE INDEX IF NOT EXISTS idx_ops_user ON operation_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_errors_time ON error_logs(occurred_at);
`);

console.log('Database initialized');

// === HTML page for OAuth callback ===
function htmlPage(title, message, success) {
  var color = success ? '#22c55e' : '#ef4444';
  var icon = success ? '&#10003;' : '&#10007;';
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><title>' + title + '</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a14;color:#fff}\n.box{text-align:center;padding:48px;max-width:420px}\n.icon{width:64px;height:64px;margin:0 auto 24px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:32px}\nh1{font-size:22px;margin-bottom:8px}\np{color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6}\n.hint{margin-top:28px;font-size:13px;color:rgba(255,255,255,0.35)}\n</style></head>\n<body><div class="box">\n<div class="icon">' + icon + '</div>\n<h1>' + title + '</h1>\n<p>' + (success ? 'User: <strong>' + message + '</strong><br>Authorization complete' : message) + '</p>\n<p class="hint">You may now close this page and return to the app</p>\n</div>\n</body></html>';
}

// === Helpers ===

const MAX_BODY_BYTES = 140 * 1024 * 1024; // 100MB zip base64 (~139.8MB) + JSON overhead

function parseBody(req) {
  return new Promise(resolve => {
    // First-line DoS guard: reject oversized bodies before buffering.
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > MAX_BODY_BYTES) { resolve({ __too_large: true }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > MAX_BODY_BYTES) { req.destroy(); resolve({ __too_large: true }); } });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(body);
}

function auth(req) {
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) return null;
  return db.prepare("SELECT * FROM users WHERE session_token=? AND session_expires_at > datetime('now')").get(h.slice(7));
}

function adminAuth(req) {
  const u = auth(req);
  return (u && u.role === 'admin') ? u : null;
}

// === Router ===

const pendingSessions = new Map();
setInterval(() => { const now = Date.now(); for (const [key, entry] of pendingSessions) { if (now - entry.created > 300000) pendingSessions.delete(key); } }, 300000);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  try {

    // ========== Health ==========
    if (path === '/api/v1/health') {
      return json(res, { status: 'ok', timestamp: new Date().toISOString() });
    }

        // Poll session by state (for desktop auto-login)
    if (method === 'GET' && path === '/api/v1/auth/session/wait') {
      const state = url.searchParams.get('state');
      if (!state) return json(res, { status: 'error', message: 'Missing state' }, 400);
      const entry = pendingSessions.get(state);
      if (entry) { pendingSessions.delete(state); return json(res, entry.session); }
      return json(res, { status: 'pending' });
    }


    // ========== AI Proxy (API key on server, never exposed to client) ==========
    if (method === 'POST' && path.startsWith('/api/v1/ai/')) {
      const aiApiKey = process.env.AI_MODEL_API_KEY || '';
      if (!aiApiKey) return json(res, { error: { code: 'CONFIG_ERROR', message: 'AI API key not configured' } }, 500);

      const targetPath = path.replace('/api/v1/ai', '');
      const targetUrl = 'https://api.deepseek.com' + targetPath + (url.search || '');
      const upstreamHeaders = { ...req.headers };
      delete upstreamHeaders.host;
      delete upstreamHeaders.connection;
      upstreamHeaders.authorization = 'Bearer ' + aiApiKey;

      try {
        const body = await parseBody(req);
        if (body.__too_large) return json(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413);
        const upstream = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiApiKey },
          body: JSON.stringify(body),
        });
        const data = await upstream.json();
        res.writeHead(upstream.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(JSON.stringify(data));
      } catch (err) {
        return json(res, { error: { code: 'PROXY_ERROR', message: err.message } }, 502);
      }
    }

    // ========== Auth ==========
    if (method === 'GET' && path === '/api/v1/auth/feishu/authorize') {
      const state = crypto.randomUUID();
      const redirect = url.searchParams.get('redirect');
      if (redirect) {
        // Bound the anonymous state map to prevent memory exhaustion.
        if (pendingSessions.size > 10000) {
          return json(res, { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many authorization requests, try again later' } }, 429);
        }
        let allowed = false;
        try { allowed = new URL(redirect).origin === ADMIN_PANEL_ORIGIN; } catch { allowed = false; }
        if (!allowed) return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Invalid redirect' } }, 400);
        pendingSessions.set(state, { redirect, created: Date.now() });
      }
      const p = new URLSearchParams({ app_id: FEISHU_APP_ID, redirect_uri: FEISHU_REDIRECT_URI, state,  });
      return json(res, { redirect_url: `https://open.feishu.cn/open-apis/authen/v1/index?${p}`, state });
    }

    if (method === 'GET' && path === '/api/v1/auth/feishu/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(htmlPage('Auth Failed', 'Missing code parameter', false));
      }
      if (!state || !pendingSessions.has(state)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(htmlPage('Auth Failed', 'Invalid state parameter', false));
      }

      try {
        const atBody = JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET });
        const atRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: atBody });
        const atData = await atRes.json();
        if (atData.code !== 0 || !atData.app_access_token) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(htmlPage('Auth Failed', 'Failed to get app token, please retry', false));
        }

        const tb = new URLSearchParams({ grant_type: 'authorization_code', code });
        const tr = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Bearer ' + atData.app_access_token }, body: tb });
        const td = await tr.json();
        if (td.code !== 0) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(htmlPage('Auth Failed', 'Code exchange failed, please retry', false));
        }

        const ur = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', { headers: { 'Authorization': 'Bearer ' + td.data.access_token } });
        const ud = await ur.json();
        if (!ud.data) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(htmlPage('Auth Failed', 'Cannot get user info', false));
        }

        const open_id = ud.data.open_id;
        const union_id = ud.data.union_id;
        const name = ud.data.name;
        const email = ud.data.email;
        const avatar_url = ud.data.avatar_url;

        const isAdmin = ADMIN_FEISHU_OPEN_ID && open_id === ADMIN_FEISHU_OPEN_ID;

        let user = db.prepare('SELECT * FROM users WHERE feishu_open_id=?').get(open_id);
        const token = crypto.randomUUID();
        const exp = new Date(Date.now() + 7 * 86400000).toISOString();

        if (user) {
          if (isAdmin && user.role !== 'admin') db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
          if (user.status === 'disabled') {
            db.prepare('UPDATE users SET session_token=NULL, session_expires_at=NULL WHERE id=?').run(user.id);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(htmlPage('Auth Failed', 'Account is disabled, contact administrator', false));
          }
          db.prepare("UPDATE users SET session_token=?,session_expires_at=?,last_login_at=datetime('now') WHERE id=?").run(token, exp, user.id);
          user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        } else {
          const id = crypto.randomUUID();
          const role = isAdmin ? 'admin' : 'user';
          db.prepare('INSERT INTO users (id,feishu_open_id,feishu_union_id,username,email,avatar_url,session_token,session_expires_at,role) VALUES (?,?,?,?,?,?,?,?,?)').run(id, open_id, union_id, name, email || null, avatar_url || null, token, exp, role);
          user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        }

        const session = {
          session_token: user.session_token,
          expires_at: user.session_expires_at,
          user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, role: user.role },
        };

        if (state) {
          const entry = pendingSessions.get(state);
          if (entry && entry.redirect) {
            pendingSessions.delete(state);
            res.writeHead(302, { Location: `${entry.redirect}#token=${encodeURIComponent(user.session_token)}&expires_at=${encodeURIComponent(user.session_expires_at)}` });
            return res.end();
          }
          pendingSessions.set(state, { session, created: Date.now() });
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(htmlPage('Login Success', user.username, true));
      } catch (err) {
        console.error('[auth] feishu callback error:', err && (err.stack || err.message));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(htmlPage('Auth Failed', 'Authentication failed, please retry', false));
      }
    }

    if (method === 'GET' && path === '/api/v1/auth/session') {
      const u = auth(req);
      if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      return json(res, { user: { id: u.id, username: u.username, email: u.email, role: u.role } });
    }

    if (method === 'POST' && path === '/api/v1/auth/logout') {
      const u = auth(req);
      if (u) db.prepare("UPDATE users SET session_token=NULL, session_expires_at=NULL WHERE id=?").run(u.id);
      return json(res, { success: true });
    }

    // ========== Sync ==========
    if (method === 'POST' && path === '/api/v1/sync/push') {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const body = await parseBody(req);
      if (body.__too_large) return json(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413);
      let accepted = 0;
      const stmt = db.prepare('INSERT OR REPLACE INTO conversations (id,user_id,user_message,agent_reply,model_name,token_usage,created_at) VALUES (?,?,?,?,?,?,?)');
      for (const c of (body.conversations || [])) { stmt.run(c.id, u.id, c.user_message, c.agent_reply, c.model_name, c.token_usage || 0, c.created_at); accepted++; }
      return json(res, { accepted, rejected: 0, conflicts: [] });
    }

    if (method === 'GET' && path === '/api/v1/sync/pull') {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const since = url.searchParams.get('since') || '1970-01-01';
      const conversations = db.prepare('SELECT * FROM conversations WHERE user_id=? AND created_at>? ORDER BY created_at LIMIT 100').all(u.id, since);
      const logs = db.prepare('SELECT * FROM operation_logs WHERE user_id=? AND created_at>? ORDER BY created_at LIMIT 100').all(u.id, since);
      return json(res, { conversations, operation_logs: logs, server_time: new Date().toISOString() });
    }

    // ========== Tools ==========
    if (method === 'GET' && path === '/api/v1/tools') {
      const cat = url.searchParams.get('category'); const q = url.searchParams.get('search') || '';
      let sql = "SELECT id,name,description,category,version,author,download_count,like_count FROM tools WHERE status='published'"; const p = [];
      if (cat) { sql += ' AND category=?'; p.push(cat); }
      if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
      return json(res, { items: db.prepare(sql + ' ORDER BY like_count DESC LIMIT 50').all(...p), total: 0 });
    }

    // Like toggle (published only)
    const likeMatch = path.match(/^\/api\/v1\/tools\/(.+)\/like$/);
    if (method === 'POST' && likeMatch) {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const tool = db.prepare('SELECT like_count, status FROM tools WHERE id=?').get(likeMatch[1]);
      if (!tool || tool.status !== 'published') return json(res, { error: { code: 'NOT_FOUND', message: 'Tool not found' } }, 404);
      db.prepare('UPDATE tools SET like_count=like_count+1 WHERE id=?').run(likeMatch[1]);
      return json(res, { like_count: (tool.like_count || 0) + 1, liked: true });
    }

    // ========== User Space ==========
    if (method === 'GET' && path === '/api/v1/users/me/dashboard') {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const convCount = db.prepare('SELECT COUNT(*) c FROM conversations WHERE user_id=?').get(u.id).c;
      const opsCount = db.prepare('SELECT COUNT(*) c FROM operation_logs WHERE user_id=?').get(u.id).c;
      return json(res, { total_conversations: convCount, total_operations: opsCount, recent_operations: [] });
    }

    if (method === 'GET' && path === '/api/v1/users/me/conversations') {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const items = db.prepare("SELECT id,substr(user_message,1,200) user_message,substr(agent_reply,1,200) agent_reply_summary,model_name,created_at FROM conversations WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(u.id);
      return json(res, { items, total: items.length });
    }

    if (method === 'GET' && path === '/api/v1/users/me/errors') {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const items = db.prepare("SELECT * FROM error_logs WHERE user_id=? OR user_id IS NULL ORDER BY occurred_at DESC LIMIT 50").all(u.id);
      return json(res, { items, total: items.length });
    }

    // ========== Admin ==========
    const toolMatch = path.match(/^\/api\/v1\/admin\/tools\/([^/]+)$/);

    if (method === 'POST' && path === '/api/v1/admin/tools') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const body = await parseBody(req);
      if (body.__too_large) return json(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413);
      const id = body.id || crypto.randomUUID();
      const status = body.status || 'published';
      if (!['published', 'unpublished', 'pending'].includes(status)) {
        return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Invalid status' } }, 400);
      }
      let storagePath = body.storage_path || '';
      let manifest = body.manifest || null;

      // Optional tool package upload (base64 zip). Stored under /data/tools/.
      if (body.file_base64 && typeof body.file_base64 === 'string') {
        // Pre-check base64 string length before decoding (DoS guard).
        if (body.file_base64.length > Math.ceil((100 * 1024 * 1024) / 3) * 4) {
          return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Package too large (max 100MB)' } }, 400);
        }
        const buf = Buffer.from(body.file_base64, 'base64');
        if (buf.length > 100 * 1024 * 1024) {
          return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Package too large (max 100MB)' } }, 400);
        }
        if (buf.length < 4 || buf.toString('latin1', 0, 4) !== 'PK\u0003\u0004') {
          return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Invalid zip file' } }, 400);
        }
        const toolsDir = pathMod.join(STORAGE_PATH, 'tools');
        fsMod.mkdirSync(toolsDir, { recursive: true });
        const rawName = body.filename && /\.zip$/i.test(body.filename) ? body.filename : `${id}.zip`;
        const filename = pathMod.basename(rawName); // prevent path traversal
        fsMod.writeFileSync(pathMod.join(toolsDir, filename), buf);
        storagePath = `tools/${filename}`;
        manifest = JSON.stringify({ format: 'miniapp-zip', filename, size: buf.length, uploaded_at: new Date().toISOString() });
      }

      db.prepare('INSERT INTO tools (id,name,description,category,version,author,manifest,storage_path,status) VALUES (?,?,?,?,?,?,?,?,?)').run(id, body.name, body.description, body.category, body.version, body.author, manifest, storagePath, status);
      return json(res, { success: true, id }, 201);
    }

    // User-facing tool package download: authenticated users may download
    // published tools (pending/unpublished are withheld). Serves /tools/:id/files.
    const toolFilesMatch = path.match(/^\/api\/v1\/tools\/([^/]+)\/files$/);
    if (method === 'GET' && toolFilesMatch) {
      const user = auth(req);
      if (!user) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const id = toolFilesMatch[1];
      const tool = db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
      if (!tool || !tool.storage_path || tool.status !== 'published') {
        return json(res, { error: { code: 'NOT_FOUND', message: 'Tool package not found' } }, 404);
      }
      const filePath = pathMod.join(STORAGE_PATH, 'tools', pathMod.basename(tool.storage_path || ''));
      if (!fsMod.existsSync(filePath)) return json(res, { error: { code: 'NOT_FOUND', message: 'Package file missing' } }, 404);
      db.prepare('UPDATE tools SET download_count = download_count + 1 WHERE id = ?').run(id);
      const filename = pathMod.basename(filePath).replace(/"/g, '');
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fsMod.statSync(filePath).size,
      });
      fsMod.createReadStream(filePath).pipe(res);
      return;
    }

    const toolDownloadMatch = path.match(/^\/api\/v1\/admin\/tools\/([^/]+)\/download$/);
    if (method === 'GET' && toolDownloadMatch) {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const id = toolDownloadMatch[1];
      const tool = db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
      if (!tool || !tool.storage_path) return json(res, { error: { code: 'NOT_FOUND', message: 'Tool package not found' } }, 404);
      const filePath = pathMod.join(STORAGE_PATH, 'tools', pathMod.basename(tool.storage_path || ''));
      if (!fsMod.existsSync(filePath)) return json(res, { error: { code: 'NOT_FOUND', message: 'Package file missing' } }, 404);
      const filename = pathMod.basename(filePath).replace(/"/g, '');
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fsMod.statSync(filePath).size,
      });
      fsMod.createReadStream(filePath).pipe(res);
      return;
    }

    if (method === 'GET' && path === '/api/v1/admin/tools') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const items = db.prepare('SELECT * FROM tools ORDER BY created_at DESC').all();
      return json(res, { items, total: items.length });
    }

    if (method === 'PUT' && toolMatch) {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const id = toolMatch[1];
      const existing = db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
      if (!existing) return json(res, { error: { code: 'NOT_FOUND', message: 'Tool not found' } }, 404);
      const body = await parseBody(req);
      if (body.__too_large) return json(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413);
      if (body.status !== undefined && !['published', 'unpublished', 'pending'].includes(body.status)) {
        return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Invalid status' } }, 400);
      }
      if (body.status) db.prepare("UPDATE tools SET status = ? WHERE id = ?").run(body.status, id);
      if (body.name) db.prepare('UPDATE tools SET name = ? WHERE id = ?').run(body.name, id);
      if (body.description) db.prepare('UPDATE tools SET description = ? WHERE id = ?').run(body.description, id);
      if (body.category) db.prepare('UPDATE tools SET category = ? WHERE id = ?').run(body.category, id);
      if (body.version) db.prepare('UPDATE tools SET version = ? WHERE id = ?').run(body.version, id);
      return json(res, { success: true });
    }

    if (method === 'DELETE' && toolMatch) {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const id = toolMatch[1];
      db.prepare("UPDATE tools SET status = 'unpublished' WHERE id = ?").run(id);
      return json(res, { success: true });
    }

    if (method === 'GET' && path === '/api/v1/admin/history') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
      const offset = (page - 1) * limit;
      let where = 'WHERE 1=1';
      const params = [];
      const userId = url.searchParams.get('user_id');
      const type = url.searchParams.get('type');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (userId) { where += ' AND user_id = ?'; params.push(userId); }
      if (type) { where += ' AND operation_type = ?'; params.push(type); }
      if (from) { where += ' AND created_at >= ?'; params.push(from); }
      if (to) { where += ' AND created_at <= ?'; params.push(to); }
      const items = db.prepare(`SELECT * FROM operation_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) c FROM operation_logs ${where}`).get(...params).c;
      return json(res, { items, total, page, limit });
    }

    if (method === 'GET' && path === '/api/v1/admin/users') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      const offset = (page - 1) * limit;
      const items = db.prepare('SELECT id,username,email,role,status,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
      const total = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      return json(res, { items, total, page, limit });
    }

    const userFieldMatch = path.match(/^\/api\/v1\/admin\/users\/([^/]+)\/(role|status)$/);
    if (method === 'PUT' && userFieldMatch) {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const id = userFieldMatch[1];
      const field = userFieldMatch[2];
      const me = auth(req);
      if (me && me.id === id) return json(res, { error: { code: 'FORBIDDEN', message: 'Cannot modify your own account' } }, 403);
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!target) return json(res, { error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
      const body = await parseBody(req);
      if (body.__too_large) return json(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413);
      if (field === 'role') {
        if (!['admin', 'user'].includes(body.role)) return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Invalid role' } }, 400);
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
      } else {
        if (!['active', 'disabled'].includes(body.status)) return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Invalid status' } }, 400);
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, id);
        if (body.status === 'disabled') db.prepare('UPDATE users SET session_token=NULL, session_expires_at=NULL WHERE id=?').run(id);
      }
      return json(res, { success: true });
    }

    const userDeleteMatch = path.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (method === 'DELETE' && userDeleteMatch) {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const id = userDeleteMatch[1];
      const me = auth(req);
      if (me && me.id === id) return json(res, { error: { code: 'FORBIDDEN', message: 'Cannot delete your own account' } }, 403);
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!target) return json(res, { error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return json(res, { success: true });
    }

    if (method === 'GET' && path === '/api/v1/admin/errors') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const items = db.prepare('SELECT * FROM error_logs ORDER BY occurred_at DESC LIMIT 100').all();
      const byType = db.prepare('SELECT error_type, COUNT(*) c FROM error_logs GROUP BY error_type').all();
      return json(res, { items, total: items.length, by_type: byType });
    }

    // ========== Updates ==========
    if (method === 'GET' && path === '/api/v1/updates/latest') {
      return json(res, { latest_version: process.env.LATEST_VERSION || '0.0.1', update_available: false });
    }

    // 404
    json(res, { error: { code: 'NOT_FOUND', message: `${method} ${path}` } }, 404);

  } catch (err) {
    console.error('Error:', err);
    json(res, { error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`TsPlatform API running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/v1/health`);
  console.log(`Callback: ${FEISHU_REDIRECT_URI}`);
});
