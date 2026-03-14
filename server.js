'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// ─── In-Memory lowdb setup ────────────────────────────────────────────────────
const low = require('lowdb');
const Memory = require('lowdb/adapters/Memory');

const db = low(new Memory());

// Seed default data
db.defaults({
  users: [
    {
      id: uuidv4(),
      username: 'admin',
      password: bcrypt.hashSync('admin123', 10),
      role: 'admin',
    },
    {
      id: uuidv4(),
      username: 'guest',
      password: bcrypt.hashSync('guest123', 10),
      role: 'guest',
    },
  ],
  databases: [],     // { id, name, createdBy, createdAt, fields: [] }
  records: [],       // { id, databaseId, data: {}, createdBy, createdAt, updatedAt }
  activityLog: [],   // { id, action, user, target, detail, timestamp }
}).write();

// ─── Activity log helper ──────────────────────────────────────────────────────
function logActivity(action, user, target, detail) {
  db.get('activityLog').push({
    id: uuidv4(),
    action,
    user,
    target: target || '',
    detail: detail || '',
    timestamp: new Date().toISOString(),
  }).write();
  // Keep only the last 200 entries
  const all = db.get('activityLog').value();
  if (all.length > 200) {
    db.set('activityLog', all.slice(-200)).write();
  }
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: 'dyndb-secret-key-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }, // 1 hour
  })
);

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─── Auth routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
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
  res.json(req.session.user);
});

// ─── User management (admin only) ────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.get('users').map(u => ({ id: u.id, username: u.username, role: u.role })).value();
  res.json(users);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['admin', 'guest'].includes(role)) {
    return res.status(400).json({ error: 'username, password, and role (admin|guest) required' });
  }
  if (db.get('users').find({ username }).value()) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const newUser = {
    id: uuidv4(),
    username,
    password: bcrypt.hashSync(password, 10),
    role,
  };
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
  if (role && ['admin', 'guest'].includes(role)) updates.role = role;
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

// ─── Database management ─────────────────────────────────────────────────────
app.get('/api/databases', requireAuth, (req, res) => {
  const dbs = db.get('databases').value();
  const result = dbs.map(d => ({
    ...d,
    recordCount: db.get('records').filter({ databaseId: d.id }).value().length,
  }));
  res.json(result);
});

app.post('/api/databases', requireAdmin, (req, res) => {
  const { name, fields } = req.body;
  if (!name || !Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'name and at least one field required' });
  }
  // Validate fields: [{ name, type }]
  for (const f of fields) {
    if (!f.name || !['string', 'number', 'boolean', 'date'].includes(f.type)) {
      return res.status(400).json({ error: `Invalid field: ${JSON.stringify(f)}. Type must be string|number|boolean|date` });
    }
  }
  if (db.get('databases').find({ name }).value()) {
    return res.status(409).json({ error: 'Database name already exists' });
  }
  const newDb = {
    id: uuidv4(),
    name,
    fields,
    createdBy: req.session.user.username,
    createdAt: new Date().toISOString(),
  };
  db.get('databases').push(newDb).write();
  logActivity('create_db', req.session.user.username, name, `Created database "${name}" with ${fields.length} field(s)`);
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

  db.get('databases').find({ id: req.params.id }).assign(updates).write();
  logActivity('update_db', req.session.user.username, database.name, 'Updated database schema');
  res.json(db.get('databases').find({ id: req.params.id }).value());
});

app.delete('/api/databases/:id', requireAdmin, (req, res) => {
  if (!db.get('databases').find({ id: req.params.id }).value()) {
    return res.status(404).json({ error: 'Database not found' });
  }
  const dbToDelete = db.get('databases').find({ id: req.params.id }).value();
  const recCount = db.get('records').filter({ databaseId: req.params.id }).value().length;
  db.get('databases').remove({ id: req.params.id }).write();
  db.get('records').remove({ databaseId: req.params.id }).write();
  logActivity('delete_db', req.session.user.username, dbToDelete.name, `Deleted database and ${recCount} record(s)`);
  res.json({ message: 'Database and all its records deleted' });
});

// ─── Record management ────────────────────────────────────────────────────────
app.get('/api/databases/:dbId/records', requireAuth, (req, res) => {
  if (!db.get('databases').find({ id: req.params.dbId }).value()) {
    return res.status(404).json({ error: 'Database not found' });
  }
  const records = db.get('records').filter({ databaseId: req.params.dbId }).value();
  res.json(records);
});

app.post('/api/databases/:dbId/records', requireAuth, (req, res) => {
  const database = db.get('databases').find({ id: req.params.dbId }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  // Guests can add records
  const data = req.body.data || {};
  const validated = validateRecordData(data, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const newRecord = {
    id: uuidv4(),
    databaseId: req.params.dbId,
    data: validated.data,
    createdBy: req.session.user.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.get('records').push(newRecord).write();
  logActivity('create_record', req.session.user.username, database.name, `Added record to "${database.name}"`);
  res.status(201).json(newRecord);
});

app.put('/api/databases/:dbId/records/:id', requireAuth, (req, res) => {
  const database = db.get('databases').find({ id: req.params.dbId }).value();
  if (!database) return res.status(404).json({ error: 'Database not found' });

  const record = db.get('records').find({ id: req.params.id, databaseId: req.params.dbId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  // Guests can only edit their own records
  if (req.session.user.role === 'guest' && record.createdBy !== req.session.user.username) {
    return res.status(403).json({ error: 'Guests can only edit their own records' });
  }

  const data = req.body.data || {};
  const validated = validateRecordData(data, database.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.get('records').find({ id: req.params.id }).assign({ data: validated.data, updatedAt: new Date().toISOString() }).write();
  logActivity('update_record', req.session.user.username, database.name, `Updated record in "${database.name}"`);
  res.json(db.get('records').find({ id: req.params.id }).value());
});

app.delete('/api/databases/:dbId/records/:id', requireAuth, (req, res) => {
  const record = db.get('records').find({ id: req.params.id, databaseId: req.params.dbId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  if (req.session.user.role === 'guest' && record.createdBy !== req.session.user.username) {
    return res.status(403).json({ error: 'Guests can only delete their own records' });
  }

  const recDb = db.get('databases').find({ id: req.params.dbId }).value();
  db.get('records').remove({ id: req.params.id }).write();
  logActivity('delete_record', req.session.user.username, recDb ? recDb.name : req.params.dbId, `Deleted record from "${recDb ? recDb.name : req.params.dbId}"`);
  res.json({ message: 'Record deleted' });
});

// ─── Activity log (admin only) ────────────────────────────────────────────────
app.get('/api/activity', requireAdmin, (req, res) => {
  const log = db.get('activityLog').value().slice().reverse().slice(0, 100);
  res.json(log);
});

// ─── Helper: validate record data against schema ──────────────────────────────
function validateRecordData(data, fields) {
  const result = {};
  for (const field of fields) {
    const val = data[field.name];
    const isEmpty = val === undefined || val === null || val === '';

    if (isEmpty) {
      if (field.required) return { error: `"${field.name}" is required` };
      result[field.name] = null;
      continue;
    }

    if (field.type === 'number') {
      if (isNaN(Number(val))) return { error: `"${field.name}" must be a number` };
      const n = Number(val);
      if (field.min != null && n < Number(field.min)) return { error: `"${field.name}" must be ≥ ${field.min}` };
      if (field.max != null && n > Number(field.max)) return { error: `"${field.name}" must be ≤ ${field.max}` };
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

    // Enum check — applies to all types
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
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';   // bind all interfaces (ethernet + localhost)

const os = require('os');
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
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
