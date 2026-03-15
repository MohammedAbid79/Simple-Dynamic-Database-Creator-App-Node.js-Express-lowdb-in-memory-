'use strict';

const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const os         = require('os');
const swaggerUi  = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const alasql     = require('alasql');

// ─── In-Memory lowdb setup ────────────────────────────────────────────────────
const low    = require('lowdb');
const Memory = require('lowdb/adapters/Memory');

const db = low(new Memory());

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

  req._apiUser = { id: user.id, username: user.username, role: user.role };
  next();
}

function requireAdmin(req, res, next) {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// admin or member — guests are blocked
function requireMember(req, res, next) {
  const user = getAuthUser(req);
  if (!user || user.role === 'guest') {
    return res.status(403).json({ error: 'Account required' });
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
      keyPreview: k.key.slice(0, 14) + '…',
      createdAt:  k.createdAt,
      lastUsed:   k.lastUsed,
    }))
    .value();
  res.json(keys);
});

app.post('/api/keys', requireMember, (req, res) => {
  const user = getAuthUser(req);
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }
  const existing = db.get('apiKeys').filter({ userId: user.id }).value();
  if (existing.length >= 5) {
    return res.status(400).json({ error: 'Maximum 5 API keys per user' });
  }
  const key    = 'dyndb_' + crypto.randomBytes(24).toString('hex');
  const newKey = {
    id:        uuidv4(),
    key,
    name:      name.trim(),
    userId:    user.id,
    createdAt: new Date().toISOString(),
    lastUsed:  null,
  };
  db.get('apiKeys').push(newKey).write();
  logActivity('create_key', user.username, newKey.name, `Created API key "${newKey.name}"`);
  // Return full key only on creation — it is never shown again
  res.status(201).json({ id: newKey.id, name: newKey.name, key, createdAt: newKey.createdAt });
});

app.delete('/api/keys/:id', requireMember, (req, res) => {
  const user   = getAuthUser(req);
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) return res.status(404).json({ error: 'API key not found' });
  if (apiKey.userId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: "Cannot revoke another user's API key" });
  }
  db.get('apiKeys').remove({ id: req.params.id }).write();
  logActivity('delete_key', user.username, apiKey.name, `Revoked API key "${apiKey.name}"`);
  res.json({ message: 'API key revoked' });
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
// Returns table/field schema for the query editor sidebar
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
  const { sql } = req.body;
  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Strip comments then check the first keyword
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();
  if (!/^SELECT\b/i.test(stripped)) {
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
      return res.json({ columns: [], rows: [], rowCount: 0, elapsed });
    }

    const MAX_ROWS = 2000;
    const truncated = results.length > MAX_ROWS;
    const rows      = truncated ? results.slice(0, MAX_ROWS) : results;
    const columns   = rows.length > 0 ? Object.keys(rows[0]) : [];

    res.json({ columns, rows, rowCount: results.length, elapsed, truncated });

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
  res.json({ message: 'Record deleted' });
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

// ─── Serve SPA ────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
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

app.listen(PORT, HOST, () => {
  const ips = getLocalIPs();
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║      Dynamic Database Creator  ✓  RUNNING  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  Local:    http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network:  http://${ip}:${PORT}`));
  console.log('\n  Admin  →  admin / admin123');
  console.log('  Guest  →  guest / guest123\n');
});
