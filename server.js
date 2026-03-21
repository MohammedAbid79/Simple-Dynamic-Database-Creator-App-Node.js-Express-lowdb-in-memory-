'use strict';

const http       = require('http');
const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const os         = require('os');
const fs         = require('fs');
const WebSocketServer = require('ws').Server;
const swaggerUi  = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const alasql     = require('alasql');

// ─── Backup directory ─────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(__dirname, 'backup');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ─── Persistent lowdb setup ───────────────────────────────────────────────────
const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const db = low(new FileSync(path.join(__dirname, 'db.json')));

db.defaults({
  users: [
    { id: uuidv4(), username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'admin' },
    { id: uuidv4(), username: 'guest', password: bcrypt.hashSync('guest123', 10), role: 'guest' },
  ],
  databases:   [],   // { id, name, createdBy, createdAt, fields: [] }
  records:     [],   // { id, databaseId, data: {}, createdBy, createdAt, updatedAt }
  activityLog: [],   // { id, action, user, target, detail, timestamp }
  apiKeys:     [],   // { id, key, name, userId, createdAt, lastUsed }
  webhooks:    [],   // { id, event, url, name, secret, createdBy, createdAt, active }
  credentials: [],   // { id, name, value, description, createdBy, createdAt, updatedAt }
  relationships: [], // { id, name, fromDb, fromField, toDb, toField, type, createdBy, createdAt }
  shareLinks:  [],   // { id, token, databaseId, permission, label, createdBy, createdAt, expiresAt, accessCount }
}).write();

// ─── Activity log helper ──────────────────────────────────────────────────────
function logActivity(action, user, target, detail) {
  db.get('activityLog').push({
    id: uuidv4(), action, user,
    target: target || '', detail: detail || '',
    timestamp: new Date().toISOString(),
  }).write();
  const all = db.get('activityLog').value();
  if (all.length > 200) db.set('activityLog', all.slice(-200)).write();
}

// ─── Auth user helper ─────────────────────────────────────────────────────────
// Returns the authenticated user whether they came via session or API key.
function getAuthUser(req) {
  return req._apiUser || req.session.user;
}

// ─── Rate limiter (in-memory sliding window) ──────────────────────────────────
const _rlMap = new Map();
// Clean up stale entries every 5 minutes to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _rlMap) {
    if (now - e.start >= e.windowMs) _rlMap.delete(k);
  }
}, 5 * 60 * 1000).unref();

function createRateLimiter(max, windowMs) {
  return function rateLimitMiddleware(req, res, next) {
    const key = `${req.ip}|${max}|${windowMs}`;
    const now = Date.now();
    let e = _rlMap.get(key);
    if (!e || now - e.start >= windowMs) {
      e = { count: 0, start: now, windowMs };
      _rlMap.set(key, e);
    }
    e.count++;
    const remaining = Math.max(0, max - e.count);
    res.set('X-RateLimit-Limit',     String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset',     String(Math.ceil((e.start + windowMs) / 1000)));
    if (e.count > max) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    next();
  };
}

// 10 req/min for login (brute-force protection), 120 req/min for all other API
const loginLimiter = createRateLimiter(10,  60 * 1000);
const apiLimiter   = createRateLimiter(120, 60 * 1000);

// ─── Webhook Event System ────────────────────────────────────────────────────
const WEBHOOK_EVENTS = [
  'record.created', 'record.updated', 'record.deleted',
  'database.created', 'database.deleted',
];

const _deliveryLog = new Map();   // webhookId → [{ event, statusCode, duration, success, error, timestamp }]

function isValidWebhookUrl(url) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch (_) { return false; }
}

async function deliverWebhook(hook, event, payload) {
  const deliveryId = uuidv4();
  const body = JSON.stringify({ event, deliveryId, timestamp: new Date().toISOString(), ...payload });
  const headers = {
    'Content-Type':      'application/json',
    'User-Agent':        'FluxDB-Webhooks/1.0',
    'X-FluxDB-Event':    event,
    'X-FluxDB-Delivery': deliveryId,
  };
  if (hook.secret) {
    headers['X-FluxDB-Signature'] =
      'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
  }

  const start = Date.now();
  let statusCode = null, success = false, error = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST', headers, body,
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    success    = res.ok;
  } catch (err) {
    error = err.name === 'TimeoutError' ? 'Timeout (5 s)' : err.message.slice(0, 120);
  }

  const entry = {
    event, statusCode, success, error,
    duration:  Date.now() - start,
    timestamp: new Date().toISOString(),
  };
  const log = _deliveryLog.get(hook.id) || [];
  log.unshift(entry);
  if (log.length > 20) log.pop();
  _deliveryLog.set(hook.id, log);
  console.log(`[WEBHOOK] ${event} → ${hook.url} | ${statusCode ?? error} | ${entry.duration}ms`);
}

// Fire-and-forget — call from any route after a state change
function fireWebhooks(event, payload) {
  const hooks = db.get('webhooks').filter({ event, active: true }).value();
  for (const hook of hooks) deliverWebhook(hook, event, payload).catch(() => {});
}

// ─── Real-Time WebSocket streaming ────────────────────────────────────────────
// Each connected client is stored with its subscription list.
// wsClients: Set of { ws, user, subscriptions: Set<databaseId|'*'> }
const wsClients = new Set();

// Called from every CRUD route to push an event to all subscribed clients
function broadcastWS(event, databaseName, databaseId, data) {
  const msg = JSON.stringify({
    event, database: databaseName, databaseId, data,
    timestamp: new Date().toISOString(),
  });
  for (const client of wsClients) {
    if (client.ws.readyState !== 1 /* OPEN */) continue;
    const { subscriptions } = client;
    if (subscriptions.has('*') || subscriptions.has(databaseId)) {
      client.ws.send(msg);
    }
  }
}

// Short-lived tokens so the browser can open a WS without sending credentials
// over the WS handshake (which can't carry custom headers from the browser).
const _streamTokens = new Map(); // token → { username, role, expires }

// ─── Threat Detection Engine ───────────────────────────────────────────────────
const _threatLog  = [];           // in-memory ring buffer (max 500 entries)
const _blockedIPs = new Map();    // ip → timestamp when block expires
const _burstMap   = new Map();    // ip → { count, start } for 30-second burst window

// Clean up stale burst windows and expired IP blocks every minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of _burstMap)   { if (now - e.start >= 30_000)  _burstMap.delete(ip); }
  for (const [ip, until] of _blockedIPs) { if (now >= until) _blockedIPs.delete(ip); }
}, 60_000).unref();

// SQL injection signatures — focused on the highest-confidence patterns
const SQL_INJECTION_PATTERNS = [
  /\bUNION\b.{0,30}\bSELECT\b/i,                          // UNION SELECT
  /;\s*(DROP|TRUNCATE|DELETE\s+FROM|ALTER|CREATE)\s+/i,   // ; DROP TABLE …
  /'\s*(OR|AND)\s+['"\d\w]/i,                             // ' OR '1
  /'\s*=\s*'[\s\d]/,                                      // '='  or  '=' 1
  /\bEXEC(UTE)?\s*[\(@]/i,                                // EXEC( / EXEC @
  /\bxp_\w+/i,                                            // xp_cmdshell etc
  /\bWAITFOR\s+DELAY\b/i,                                 // time-based blind
  /\bSLEEP\s*\(\s*\d/i,                                   // SLEEP(5)
  /\bBENCHMARK\s*\(\s*\d/i,                               // BENCHMARK(n,expr)
  /0x[0-9a-f]{4,}/i,                                      // hex-encoded payloads
];

// XSS signatures
const XSS_PATTERNS = [
  /<script[\s>/]/i,
  /javascript\s*:/i,
  /on(?:click|load|error|mouseover|focus|blur|input|submit)\s*=/i,
  /<iframe[\s>/]/i,
  /eval\s*\(/i,
];

function addThreat({ type, severity, ip, username, method, endpoint, detail, blocked }) {
  const entry = {
    id:        uuidv4(),
    type,
    severity,
    ip:        ip || 'unknown',
    username:  username || null,
    method:    method || '',
    endpoint:  endpoint || '',
    detail,
    blocked:   !!blocked,
    timestamp: new Date().toISOString(),
  };
  _threatLog.push(entry);
  if (_threatLog.length > 500) _threatLog.shift();
  console.warn(`[THREAT] ${severity.toUpperCase()} | ${type} | ${ip} | ${detail}`);
  return entry;
}

// Returns true (and records + blocks) if this request looks like a burst attack
function checkBurstAbuse(req) {
  const ip  = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  // Is IP already blocked?
  const blockedUntil = _blockedIPs.get(ip);
  if (blockedUntil && now < blockedUntil) return true;

  let e = _burstMap.get(ip);
  if (!e || now - e.start >= 30_000) {
    e = { count: 0, start: now };
    _burstMap.set(ip, e);
  }
  e.count++;

  if (e.count === 101) {   // fire once exactly at the threshold
    const user = getAuthUser(req);
    addThreat({
      type:     'rate_abuse',
      severity: 'high',
      ip,
      username: user?.username || null,
      method:   req.method,
      endpoint: req.path,
      detail:   `${e.count} requests in ${Math.round((now - e.start) / 1000)}s (burst window)`,
      blocked:  true,
    });
    _blockedIPs.set(ip, now + 5 * 60_000);  // block for 5 minutes
    return true;
  }
  return e.count > 101 && _blockedIPs.has(ip);
}

// Scan a single string value for injection patterns
function scanValue(value, fieldPath, req) {
  if (typeof value !== 'string') return false;
  const ip   = req.ip || 'unknown';
  const user = getAuthUser(req);

  for (const pat of SQL_INJECTION_PATTERNS) {
    if (pat.test(value)) {
      addThreat({
        type: 'sql_injection', severity: 'critical', ip,
        username: user?.username || null,
        method: req.method, endpoint: req.path,
        detail: `SQL pattern matched in "${fieldPath}": ${value.slice(0, 120)}`,
        blocked: true,
      });
      return true;
    }
  }
  for (const pat of XSS_PATTERNS) {
    if (pat.test(value)) {
      addThreat({
        type: 'xss_attempt', severity: 'high', ip,
        username: user?.username || null,
        method: req.method, endpoint: req.path,
        detail: `XSS pattern matched in "${fieldPath}": ${value.slice(0, 120)}`,
        blocked: true,
      });
      return true;
    }
  }
  return false;
}

// Recursively scan an object/flat value; returns true if a threat was found
function scanObject(obj, req, prefix) {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'string') return scanValue(obj, prefix || 'value', req);
  if (typeof obj !== 'object') return false;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' && scanValue(v, path, req)) return true;
    if (v && typeof v === 'object' && scanObject(v, req, path)) return true;
  }
  return false;
}

// Main threat-detection middleware — applied to all /api routes
function threatDetection(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  // 1. Blocked IP check
  const blockedUntil = _blockedIPs.get(ip);
  if (blockedUntil && Date.now() < blockedUntil) {
    return res.status(403).json({
      error:      'Access temporarily blocked due to suspicious activity.',
      retryAfter: Math.ceil((blockedUntil - Date.now()) / 1000),
    });
  }

  // 2. Burst-rate abuse (>100 req / 30 s per IP)
  if (checkBurstAbuse(req)) {
    return res.status(429).json({
      error:      'Too many requests. Your IP has been temporarily blocked for 5 minutes.',
      retryAfter: 300,
    });
  }

  // 3. Injection scan — skip /query (intentionally accepts SQL) and /auth (passwords)
  const skip = req.path === '/query' || req.path.startsWith('/auth');
  if (!skip) {
    if (req.body && scanObject(req.body, req, 'body')) {
      return res.status(400).json({ error: 'Request blocked: injection pattern detected.' });
    }
    if (req.query && Object.keys(req.query).length && scanObject(req.query, req, 'query')) {
      return res.status(400).json({ error: 'Request blocked: injection pattern detected.' });
    }
  }

  next();
}

// Apply threat detection after the general rate limiter, before all routes

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Self-hosted fonts (no internet required)
app.use('/fonts/inter', express.static(
  path.join(__dirname, 'node_modules/@fontsource/inter')
));

// ─── Swagger / API docs ───────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'FluxDB API Docs',
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif }
    body { background: #0c0e1a }
    .swagger-ui .info .title { color: #dde2f2 }
  `,
}));

app.use(session({
  secret: 'dyndb-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 },
}));

// Apply general rate limit to all /api routes
app.use('/api', apiLimiter);
app.use('/api', threatDetection);

// ─── API key RBAC constants ───────────────────────────────────────────────────
// Three key roles that map onto existing session roles:
//   admin  → full control  (session: admin)
//   editor → read + write  (session: member)
//   viewer → read only     (session: guest)
const KEY_ROLES    = ['admin', 'editor', 'viewer'];
const KEY_ROLE_MAP = { admin: 'admin', editor: 'member', viewer: 'guest' };
// Numeric level used for privilege-cap enforcement
const ROLE_LEVEL   = { admin: 3, member: 2, guest: 1 };

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  // 1. Session-based auth (web UI)
  if (req.session.user) return next();

  // 2. API key auth (X-API-Key header or Authorization: Bearer <key>)
  const rawKey = (req.headers['x-api-key'] || '').trim() ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();

  if (!rawKey) return res.status(401).json({ error: 'Not authenticated' });

  const apiKey = db.get('apiKeys').find({ key: rawKey }).value();
  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });

  const user = db.get('users').find({ id: apiKey.userId }).value();
  if (!user) return res.status(401).json({ error: 'Invalid API key' });

  // Update last-used timestamp
  db.get('apiKeys').find({ id: apiKey.id })
    .assign({ lastUsed: new Date().toISOString() }).write();

  // Determine effective role: map key role → session role, then cap by user's own level
  // (a member can never wield an admin key even if one was manually inserted)
  const keyRoleRaw    = apiKey.role || 'editor';          // default for old keys
  const mappedRole    = KEY_ROLE_MAP[keyRoleRaw] || 'guest';
  const userLevel     = ROLE_LEVEL[user.role]    || 1;
  const keyLevel      = ROLE_LEVEL[mappedRole]   || 1;
  const effectiveRole = keyLevel <= userLevel ? mappedRole : user.role;

  req._apiUser = { id: user.id, username: user.username, role: effectiveRole, keyRole: keyRoleRaw };
  next();
}

function requireAdmin(req, res, next) {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// admin or member — guests/viewers are blocked
function requireMember(req, res, next) {
  const user = getAuthUser(req);
  if (!user || user.role === 'guest') {
    return res.status(403).json({ error: 'Write access required (editor or admin key)' });
  }
  next();
}

// ─── Auth routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const user = db.get('users').find({ username }).value();
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(getAuthUser(req));
});

app.post('/api/auth/register', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'Username must be 3–32 characters' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, _ and -' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (db.get('users').find({ username }).value()) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const newUser = { id: uuidv4(), username, password: bcrypt.hashSync(password, 10), role: 'member' };
  db.get('users').push(newUser).write();
  req.session.user = { id: newUser.id, username, role: 'member' };
  res.status(201).json({ username, role: 'member' });
});

// ─── User management (admin only) ────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.get('users')
    .map(u => ({ id: u.id, username: u.username, role: u.role })).value();
  res.json(users);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['admin', 'member', 'guest'].includes(role)) {
    return res.status(400).json({ error: 'username, password, and role (admin|member|guest) required' });
  }
  if (db.get('users').find({ username }).value()) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const newUser = { id: uuidv4(), username, password: bcrypt.hashSync(password, 10), role };
  db.get('users').push(newUser).write();
  res.status(201).json({ id: newUser.id, username, role });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { password, role } = req.body;
  const user = db.get('users').find({ id: req.params.id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.username === 'admin' && role && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot change role of default admin' });
  }
  const updates = {};
  if (password) updates.password = bcrypt.hashSync(password, 10);
  if (role && ['admin', 'member', 'guest'].includes(role)) updates.role = role;
  db.get('users').find({ id: req.params.id }).assign(updates).write();
  const updated = db.get('users').find({ id: req.params.id }).value();
  res.json({ id: updated.id, username: updated.username, role: updated.role });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const user = db.get('users').find({ id: req.params.id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.username === 'admin' || user.username === 'guest') {
    return res.status(400).json({ error: 'Cannot delete default system accounts' });
  }
  db.get('users').remove({ id: req.params.id }).write();
  res.json({ message: 'User deleted' });
});

// ─── API key management ───────────────────────────────────────────────────────
app.get('/api/keys', requireMember, (req, res) => {
  const user = getAuthUser(req);
  const keys = db.get('apiKeys')
    .filter({ userId: user.id })
    .map(k => ({
      id:         k.id,
      name:       k.name,
      role:       k.role || 'editor',   // backward-compat default
      keyPreview: k.key.slice(0, 14) + '…',
      createdAt:  k.createdAt,
      lastUsed:   k.lastUsed,
    }))
    .value();
  res.json(keys);
});

app.post('/api/keys', requireMember, (req, res) => {
  const user = getAuthUser(req);
  const { name, role } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }

  // Validate role — default to editor
  const requestedRole = KEY_ROLES.includes(role) ? role : 'editor';

  // Privilege-cap: cannot create a key with more power than your own session role
  const mappedRole = KEY_ROLE_MAP[requestedRole];
  const userLevel  = ROLE_LEVEL[user.role]  || 1;
  const keyLevel   = ROLE_LEVEL[mappedRole] || 1;
  if (keyLevel > userLevel) {
    return res.status(403).json({
      error: `Your account role (${user.role}) cannot create a ${requestedRole} key`,
    });
  }

  const existing = db.get('apiKeys').filter({ userId: user.id }).value();
  if (existing.length >= 10) {
    return res.status(400).json({ error: 'Maximum 10 API keys per user' });
  }

  const key    = 'dyndb_' + crypto.randomBytes(24).toString('hex');
  const newKey = {
    id:        uuidv4(),
    key,
    name:      name.trim(),
    role:      requestedRole,
    userId:    user.id,
    createdAt: new Date().toISOString(),
    lastUsed:  null,
  };
  db.get('apiKeys').push(newKey).write();
  logActivity('create_key', user.username, newKey.name,
    `Created ${requestedRole} API key "${newKey.name}"`);
  res.status(201).json({
    id: newKey.id, name: newKey.name, key, role: requestedRole, createdAt: newKey.createdAt,
  });
});

// PATCH /api/keys/:id — update role only (admin or key owner)
app.patch('/api/keys/:id', requireMember, (req, res) => {
  const user   = getAuthUser(req);
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) return res.status(404).json({ error: 'API key not found' });
  if (apiKey.userId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: "Cannot modify another user's API key" });
  }

  const { role } = req.body;
  if (!KEY_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${KEY_ROLES.join(', ')}` });
  }

  // Privilege cap
  const mappedRole = KEY_ROLE_MAP[role];
  const userLevel  = ROLE_LEVEL[user.role]  || 1;
  const keyLevel   = ROLE_LEVEL[mappedRole] || 1;
  if (keyLevel > userLevel) {
    return res.status(403).json({
      error: `Your account role (${user.role}) cannot set a ${role} key`,
    });
  }

  db.get('apiKeys').find({ id: apiKey.id }).assign({ role }).write();
  logActivity('update_key', user.username, apiKey.name,
    `Changed key "${apiKey.name}" role to ${role}`);
  res.json({ id: apiKey.id, name: apiKey.name, role });
});

app.delete('/api/keys/:id', requireMember, (req, res) => {
  const user   = getAuthUser(req);
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) return res.status(404).json({ error: 'API key not found' });
  if (apiKey.userId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: "Cannot revoke another user's API key" });
  }
  db.get('apiKeys').remove({ id: req.params.id }).write();
  logActivity('delete_key', user.username, apiKey.name,
    `Revoked ${apiKey.role || 'editor'} key "${apiKey.name}"`);
  res.json({ message: 'API key revoked' });
});

// ─── Stream token endpoint ────────────────────────────────────────────────────
// Returns a one-time token (60 s TTL) the browser exchanges for a WS connection.
app.get('/api/stream/token', requireAuth, (req, res) => {
  const user  = getAuthUser(req);
  const token = crypto.randomBytes(20).toString('hex');
  _streamTokens.set(token, {
    username: user.username, role: user.role,
    expires: Date.now() + 60_000,
  });
  // Prune expired tokens
  for (const [k, v] of _streamTokens) {
    if (v.expires < Date.now()) _streamTokens.delete(k);
  }
  res.json({ token });
});

// GET /api/stream/status — live connection count + subscriptions overview
app.get('/api/stream/status', requireAuth, (req, res) => {
  const connections = [];
  for (const c of wsClients) {
    if (c.ws.readyState !== 1) continue;
    connections.push({
      user:          c.user.username,
      role:          c.user.role,
      subscriptions: [...c.subscriptions],
      since:         c.connectedAt,
    });
  }
  res.json({ count: connections.length, connections });
});

// ─── Dynamic Relationship Engine ─────────────────────────────────────────────
const REL_TYPES = ['one-to-one', 'one-to-many'];

// ── CRUD ──────────────────────────────────────────────────────────────────────
app.get('/api/relationships', requireAuth, (req, res) => {
  const allDbs = db.get('databases').value();
  const rels   = db.get('relationships').value().map(r => ({
    ...r,
    fromDbName:  allDbs.find(d => d.id === r.fromDb)?.name  || '(deleted)',
    toDbName:    allDbs.find(d => d.id === r.toDb)?.name    || '(deleted)',
    fromFields:  allDbs.find(d => d.id === r.fromDb)?.fields || [],
    toFields:    allDbs.find(d => d.id === r.toDb)?.fields   || [],
  }));
  res.json(rels);
});

app.post('/api/relationships', requireMember, (req, res) => {
  const user = getAuthUser(req);
  const { name, fromDb, fromField, toDb, toField, type } = req.body;

  if (!fromDb || !fromField || !toDb || !toField) {
    return res.status(400).json({ error: 'fromDb, fromField, toDb, toField are required' });
  }
  if (!db.get('databases').find({ id: fromDb }).value()) {
    return res.status(404).json({ error: 'Source database not found' });
  }
  if (!db.get('databases').find({ id: toDb }).value()) {
    return res.status(404).json({ error: 'Target database not found' });
  }
  if (type && !REL_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${REL_TYPES.join(', ')}` });
  }

  const rel = {
    id:        uuidv4(),
    name:      (name || '').trim() || `${fromDb}.${fromField} → ${toDb}.${toField}`,
    fromDb, fromField, toDb, toField,
    type:      type || 'one-to-many',
    createdBy: user.username,
    createdAt: new Date().toISOString(),
  };
  db.get('relationships').push(rel).write();
  logActivity('create_rel', user.username, rel.name, `Defined relationship "${rel.name}"`);
  res.status(201).json(rel);
});

app.delete('/api/relationships/:id', requireMember, (req, res) => {
  const user = getAuthUser(req);
  const rel  = db.get('relationships').find({ id: req.params.id }).value();
  if (!rel) return res.status(404).json({ error: 'Relationship not found' });
  db.get('relationships').remove({ id: req.params.id }).write();
  logActivity('delete_rel', user.username, rel.name, `Deleted relationship "${rel.name}"`);
  res.json({ message: 'Relationship deleted' });
});

// ── Core join engine ──────────────────────────────────────────────────────────
function flattenRecord(r) {
  // Use the same field names as the query engine (id, createdBy, createdAt, updatedAt)
  // so join specs like { toField: "id" } work naturally.
  return { id: r.id, createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt, ...r.data };
}

function executeJoin({ fromDb: fromRef, joins, where, select, limit }) {
  const allDbs     = db.get('databases').value();
  const allRecords = db.get('records').value();

  // Resolve source database by id or name
  const srcDb = allDbs.find(d => d.id === fromRef || d.name === fromRef);
  if (!srcDb) throw new Error(`Database "${fromRef}" not found`);

  // Load + flatten source records
  let rows = allRecords
    .filter(r => r.databaseId === srcDb.id)
    .map(flattenRecord);

  // WHERE filters (simple equality on source fields)
  if (where && typeof where === 'object') {
    for (const [k, v] of Object.entries(where)) {
      if (v === '' || v === null || v === undefined) continue;
      // Support basic operators: key, !key, key>, key<
      if (k.endsWith('>')) {
        const f = k.slice(0, -1);
        rows = rows.filter(r => Number(r[f]) > Number(v));
      } else if (k.endsWith('<')) {
        const f = k.slice(0, -1);
        rows = rows.filter(r => Number(r[f]) < Number(v));
      } else if (k.startsWith('!')) {
        const f = k.slice(1);
        rows = rows.filter(r => String(r[f]) !== String(v));
      } else {
        rows = rows.filter(r => String(r[k]).toLowerCase() === String(v).toLowerCase());
      }
    }
  }

  // Process each join spec
  for (const join of (joins || [])) {
    // Resolve join via saved relationship ID or inline spec
    let fromField, toDbRef, toField, alias, joinType;

    if (join.relationshipId) {
      const saved = db.get('relationships').find({ id: join.relationshipId }).value();
      if (!saved) continue;
      fromField = saved.fromField;
      toDbRef   = saved.toDb;
      toField   = saved.toField;
      alias     = join.as || allDbs.find(d => d.id === saved.toDb)?.name || 'joined';
      joinType  = saved.type;
    } else {
      fromField = join.fromField;
      toDbRef   = join.toDb;
      toField   = join.toField;
      alias     = join.as || toDbRef;
      joinType  = join.type || 'one-to-many';
    }

    const toDB = allDbs.find(d => d.id === toDbRef || d.name === toDbRef);
    if (!toDB) continue;

    const toRecords = allRecords
      .filter(r => r.databaseId === toDB.id)
      .map(flattenRecord);

    // Build an index on the target field for O(1) lookup
    const idx = new Map();
    for (const tr of toRecords) {
      const key = String(tr[toField] ?? '');
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(tr);
    }

    rows = rows.map(row => {
      const key     = String(row[fromField] ?? '');
      const matches = idx.get(key) || [];
      return {
        ...row,
        [alias]: joinType === 'one-to-one' ? (matches[0] || null) : matches,
      };
    });
  }

  // SELECT projection
  if (select && Array.isArray(select) && select.length > 0) {
    rows = rows.map(row => {
      const out = {};
      for (const f of select) {
        if (f.includes('.')) {
          const [ns, field] = f.split('.', 2);
          if (row[ns] && !Array.isArray(row[ns])) {
            out[f] = row[ns][field] ?? null;
          } else if (Array.isArray(row[ns])) {
            out[f] = row[ns].map(r => r[field] ?? null);
          }
        } else {
          out[f] = row[f] ?? null;
        }
      }
      return out;
    });
  }

  const lim      = Math.min(Math.max(1, Number(limit) || 500), 2000);
  const truncated = rows.length > lim;
  return {
    rows:     rows.slice(0, lim),
    rowCount: rows.length,
    truncated,
    sourceDb: srcDb.name,
  };
}

// POST /api/relationships/join — execute a dynamic join
app.post('/api/relationships/join', requireAuth, (req, res) => {
  const start = Date.now();
  try {
    const result  = executeJoin(req.body);
    result.elapsed = Date.now() - start;
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
// GET /api/dashboard — aggregated stats for the admin dashboard
app.get('/api/dashboard', requireAuth, (req, res) => {
  const user      = getAuthUser(req);
  const isAdmin   = user.role === 'admin';

  const databases = db.get('databases').value();
  const records   = db.get('records').value();

  // Top 5 databases by record count
  const topDatabases = databases
    .map(d => ({ id: d.id, name: d.name, recordCount: records.filter(r => r.databaseId === d.id).length }))
    .sort((a, b) => b.recordCount - a.recordCount)
    .slice(0, 5);

  // Recent activity (last 8 entries)
  const recentActivity = db.get('activityLog').value().slice(-8).reverse();

  // Threat summary (admin only to avoid leaking threat data to members)
  let threatStats = null;
  if (isAdmin) {
    const now = Date.now();
    const blocked = [..._blockedIPs.entries()].filter(([, exp]) => exp > now).length;
    threatStats = { total: _threatLog.length, blocked };
  }

  const stats = {
    databases:     databases.length,
    records:       records.length,
    users:         isAdmin ? db.get('users').value().length : null,
    apiKeys:       db.get('apiKeys').value().filter(k => isAdmin || k.userId === user.id).length,
    webhooks:      isAdmin ? db.get('webhooks').value().length : null,
    credentials:   isAdmin ? db.get('credentials').value().length : null,
    relationships: db.get('relationships').value().length,
  };

  res.json({ stats, topDatabases, recentActivity, threatStats });
});

// ─── Database management ─────────────────────────────────────────────────────
app.get('/api/databases', requireAuth, (req, res) => {
  const dbs    = db.get('databases').value();
  const result = dbs.map(d => ({
    ...d,
    recordCount: db.get('records').filter({ databaseId: d.id }).value().length,
  }));
  res.json(result);
});

app.post('/api/databases', requireMember, (req, res) => {
  const { name, fields } = req.body;
  if (!name || !Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'name and at least one field required' });
  }
  for (const f of fields) {
    if (!f.name || !['string', 'number', 'boolean', 'date'].includes(f.type)) {
      return res.status(400).json({
        error: `Invalid field: ${JSON.stringify(f)}. Type must be string|number|boolean|date`,
      });
    }
  }
  if (db.get('databases').find({ name }).value()) {
    return res.status(409).json({ error: 'Database name already exists' });
  }
  const user  = getAuthUser(req);
  const newDb = {
    id: uuidv4(), name, fields,
    createdBy: user.username,
    createdAt: new Date().toISOString(),
  };
  db.get('databases').push(newDb).write();
  logActivity('create_db', user.username, name, `Created database "${name}" with ${fields.length} field(s)`);
  fireWebhooks('database.created', { database: newDb.name, databaseId: newDb.id, fields: newDb.fields, triggeredBy: user.username });
  broadcastWS('database_created', newDb.name, newDb.id, { fields: newDb.fields, createdBy: user.username });
  res.status(201).json(newDb);
});

app.get('/api/databases/:id', requireAuth, (req, res) => {
  const database = db.get('databases').find({ id: req.params.id }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });
  res.json(database);
});

app.put('/api/databases/:id', requireAdmin, (req, res) => {
  const database = db.get('databases').find({ id: req.params.id }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  const { name, fields } = req.body;
  const updates = {};

  if (name) {
    const conflict = db.get('databases').find({ name }).value();
    if (conflict && conflict.id !== req.params.id) {
      return res.status(409).json({ error: 'Database name already exists' });
    }
    updates.name = name;
  }
  if (fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'fields must be a non-empty array' });
    }
    for (const f of fields) {
      if (!f.name || !['string', 'number', 'boolean', 'date'].includes(f.type)) {
        return res.status(400).json({ error: `Invalid field: ${JSON.stringify(f)}` });
      }
    }
    updates.fields = fields;
  }

  const user = getAuthUser(req);
  db.get('databases').find({ id: req.params.id }).assign(updates).write();
  logActivity('update_db', user.username, database.name, 'Updated database schema');
  res.json(db.get('databases').find({ id: req.params.id }).value());
});

app.delete('/api/databases/:id', requireAdmin, (req, res) => {
  const dbToDelete = db.get('databases').find({ id: req.params.id }).value();
  if (!dbToDelete) return res.status(404).json({ error: 'Database not found' });

  const recCount = db.get('records').filter({ databaseId: req.params.id }).value().length;
  const user     = getAuthUser(req);
  db.get('databases').remove({ id: req.params.id }).write();
  db.get('records').remove({ databaseId: req.params.id }).write();
  logActivity('delete_db', user.username, dbToDelete.name, `Deleted database and ${recCount} record(s)`);
  fireWebhooks('database.deleted', { database: dbToDelete.name, databaseId: dbToDelete.id, triggeredBy: user.username });
  broadcastWS('database_deleted', dbToDelete.name, dbToDelete.id, { deletedBy: user.username });
  res.json({ message: 'Database and all its records deleted' });
});

// ─── Record management ────────────────────────────────────────────────────────
app.get('/api/databases/:dbId/records', requireAuth, (req, res) => {
  if (!db.get('databases').find({ id: req.params.dbId }).value()) {
    return res.status(404).json({ error: 'Database not found' });
  }
  res.json(db.get('records').filter({ databaseId: req.params.dbId }).value());
});

app.post('/api/databases/:dbId/records', requireMember, (req, res) => {
  const database = db.get('databases').find({ id: req.params.dbId }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  const validated = validateRecordData(req.body.data || {}, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const user      = getAuthUser(req);
  const newRecord = {
    id: uuidv4(),
    databaseId: req.params.dbId,
    data:       validated.data,
    createdBy:  user.username,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
  db.get('records').push(newRecord).write();
  logActivity('create_record', user.username, database.name, `Added record to "${database.name}"`);
  fireWebhooks('record.created', { database: database.name, databaseId: database.id, record: { id: newRecord.id, ...newRecord.data }, triggeredBy: user.username });
  broadcastWS('record_added', database.name, database.id, { id: newRecord.id, ...newRecord.data, createdBy: user.username });
  res.status(201).json(newRecord);
});

app.put('/api/databases/:dbId/records/:id', requireMember, (req, res) => {
  const database = db.get('databases').find({ id: req.params.dbId }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  const record = db.get('records')
    .find({ id: req.params.id, databaseId: req.params.dbId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  const user = getAuthUser(req);
  if (user.role === 'member' && record.createdBy !== user.username) {
    return res.status(403).json({ error: 'You can only edit your own records' });
  }

  const validated = validateRecordData(req.body.data || {}, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.get('records').find({ id: req.params.id })
    .assign({ data: validated.data, updatedAt: new Date().toISOString() }).write();
  logActivity('update_record', user.username, database.name, `Updated record in "${database.name}"`);
  const updatedRec = db.get('records').find({ id: req.params.id }).value();
  fireWebhooks('record.updated', { database: database.name, databaseId: database.id, record: { id: updatedRec.id, ...updatedRec.data }, triggeredBy: user.username });
  broadcastWS('record_updated', database.name, database.id, { id: updatedRec.id, ...updatedRec.data, updatedBy: user.username });
  res.json(updatedRec);
});

app.delete('/api/databases/:dbId/records/:id', requireMember, (req, res) => {
  const record = db.get('records')
    .find({ id: req.params.id, databaseId: req.params.dbId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  const user = getAuthUser(req);
  if (user.role === 'member' && record.createdBy !== user.username) {
    return res.status(403).json({ error: 'You can only delete your own records' });
  }

  const recDb = db.get('databases').find({ id: req.params.dbId }).value();
  db.get('records').remove({ id: req.params.id }).write();
  logActivity('delete_record', user.username,
    recDb ? recDb.name : req.params.dbId,
    `Deleted record from "${recDb ? recDb.name : req.params.dbId}"`);
  fireWebhooks('record.deleted', { database: recDb?.name, databaseId: req.params.dbId, recordId: req.params.id, triggeredBy: user.username });
  broadcastWS('record_deleted', recDb?.name, req.params.dbId, { id: req.params.id, deletedBy: user.username });
  res.json({ message: 'Record deleted' });
});

// ─── Activity log (admin only) ────────────────────────────────────────────────
app.get('/api/activity', requireAdmin, (req, res) => {
  res.json(db.get('activityLog').value().slice().reverse().slice(0, 100));
});

// ─── Helper: validate record data against schema ──────────────────────────────
function validateRecordData(data, fields) {
  const result = {};
  for (const field of fields) {
    const val     = data[field.name];
    const isEmpty = val === undefined || val === null || val === '';

    if (isEmpty) {
      if (field.required) return { error: `"${field.name}" is required` };
      result[field.name] = null;
      continue;
    }

    if (field.type === 'number') {
      if (isNaN(Number(val))) return { error: `"${field.name}" must be a number` };
      const n = Number(val);
      if (field.min != null && n < Number(field.min))
        return { error: `"${field.name}" must be ≥ ${field.min}` };
      if (field.max != null && n > Number(field.max))
        return { error: `"${field.name}" must be ≤ ${field.max}` };
    }

    if (field.type === 'boolean' && !['true', 'false', true, false].includes(val)) {
      return { error: `"${field.name}" must be true or false` };
    }

    if (field.type === 'string') {
      const s = String(val);
      if (field.minLength != null && s.length < Number(field.minLength))
        return { error: `"${field.name}" must be at least ${field.minLength} characters` };
      if (field.maxLength != null && s.length > Number(field.maxLength))
        return { error: `"${field.name}" must be at most ${field.maxLength} characters` };
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(s))
            return { error: `"${field.name}" does not match the required pattern` };
        } catch (_) { /* invalid regex, skip */ }
      }
    }

    if (field.type === 'date') {
      const d = new Date(val);
      if (isNaN(d.getTime())) return { error: `"${field.name}" must be a valid date` };
      if (field.minDate && new Date(val) < new Date(field.minDate))
        return { error: `"${field.name}" must be on or after ${field.minDate}` };
      if (field.maxDate && new Date(val) > new Date(field.maxDate))
        return { error: `"${field.name}" must be on or before ${field.maxDate}` };
    }

    if (field.enumValues && Array.isArray(field.enumValues) && field.enumValues.length > 0) {
      const sv = String(val === true ? 'true' : val === false ? 'false' : val);
      if (!field.enumValues.includes(sv))
        return { error: `"${field.name}" must be one of: ${field.enumValues.join(', ')}` };
    }

    result[field.name] =
      field.type === 'number'  ? Number(val) :
      field.type === 'boolean' ? (val === 'true' || val === true) :
      String(val);
  }
  return { data: result };
}

// ─── Query engine ────────────────────────────────────────────────────────────

// ── Mini fluent query language parser ────────────────────────────────────────
// Supports: table.where(cond).select(cols).order(col,desc).limit(n).offset(n)
//           .count().avg(col).sum(col).min(col).max(col).group(col)
// Examples:
//   users.where(age > 25).limit(10)
//   orders.select(id, total).where(total > 100).order(total, desc).limit(20)
//   products.group(category).count().avg(price)

function extractUntilMatchingParen(str, start) {
  // start points at the opening '('
  let depth = 1;
  let inStr  = null;
  let i      = start + 1;
  while (i < str.length) {
    const ch = str[i];
    if (inStr) {
      if (ch === inStr && str[i - 1] !== '\\') inStr = null;
    } else if (ch === "'" || ch === '"') {
      inStr = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return { content: str.slice(start + 1, i), nextPos: i + 1 };
    }
    i++;
  }
  throw new Error('Unmatched parenthesis in query');
}

function parseFluentQuery(input) {
  let pos = 0;
  const str = input.trim();

  // Table name
  const nameMatch = str.match(/^(\w+)/);
  if (!nameMatch) throw new Error('Expected a table name at the start of the query');
  const tableName = nameMatch[1];
  pos = nameMatch[0].length;

  let selectCols  = null;
  const whereClauses = [];
  let orderBy     = null;
  let limitVal    = null;
  let offsetVal   = null;
  let groupBy     = null;
  const aggregates = [];

  while (pos < str.length) {
    // Skip optional whitespace
    while (pos < str.length && /\s/.test(str[pos])) pos++;
    if (pos >= str.length) break;

    if (str[pos] !== '.') throw new Error(`Unexpected character "${str[pos]}" at position ${pos}`);
    pos++; // skip '.'

    // Method name
    const mMatch = str.slice(pos).match(/^([a-zA-Z]+)/);
    if (!mMatch) throw new Error(`Expected method name at position ${pos}`);
    const method = mMatch[1].toLowerCase();
    pos += mMatch[1].length;

    // Opening paren
    while (pos < str.length && str[pos] === ' ') pos++;
    if (str[pos] !== '(') throw new Error(`Expected "(" after method "${method}"`);
    const { content: args, nextPos } = extractUntilMatchingParen(str, pos);
    pos = nextPos;
    const a = args.trim();

    switch (method) {
      case 'select':
        selectCols = a || '*';
        break;

      case 'where':
        if (!a) throw new Error('where() requires a condition');
        whereClauses.push(a);
        break;

      case 'limit': {
        const n = parseInt(a, 10);
        if (isNaN(n) || n < 0) throw new Error(`limit() expects a non-negative integer, got: "${a}"`);
        limitVal = n;
        break;
      }

      case 'offset': {
        const n = parseInt(a, 10);
        if (isNaN(n) || n < 0) throw new Error(`offset() expects a non-negative integer, got: "${a}"`);
        offsetVal = n;
        break;
      }

      case 'order':
      case 'orderby': {
        // order(col) | order(col, desc) | order(col, asc)
        const parts = a.split(/,\s*/);
        const col   = parts[0].trim();
        if (!col) throw new Error('order() requires a column name');
        const dir   = (parts[1] || 'asc').trim().toUpperCase();
        orderBy = `${col} ${dir === 'DESC' ? 'DESC' : 'ASC'}`;
        break;
      }

      case 'group':
      case 'groupby':
        if (!a) throw new Error('group() requires a column name');
        groupBy = a;
        break;

      case 'count': {
        const alias = a || 'count';
        aggregates.push(`COUNT(*) AS ${alias}`);
        break;
      }

      case 'avg':
        if (!a) throw new Error('avg() requires a column name');
        aggregates.push(`AVG(${a}) AS avg_${a}`);
        break;

      case 'sum':
        if (!a) throw new Error('sum() requires a column name');
        aggregates.push(`SUM(${a}) AS sum_${a}`);
        break;

      case 'min':
        if (!a) throw new Error('min() requires a column name');
        aggregates.push(`MIN(${a}) AS min_${a}`);
        break;

      case 'max':
        if (!a) throw new Error('max() requires a column name');
        aggregates.push(`MAX(${a}) AS max_${a}`);
        break;

      default:
        throw new Error(`Unknown method "${method}()". Supported: select, where, order, limit, offset, group, count, avg, sum, min, max`);
    }
  }

  // Build SELECT list
  let cols;
  if (aggregates.length) {
    const base = selectCols && selectCols !== '*' ? selectCols
      : groupBy ? groupBy
      : null;
    cols = base ? `${base}, ${aggregates.join(', ')}` : aggregates.join(', ');
  } else {
    cols = selectCols || '*';
  }

  let sql = `SELECT ${cols} FROM ${tableName}`;
  if (whereClauses.length) sql += ` WHERE ${whereClauses.join(' AND ')}`;
  if (groupBy)             sql += ` GROUP BY ${groupBy}`;
  if (orderBy)             sql += ` ORDER BY ${orderBy}`;
  if (limitVal !== null)   sql += ` LIMIT ${limitVal}`;
  if (offsetVal !== null)  sql += ` OFFSET ${offsetVal}`;

  return sql;
}

// Detect syntax: starts with SELECT/WITH/EXPLAIN → SQL, otherwise → fluent
function normalizeQuery(raw) {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();

  if (/^(SELECT|WITH|EXPLAIN)\b/i.test(stripped)) {
    return { sql: stripped, isFluent: false };
  }
  // Fluent: starts with a word (table name), optionally followed by .method(...)
  if (/^\w+(\s*\.|$)/.test(stripped)) {
    const sql = parseFluentQuery(stripped);
    return { sql, isFluent: true, translatedSql: sql };
  }
  // Fall through to SQL (alasql will produce a meaningful error)
  return { sql: stripped, isFluent: false };
}
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/query/schema', requireAuth, (req, res) => {
  const result = db.get('databases').value().map(d => ({
    name: d.name,
    recordCount: db.get('records').filter({ databaseId: d.id }).value().length,
    fields: [
      { name: 'id',        type: 'uuid'     },
      { name: 'createdBy', type: 'string'   },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' },
      ...d.fields.map(f => ({ name: f.name, type: f.type })),
    ],
  }));
  res.json(result);
});

// Simple mutex so concurrent requests don't corrupt alasql's global table state
let _queryLock = false;

app.post('/api/query', requireAuth, (req, res) => {
  const raw = req.body.sql || req.body.query || '';
  if (!raw.trim()) {
    return res.status(400).json({ error: 'A query is required (SQL or fluent syntax)' });
  }

  // Normalize: auto-detect and translate fluent → SQL if needed
  let normalised;
  try {
    normalised = normalizeQuery(raw);
  } catch (parseErr) {
    return res.status(400).json({ error: parseErr.message });
  }

  const { sql, isFluent, translatedSql } = normalised;

  if (!/^SELECT\b/i.test(sql)) {
    return res.status(400).json({ error: 'Only SELECT queries are supported' });
  }

  if (_queryLock) {
    return res.status(429).json({ error: 'Another query is already running — please try again' });
  }
  _queryLock = true;

  const databases  = db.get('databases').value();
  const allRecords = db.get('records').value();
  const start      = Date.now();

  try {
    // Register each FluxDB database as an alasql in-memory table
    databases.forEach(d => {
      alasql.tables[d.name] = {
        data: allRecords
          .filter(r => r.databaseId === d.id)
          .map(r => ({
            id:        r.id,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            ...r.data,
          })),
      };
    });

    const results = alasql(sql);
    const elapsed = Date.now() - start;

    if (!Array.isArray(results)) {
      return res.json({ columns: [], rows: [], rowCount: 0, elapsed, isFluent, translatedSql });
    }

    const MAX_ROWS = 2000;
    const truncated = results.length > MAX_ROWS;
    const rows      = truncated ? results.slice(0, MAX_ROWS) : results;
    const columns   = rows.length > 0 ? Object.keys(rows[0]) : [];

    res.json({ columns, rows, rowCount: results.length, elapsed, truncated, isFluent, translatedSql });

  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    databases.forEach(d => delete alasql.tables[d.name]);
    _queryLock = false;
  }
});

// ─── Webhook management routes ───────────────────────────────────────────────
app.get('/api/webhooks', requireMember, (req, res) => {
  const user  = getAuthUser(req);
  const hooks = user.role === 'admin'
    ? db.get('webhooks').value()
    : db.get('webhooks').filter({ createdBy: user.username }).value();
  res.json(hooks.map(h => ({
    ...h,
    secret:       h.secret ? '••••••••' : null,
    lastDelivery: (_deliveryLog.get(h.id) || [])[0] || null,
  })));
});

app.post('/api/webhooks', requireMember, (req, res) => {
  const { event, url, name, secret } = req.body;
  if (!event || !WEBHOOK_EVENTS.includes(event))
    return res.status(400).json({ error: `event must be one of: ${WEBHOOK_EVENTS.join(', ')}` });
  if (!url || !isValidWebhookUrl(url))
    return res.status(400).json({ error: 'url must be a valid http/https URL' });

  const user = getAuthUser(req);
  if (db.get('webhooks').filter({ createdBy: user.username }).value().length >= 20)
    return res.status(400).json({ error: 'Maximum 20 webhooks per user' });

  const hook = {
    id:        uuidv4(),
    event,
    url,
    name:      (name  || '').trim().slice(0, 60)  || null,
    secret:    (secret || '').trim().slice(0, 128) || null,
    createdBy: user.username,
    createdAt: new Date().toISOString(),
    active:    true,
  };
  db.get('webhooks').push(hook).write();
  logActivity('create_webhook', user.username, event, `Subscribed to "${event}" → ${url}`);
  res.status(201).json({ ...hook, secret: hook.secret ? '••••••••' : null });
});

app.put('/api/webhooks/:id', requireMember, (req, res) => {
  const hook = db.get('webhooks').find({ id: req.params.id }).value();
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  const user = getAuthUser(req);
  if (user.role !== 'admin' && hook.createdBy !== user.username)
    return res.status(403).json({ error: 'Access denied' });

  const updates = {};
  const { event, url, name, secret, active } = req.body;
  if (event !== undefined) {
    if (!WEBHOOK_EVENTS.includes(event)) return res.status(400).json({ error: 'Invalid event' });
    updates.event = event;
  }
  if (url !== undefined) {
    if (!isValidWebhookUrl(url)) return res.status(400).json({ error: 'Invalid URL' });
    updates.url = url;
  }
  if (name   !== undefined) updates.name   = (name   || '').trim().slice(0, 60)  || null;
  if (secret !== undefined) updates.secret = (secret || '').trim().slice(0, 128) || null;
  if (active !== undefined) updates.active = Boolean(active);

  db.get('webhooks').find({ id: req.params.id }).assign(updates).write();
  const updated = db.get('webhooks').find({ id: req.params.id }).value();
  res.json({ ...updated, secret: updated.secret ? '••••••••' : null });
});

app.delete('/api/webhooks/:id', requireMember, (req, res) => {
  const hook = db.get('webhooks').find({ id: req.params.id }).value();
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  const user = getAuthUser(req);
  if (user.role !== 'admin' && hook.createdBy !== user.username)
    return res.status(403).json({ error: 'Access denied' });
  db.get('webhooks').remove({ id: req.params.id }).write();
  _deliveryLog.delete(req.params.id);
  logActivity('delete_webhook', user.username, hook.event, `Unsubscribed from "${hook.event}"`);
  res.json({ message: 'Webhook deleted' });
});

app.get('/api/webhooks/:id/deliveries', requireMember, (req, res) => {
  const hook = db.get('webhooks').find({ id: req.params.id }).value();
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  const user = getAuthUser(req);
  if (user.role !== 'admin' && hook.createdBy !== user.username)
    return res.status(403).json({ error: 'Access denied' });
  res.json(_deliveryLog.get(hook.id) || []);
});

app.post('/api/webhooks/:id/test', requireMember, (req, res) => {
  const hook = db.get('webhooks').find({ id: req.params.id }).value();
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  const user = getAuthUser(req);
  if (user.role !== 'admin' && hook.createdBy !== user.username)
    return res.status(403).json({ error: 'Access denied' });
  deliverWebhook(hook, hook.event, {
    test:        true,
    database:    'TestDatabase',
    databaseId:  'test-id',
    record:      { id: 'test-record-id', example: 'Test value', count: 42 },
    triggeredBy: user.username,
  }).catch(() => {});
  res.json({ message: 'Test delivery triggered' });
});

// ─── Threat log endpoints (admin only) ────────────────────────────────────────
app.get('/api/threats', requireAdmin, (req, res) => {
  res.json([..._threatLog].reverse().slice(0, 200));
});

app.get('/api/threats/stats', requireAdmin, (req, res) => {
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const byType     = {};
  const bySeverity = {};
  let blocked = 0;
  for (const t of _threatLog) {
    byType[t.type]         = (byType[t.type]         || 0) + 1;
    bySeverity[t.severity] = (bySeverity[t.severity] || 0) + 1;
    if (t.blocked) blocked++;
  }
  res.json({
    total:        _threatLog.length,
    last24h:      _threatLog.filter(t => t.timestamp >= since24h).length,
    blocked,
    activeBlocks: _blockedIPs.size,
    byType,
    bySeverity,
  });
});

// DELETE /api/threats — clear threat log (admin)
app.delete('/api/threats', requireAdmin, (req, res) => {
  _threatLog.length = 0;
  res.json({ message: 'Threat log cleared' });
});

// ─── Automatic REST API Generator (/api/v1) ───────────────────────────────────

// Convert a database name to a URL-friendly slug
function toSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/v1 — list all auto-generated REST APIs
app.get('/api/v1', requireAuth, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const dbs  = db.get('databases').value();
  const apis = dbs.map(d => {
    const slug = toSlug(d.name);
    return {
      name:    d.name,
      slug,
      baseUrl: `${base}/api/v1/${slug}`,
      fields:  d.fields.map(f => ({ name: f.name, type: f.type, required: !!f.required })),
      recordCount: db.get('records').filter({ databaseId: d.id }).value().length,
      endpoints: [
        { method: 'GET',    path: `/api/v1/${slug}`,     description: 'List records (supports ?limit=, ?offset=, ?_sort=, ?_order=, and field filters)' },
        { method: 'GET',    path: `/api/v1/${slug}/:id`, description: 'Get single record by ID' },
        { method: 'POST',   path: `/api/v1/${slug}`,     description: 'Create a new record' },
        { method: 'PUT',    path: `/api/v1/${slug}/:id`, description: 'Update an existing record' },
        { method: 'DELETE', path: `/api/v1/${slug}/:id`, description: 'Delete a record' },
      ],
    };
  });
  res.json(apis);
});

// Middleware: resolve slug param to an actual database object
function resolveSlug(req, res, next) {
  const dbs   = db.get('databases').value();
  const found = dbs.find(d => toSlug(d.name) === req.params.slug);
  if (!found) return res.status(404).json({ error: `No database found for slug "${req.params.slug}"` });
  req._resolvedDb = found;
  next();
}

// Flat record shape returned by all /api/v1 endpoints
function flatRecord(r) {
  return { id: r.id, ...r.data, _meta: { createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt } };
}

// GET /api/v1/:slug — list records with optional filtering & pagination
app.get('/api/v1/:slug', requireAuth, resolveSlug, (req, res) => {
  const database = req._resolvedDb;
  let records    = db.get('records').filter({ databaseId: database.id }).value();

  // Field-level filters: ?fieldName=value
  const reserved = new Set(['limit', 'offset', '_sort', '_order']);
  for (const [key, value] of Object.entries(req.query)) {
    if (reserved.has(key)) continue;
    if (database.fields.some(f => f.name === key)) {
      records = records.filter(r => String(r.data[key] ?? '').toLowerCase() === String(value).toLowerCase());
    }
  }

  // Sorting: ?_sort=field&_order=asc|desc
  const { _sort, _order, limit, offset } = req.query;
  if (_sort) {
    const dir = (_order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    records = [...records].sort((a, b) => {
      const av = a.data[_sort] ?? a[_sort];
      const bv = b.data[_sort] ?? b[_sort];
      if (av == null) return dir;
      if (bv == null) return -dir;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  const total = records.length;
  const off   = Math.max(0, parseInt(offset) || 0);
  const lim   = Math.min(500, Math.max(1, parseInt(limit) || 100));
  const page  = records.slice(off, off + lim);

  res.json({ data: page.map(flatRecord), total, limit: lim, offset: off });
});

// GET /api/v1/:slug/:id — get single record
app.get('/api/v1/:slug/:id', requireAuth, resolveSlug, (req, res) => {
  const record = db.get('records')
    .find({ id: req.params.id, databaseId: req._resolvedDb.id }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json(flatRecord(record));
});

// POST /api/v1/:slug — create record
app.post('/api/v1/:slug', requireMember, resolveSlug, (req, res) => {
  const database  = req._resolvedDb;
  const validated = validateRecordData(req.body, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const user      = getAuthUser(req);
  const newRecord = {
    id:         uuidv4(),
    databaseId: database.id,
    data:       validated.data,
    createdBy:  user.username,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
  db.get('records').push(newRecord).write();
  logActivity('create_record', user.username, database.name, `Added record to "${database.name}" via REST API`);
  fireWebhooks('record.created', { database: database.name, databaseId: database.id, record: { id: newRecord.id, ...newRecord.data }, triggeredBy: user.username });
  broadcastWS('record_added', database.name, database.id, { id: newRecord.id, ...newRecord.data, createdBy: user.username });
  res.status(201).json(flatRecord(newRecord));
});

// PUT /api/v1/:slug/:id — update record
app.put('/api/v1/:slug/:id', requireMember, resolveSlug, (req, res) => {
  const database = req._resolvedDb;
  const record   = db.get('records')
    .find({ id: req.params.id, databaseId: database.id }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  const user = getAuthUser(req);
  if (user.role === 'member' && record.createdBy !== user.username) {
    return res.status(403).json({ error: 'You can only edit your own records' });
  }

  const validated = validateRecordData(req.body, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.get('records').find({ id: req.params.id })
    .assign({ data: validated.data, updatedAt: new Date().toISOString() }).write();
  logActivity('update_record', user.username, database.name, `Updated record in "${database.name}" via REST API`);
  const v1Updated = db.get('records').find({ id: req.params.id }).value();
  fireWebhooks('record.updated', { database: database.name, databaseId: database.id, record: { id: v1Updated.id, ...v1Updated.data }, triggeredBy: user.username });
  broadcastWS('record_updated', database.name, database.id, { id: v1Updated.id, ...v1Updated.data, updatedBy: user.username });
  res.json(flatRecord(v1Updated));
});

// DELETE /api/v1/:slug/:id — delete record
app.delete('/api/v1/:slug/:id', requireMember, resolveSlug, (req, res) => {
  const database = req._resolvedDb;
  const record   = db.get('records')
    .find({ id: req.params.id, databaseId: database.id }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  const user = getAuthUser(req);
  if (user.role === 'member' && record.createdBy !== user.username) {
    return res.status(403).json({ error: 'You can only delete your own records' });
  }

  db.get('records').remove({ id: req.params.id }).write();
  logActivity('delete_record', user.username, database.name, `Deleted record from "${database.name}" via REST API`);
  fireWebhooks('record.deleted', { database: database.name, databaseId: database.id, recordId: req.params.id, triggeredBy: user.username });
  broadcastWS('record_deleted', database.name, database.id, { id: req.params.id, deletedBy: user.username });
  res.json({ message: 'Record deleted' });
});

// ─── Credentials Vault (admin only) ──────────────────────────────────────────

// GET /api/credentials — list all credentials (values masked)
app.get('/api/credentials', requireAdmin, (req, res) => {
  const list = db.get('credentials').value().map(c => ({
    ...c,
    value: '••••••••',   // never send plaintext in the list
  }));
  res.json(list);
});

// POST /api/credentials — create a new credential
app.post('/api/credentials', requireAdmin, (req, res) => {
  const { name, value, description } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Credential name is required' });
  }
  if (!value || typeof value !== 'string') {
    return res.status(400).json({ error: 'Credential value is required' });
  }
  if (db.get('credentials').find({ name: name.trim() }).value()) {
    return res.status(409).json({ error: `A credential named "${name.trim()}" already exists` });
  }
  const user = getAuthUser(req);
  const cred = {
    id:          uuidv4(),
    name:        name.trim(),
    value,
    description: (description || '').trim(),
    createdBy:   user.username,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  db.get('credentials').push(cred).write();
  logActivity('create_credential', user.username, cred.name, `Created credential "${cred.name}"`);
  res.status(201).json({ ...cred, value: '••••••••' });
});

// GET /api/credentials/:id/reveal — return the plaintext value (audit logged)
app.get('/api/credentials/:id/reveal', requireAdmin, (req, res) => {
  const cred = db.get('credentials').find({ id: req.params.id }).value();
  if (!cred) return res.status(404).json({ error: 'Credential not found' });
  const user = getAuthUser(req);
  logActivity('reveal_credential', user.username, cred.name, `Revealed credential "${cred.name}"`);
  res.json({ id: cred.id, value: cred.value });
});

// PUT /api/credentials/:id — update name / value / description
app.put('/api/credentials/:id', requireAdmin, (req, res) => {
  const cred = db.get('credentials').find({ id: req.params.id }).value();
  if (!cred) return res.status(404).json({ error: 'Credential not found' });

  const { name, value, description } = req.body;
  const updates = { updatedAt: new Date().toISOString() };

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
    const conflict = db.get('credentials').find({ name: trimmed }).value();
    if (conflict && conflict.id !== req.params.id) {
      return res.status(409).json({ error: `A credential named "${trimmed}" already exists` });
    }
    updates.name = trimmed;
  }
  if (value !== undefined) {
    if (!value) return res.status(400).json({ error: 'Value cannot be empty' });
    updates.value = value;
  }
  if (description !== undefined) updates.description = String(description).trim();

  db.get('credentials').find({ id: req.params.id }).assign(updates).write();
  const updated = db.get('credentials').find({ id: req.params.id }).value();
  const user = getAuthUser(req);
  logActivity('update_credential', user.username, updated.name, `Updated credential "${updated.name}"`);
  res.json({ ...updated, value: '••••••••' });
});

// DELETE /api/credentials/:id
app.delete('/api/credentials/:id', requireAdmin, (req, res) => {
  const cred = db.get('credentials').find({ id: req.params.id }).value();
  if (!cred) return res.status(404).json({ error: 'Credential not found' });
  const user = getAuthUser(req);
  db.get('credentials').remove({ id: req.params.id }).write();
  logActivity('delete_credential', user.username, cred.name, `Deleted credential "${cred.name}"`);
  res.json({ message: 'Credential deleted' });
});

// ─── Dataset Import ───────────────────────────────────────────────────────────
// POST /api/import — create a database + bulk-insert records from an uploaded dataset
app.post('/api/import', requireMember, (req, res) => {
  const { name, fields, rows } = req.body;

  // Validate name
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Database name is required' });
  }
  const trimmedName = name.trim();

  // Validate fields
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'At least one field is required' });
  }
  for (const f of fields) {
    if (!f.name || !['string', 'number', 'boolean', 'date'].includes(f.type)) {
      return res.status(400).json({
        error: `Invalid field: "${f.name}". Type must be string|number|boolean|date`,
      });
    }
  }

  // Validate rows
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows must be an array' });
  }
  if (rows.length > 5000) {
    return res.status(400).json({ error: 'Import limit is 5,000 rows' });
  }

  // Check name uniqueness
  if (db.get('databases').find({ name: trimmedName }).value()) {
    return res.status(409).json({ error: `Database "${trimmedName}" already exists` });
  }

  const user  = getAuthUser(req);
  const newDb = {
    id:        uuidv4(),
    name:      trimmedName,
    fields,
    createdBy: user.username,
    createdAt: new Date().toISOString(),
  };
  db.get('databases').push(newDb).write();

  // Bulk-insert records, coercing types
  const fieldMap = {};
  for (const f of fields) fieldMap[f.name] = f.type;

  let imported = 0;
  let skipped  = 0;
  const newRecords = [];

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) { skipped++; continue; }
    const data = {};
    for (const f of fields) {
      let val = row[f.name];
      if (val === undefined || val === null || val === '') {
        data[f.name] = null;
        continue;
      }
      if (f.type === 'number') {
        const n = Number(val);
        data[f.name] = isNaN(n) ? null : n;
      } else if (f.type === 'boolean') {
        data[f.name] = val === true || val === 'true' || val === '1' || val === 1;
      } else if (f.type === 'date') {
        data[f.name] = String(val);
      } else {
        data[f.name] = String(val);
      }
    }
    newRecords.push({
      id:         uuidv4(),
      databaseId: newDb.id,
      data,
      createdBy:  user.username,
      createdAt:  new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
    });
    imported++;
  }

  if (newRecords.length > 0) {
    const existing = db.get('records').value();
    db.set('records', [...existing, ...newRecords]).write();
  }

  logActivity('import_dataset', user.username, trimmedName,
    `Imported dataset "${trimmedName}" with ${fields.length} field(s) and ${imported} record(s)`);
  fireWebhooks('database.created', {
    database:    newDb.name,
    databaseId:  newDb.id,
    fields:      newDb.fields,
    triggeredBy: user.username,
  });

  res.status(201).json({ database: newDb, imported, skipped });
});

// ─── Backup helpers ───────────────────────────────────────────────────────────
function dateTag(d = new Date()) {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}_${mo}_${dy}`;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function writeBackup(tag) {
  const databases = db.get('databases').value();
  const records   = db.get('records').value();
  const written   = [];

  // Per-database files  e.g. backup/users_2026_03_14.json
  for (const d of databases) {
    const dbRecords = records.filter(r => r.databaseId === d.id);
    const filename  = `${slugify(d.name)}_${tag}.json`;
    const filepath  = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify({ database: d, records: dbRecords }, null, 2));
    written.push(filename);
  }

  // Full snapshot  e.g. backup/full_2026_03_14.json
  const fullFilename = `full_${tag}.json`;
  const fullFilepath = path.join(BACKUP_DIR, fullFilename);
  const snapshot = {
    version:     1,
    createdAt:   new Date().toISOString(),
    databases:   databases,
    records:     records,
    users:       db.get('users').value(),
    apiKeys:     db.get('apiKeys').value(),
    webhooks:    db.get('webhooks').value(),
    credentials: db.get('credentials').value(),
    activityLog: db.get('activityLog').value(),
  };
  fs.writeFileSync(fullFilepath, JSON.stringify(snapshot, null, 2));
  written.push(fullFilename);

  return written;
}

// ─── Backup routes ────────────────────────────────────────────────────────────

// POST /api/backup  — create a backup now (admin only)
app.post('/api/backup', requireAdmin, (req, res) => {
  const user = getAuthUser(req);
  try {
    const tag   = dateTag();
    const files = writeBackup(tag);
    logActivity('backup_created', user.username, 'backup', `${files.length} file(s) written`);
    res.json({ message: 'Backup created', files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backups  — list all backup files (admin only)
app.get('/api/backups', requireAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backup/:filename  — download a specific backup file (admin only)
app.get('/api/backup/:filename', requireAdmin, (req, res) => {
  const safe = path.basename(req.params.filename);
  if (!safe.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
  const filepath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });
  res.download(filepath, safe);
});

// DELETE /api/backup/:filename  — delete a specific backup file (admin only)
app.delete('/api/backup/:filename', requireAdmin, (req, res) => {
  const user = getAuthUser(req);
  const safe = path.basename(req.params.filename);
  if (!safe.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
  const filepath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });
  fs.unlinkSync(filepath);
  logActivity('backup_deleted', user.username, safe, '');
  res.json({ message: 'Backup deleted' });
});

// POST /api/restore  — restore from an existing backup file (admin only)
app.post('/api/restore', requireAdmin, (req, res) => {
  const user = getAuthUser(req);
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const safe = path.basename(filename);
  if (!safe.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
  const filepath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });

  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse backup file' });
  }

  // Full snapshot restore (contains "version" key)
  if (snap.version) {
    if (snap.databases)   db.set('databases',   snap.databases).write();
    if (snap.records)     db.set('records',     snap.records).write();
    if (snap.users)       db.set('users',       snap.users).write();
    if (snap.apiKeys)     db.set('apiKeys',     snap.apiKeys).write();
    if (snap.webhooks)    db.set('webhooks',    snap.webhooks).write();
    if (snap.credentials) db.set('credentials', snap.credentials).write();
    logActivity('restore_full', user.username, safe,
      `${(snap.databases||[]).length} db(s), ${(snap.records||[]).length} record(s)`);
    return res.json({
      message: 'Full restore complete',
      databases: (snap.databases || []).length,
      records:   (snap.records   || []).length,
    });
  }

  // Per-database file restore (contains "database" + "records" keys)
  if (snap.database && Array.isArray(snap.records)) {
    const existing = db.get('databases').find({ id: snap.database.id }).value();
    if (existing) {
      db.get('databases').find({ id: snap.database.id }).assign(snap.database).write();
    } else {
      db.get('databases').push(snap.database).write();
    }
    // Replace records for this database
    const others = db.get('records').filter(r => r.databaseId !== snap.database.id).value();
    db.set('records', [...others, ...snap.records]).write();
    logActivity('restore_db', user.username, snap.database.name,
      `${snap.records.length} record(s) restored`);
    return res.json({
      message: `Restored database "${snap.database.name}"`,
      records: snap.records.length,
    });
  }

  res.status(400).json({ error: 'Unrecognised backup format' });
});

// ─── Scheduled auto-backup (every 24 hours) ───────────────────────────────────
setInterval(() => {
  try {
    const tag   = dateTag();
    const files = writeBackup(tag);
    console.log(`[AutoBackup] ${new Date().toISOString()} — ${files.length} file(s) written`);
    logActivity('backup_auto', 'system', 'backup', `${files.length} file(s)`);
  } catch (err) {
    console.error('[AutoBackup] Error:', err.message);
  }
}, 24 * 60 * 60 * 1000).unref();

// ─── Serve SPA ────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ─── Share links ──────────────────────────────────────────────────────────────
// Permissions: view (read-only) | edit (add + edit records) | admin (full access)

// Generate a share link for a database
app.post('/api/databases/:id/share', requireMember, (req, res) => {
  const database = db.get('databases').find({ id: req.params.id }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  const { permission = 'view', label = '', expiresIn } = req.body;
  if (!['view', 'edit', 'admin'].includes(permission)) {
    return res.status(400).json({ error: 'permission must be view | edit | admin' });
  }

  const user = getAuthUser(req);
  // Only admins can generate admin-permission links
  if (permission === 'admin' && user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can create admin-level share links' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const link = {
    id: uuidv4(),
    token,
    databaseId: req.params.id,
    permission,
    label: String(label).slice(0, 80),
    createdBy: user.username,
    createdAt: new Date().toISOString(),
    expiresAt: expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null,
    accessCount: 0,
  };
  db.get('shareLinks').push(link).write();
  logActivity('create_share', user.username, database.name, `Created ${permission} share link for "${database.name}"`);
  res.status(201).json({ ...link, shareUrl: `/share/${token}` });
});

// List all share links for a database
app.get('/api/databases/:id/shares', requireMember, (req, res) => {
  const database = db.get('databases').find({ id: req.params.id }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  const links = db.get('shareLinks').filter({ databaseId: req.params.id }).value()
    .map(l => ({ ...l, shareUrl: `/share/${l.token}` }));
  res.json(links);
});

// Revoke a share link
app.delete('/api/shares/:token', requireMember, (req, res) => {
  const link = db.get('shareLinks').find({ token: req.params.token }).value();
  if (!link) return res.status(404).json({ error: 'Share link not found' });

  const user = getAuthUser(req);
  if (user.role !== 'admin' && link.createdBy !== user.username) {
    return res.status(403).json({ error: 'You can only revoke your own share links' });
  }
  db.get('shareLinks').remove({ token: req.params.token }).write();
  res.json({ message: 'Share link revoked' });
});

// ─── Public shared-database access (no auth required) ─────────────────────────
function resolveShareLink(token) {
  const link = db.get('shareLinks').find({ token }).value();
  if (!link) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
  return link;
}

// Serve the public share viewer page
app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// Get shared database metadata + records
app.get('/api/shared/:token', (req, res) => {
  const link = resolveShareLink(req.params.token);
  if (!link) return res.status(404).json({ error: 'Share link not found or expired' });

  const database = db.get('databases').find({ id: link.databaseId }).value();
  if (!database) return res.status(404).json({ error: 'Database no longer exists' });

  const records = db.get('records').filter({ databaseId: link.databaseId }).value();

  // Increment access count
  db.get('shareLinks').find({ token: req.params.token })
    .assign({ accessCount: link.accessCount + 1 }).write();

  res.json({
    database,
    records,
    permission: link.permission,
    label: link.label,
    createdBy: link.createdBy,
    expiresAt: link.expiresAt,
  });
});

// Add a record via share link (edit or admin permission required)
app.post('/api/shared/:token/records', (req, res) => {
  const link = resolveShareLink(req.params.token);
  if (!link) return res.status(404).json({ error: 'Share link not found or expired' });
  if (link.permission === 'view') return res.status(403).json({ error: 'This link is read-only' });

  const database = db.get('databases').find({ id: link.databaseId }).value();
  if (!database) return res.status(404).json({ error: 'Database no longer exists' });

  const validated = validateRecordData(req.body.data || {}, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const newRecord = {
    id: uuidv4(),
    databaseId: link.databaseId,
    data: validated.data,
    createdBy: `shared:${link.token.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.get('records').push(newRecord).write();
  fireWebhooks('record.created', { database: database.name, databaseId: database.id, record: { id: newRecord.id, ...newRecord.data }, triggeredBy: 'share_link' });
  broadcastWS('record_added', database.name, database.id, { id: newRecord.id, ...newRecord.data });
  res.status(201).json(newRecord);
});

// Edit a record via share link (edit or admin permission required)
app.put('/api/shared/:token/records/:id', (req, res) => {
  const link = resolveShareLink(req.params.token);
  if (!link) return res.status(404).json({ error: 'Share link not found or expired' });
  if (link.permission === 'view') return res.status(403).json({ error: 'This link is read-only' });

  const database = db.get('databases').find({ id: link.databaseId }).value();
  if (!database) return res.status(404).json({ error: 'Database no longer exists' });

  const record = db.get('records').find({ id: req.params.id, databaseId: link.databaseId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  const validated = validateRecordData(req.body.data || {}, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.get('records').find({ id: req.params.id })
    .assign({ data: validated.data, updatedAt: new Date().toISOString() }).write();
  const updated = db.get('records').find({ id: req.params.id }).value();
  broadcastWS('record_updated', database.name, database.id, { id: updated.id, ...updated.data });
  res.json(updated);
});

// Delete a record via share link (admin permission only)
app.delete('/api/shared/:token/records/:id', (req, res) => {
  const link = resolveShareLink(req.params.token);
  if (!link) return res.status(404).json({ error: 'Share link not found or expired' });
  if (link.permission !== 'admin') return res.status(403).json({ error: 'Admin permission required to delete records' });

  const database = db.get('databases').find({ id: link.databaseId }).value();
  const record = db.get('records').find({ id: req.params.id, databaseId: link.databaseId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  db.get('records').remove({ id: req.params.id }).write();
  if (database) broadcastWS('record_deleted', database.name, link.databaseId, { id: req.params.id });
  res.json({ message: 'Record deleted' });
});

app.get('/{*path}', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips    = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// Wrap Express in a plain HTTP server so we can share the port with WebSockets
const server = http.createServer(app);

// ─── WebSocket server (same port, path /ws) ───────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Authenticate via one-time stream token passed as ?token=<tok>
  const url   = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const meta  = _streamTokens.get(token);

  if (!meta || meta.expires < Date.now()) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  _streamTokens.delete(token); // one-time use

  const client = {
    ws,
    user:          { username: meta.username, role: meta.role },
    subscriptions: new Set(),
    connectedAt:   new Date().toISOString(),
  };
  wsClients.add(client);
  console.log(`[WS] ${meta.username} connected (${meta.role})`);

  ws.send(JSON.stringify({
    type: 'connected',
    message: `Welcome ${meta.username}! Send {"type":"subscribe","databases":["*"]} to start.`,
    timestamp: new Date().toISOString(),
  }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      return;
    }

    if (msg.type === 'subscribe') {
      const dbs = Array.isArray(msg.databases) ? msg.databases : ['*'];
      dbs.forEach(d => client.subscriptions.add(d));
      ws.send(JSON.stringify({
        type: 'subscribed',
        databases: [...client.subscriptions],
        timestamp: new Date().toISOString(),
      }));
      console.log(`[WS] ${meta.username} subscribed to: ${dbs.join(', ')}`);
      return;
    }

    if (msg.type === 'unsubscribe') {
      const dbs = Array.isArray(msg.databases) ? msg.databases : [];
      dbs.forEach(d => client.subscriptions.delete(d));
      ws.send(JSON.stringify({
        type: 'unsubscribed',
        databases: dbs,
        remaining: [...client.subscriptions],
        timestamp: new Date().toISOString(),
      }));
      return;
    }
  });

  ws.on('close', () => {
    wsClients.delete(client);
    console.log(`[WS] ${meta.username} disconnected`);
  });

  ws.on('error', () => wsClients.delete(client));
});

server.listen(PORT, HOST, () => {
  const ips = getLocalIPs();
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║      Dynamic Database Creator  ✓  RUNNING  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  Local:    http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network:  http://${ip}:${PORT}`));
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
  console.log('\n  Admin  →  admin / admin123');
  console.log('  Guest  →  guest / guest123\n');
});
