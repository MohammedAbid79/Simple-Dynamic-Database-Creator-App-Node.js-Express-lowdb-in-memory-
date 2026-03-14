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
}).write();

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
  res.json(db.get('databases').value());
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
  res.json(db.get('databases').find({ id: req.params.id }).value());
});

app.delete('/api/databases/:id', requireAdmin, (req, res) => {
  if (!db.get('databases').find({ id: req.params.id }).value()) {
    return res.status(404).json({ error: 'Database not found' });
  }
  db.get('databases').remove({ id: req.params.id }).write();
  db.get('records').remove({ databaseId: req.params.id }).write();
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
  res.json(db.get('records').find({ id: req.params.id }).value());
});

app.delete('/api/databases/:dbId/records/:id', requireAuth, (req, res) => {
  const record = db.get('records').find({ id: req.params.id, databaseId: req.params.dbId }).value();
  if (!record) return res.status(404).json({ error: 'Record not found' });

  if (req.session.user.role === 'guest' && record.createdBy !== req.session.user.username) {
    return res.status(403).json({ error: 'Guests can only delete their own records' });
  }

  db.get('records').remove({ id: req.params.id }).write();
  res.json({ message: 'Record deleted' });
});

// ─── Helper: validate record data against schema ──────────────────────────────
function validateRecordData(data, fields) {
  const result = {};
  for (const field of fields) {
    const val = data[field.name];
    if (val === undefined || val === null || val === '') {
      result[field.name] = null;
      continue;
    }
    if (field.type === 'number' && isNaN(Number(val))) {
      return { error: `Field "${field.name}" must be a number` };
    }
    if (field.type === 'boolean' && !['true', 'false', true, false].includes(val)) {
      return { error: `Field "${field.name}" must be boolean` };
    }
    result[field.name] =
      field.type === 'number' ? Number(val) :
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nDynamic Database Creator running on http://localhost:${PORT}`);
  console.log('  Admin  → username: admin   password: admin123');
  console.log('  Guest  → username: guest   password: guest123\n');
});
