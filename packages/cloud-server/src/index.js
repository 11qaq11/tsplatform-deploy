// TsPlatform Cloud Server — 纯 Node.js 实现，零框架依赖
const http = require('http');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.API_PORT || '3000', 10);
const DB_PATH = process.env.DB_PATH || '/data/tsplatform.db';
const API_BASE_URL = process.env.API_BASE_URL || `http://122.51.90.193:${PORT}`;

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
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
    created_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT DEFAULT (datetime('now')),
    session_token TEXT,
    session_expires_at TEXT
  );

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

// === Helpers ===

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; });
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

    // ========== Auth ==========
    if (method === 'GET' && path === '/api/v1/auth/feishu/authorize') {
      const state = crypto.randomUUID();
      const p = new URLSearchParams({ app_id: FEISHU_APP_ID, redirect_uri: FEISHU_REDIRECT_URI, state, scope: 'openid' });
      return json(res, { redirect_url: `https://open.feishu.cn/open-apis/authen/v1/authorize?${p}`, state });
    }

    if (method === 'GET' && path === '/api/v1/auth/feishu/callback') {
      const code = url.searchParams.get('code');
      if (!code) return json(res, { error: { code: 'VALIDATION_ERROR', message: 'Missing code' } }, 400);

      // Exchange code for token
      const tb = new URLSearchParams({ grant_type: 'authorization_code', client_id: FEISHU_APP_ID, client_secret: FEISHU_APP_SECRET, code, redirect_uri: FEISHU_REDIRECT_URI });
      const tr = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tb.toString() });
      const td = await tr.json();
      if (td.code !== 0) return json(res, { error: { code: 'UNAUTHORIZED', message: td.msg } }, 401);

      // Get user info
      const ur = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', { headers: { Authorization: `Bearer ${td.data.access_token}` } });
      const ud = await ur.json();
      if (!ud.data) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);

      const { open_id, union_id, name, email, avatar_url } = ud.data;

      let user = db.prepare('SELECT * FROM users WHERE feishu_open_id=?').get(open_id);
      const token = crypto.randomUUID();
      const exp = new Date(Date.now() + 7 * 86400000).toISOString();

      if (user) {
        db.prepare("UPDATE users SET session_token=?,session_expires_at=?,last_login_at=datetime('now') WHERE id=?").run(token, exp, user.id);
        user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      } else {
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO users (id,feishu_open_id,feishu_union_id,username,email,avatar_url,session_token,session_expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, open_id, union_id, name, email || null, avatar_url || null, token, exp);
        user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      }

      return json(res, {
        session_token: user.session_token,
        expires_at: user.session_expires_at,
        user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, role: user.role },
      });
    }

    if (method === 'GET' && path === '/api/v1/auth/session') {
      const u = auth(req);
      if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      return json(res, { user: { id: u.id, username: u.username, email: u.email, role: u.role } });
    }

    // ========== Sync ==========
    if (method === 'POST' && path === '/api/v1/sync/push') {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      const body = await parseBody(req);
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

    // Like toggle
    const likeMatch = path.match(/^\/api\/v1\/tools\/(.+)\/like$/);
    if (method === 'POST' && likeMatch) {
      const u = auth(req); if (!u) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      db.prepare('UPDATE tools SET like_count=like_count+1 WHERE id=?').run(likeMatch[1]);
      const t = db.prepare('SELECT like_count FROM tools WHERE id=?').get(likeMatch[1]);
      return json(res, { like_count: t?.like_count || 0, liked: true });
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
    if (method === 'POST' && path === '/api/v1/admin/tools') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const body = await parseBody(req);
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO tools (id,name,description,category,version,author,manifest,storage_path) VALUES (?,?,?,?,?,?,?,?)').run(id, body.name, body.description, body.category, body.version, body.author, JSON.stringify(body.manifest || {}), body.storage_path || '');
      return json(res, { success: true, id }, 201);
    }

    if (method === 'GET' && path === '/api/v1/admin/users') {
      if (!adminAuth(req)) return json(res, { error: { code: 'UNAUTHORIZED' } }, 403);
      const items = db.prepare('SELECT id,username,email,role,created_at,last_login_at FROM users ORDER BY created_at DESC').all();
      return json(res, { items, total: items.length });
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
