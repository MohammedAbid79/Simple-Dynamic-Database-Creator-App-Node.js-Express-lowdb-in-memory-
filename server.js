'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const os      = require('os');

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

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Self-hosted fonts (no internet required)
app.use('/fonts/inter', express.static(
  path.join(__dirname, 'node_modules/@fontsource/inter')
));
app.use('/fonts/plus-jakarta-sans', express.static(
  path.join(__dirname, 'node_modules/@fontsource-variable/plus-jakarta-sans')
));

app.use(session({
  secret: 'dyndb-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 },
}));

// Apply general rate limit to all /api routes
app.use('/api', apiLimiter);

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
  res.json(db.get('records').find({ id: req.params.id }).value());
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
