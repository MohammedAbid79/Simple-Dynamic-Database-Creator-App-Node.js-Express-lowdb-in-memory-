'use strict';
/**
 * routes/users.js — User management routes (admin only)
 *
 * Mounted by server.js: require('./routes/users')(ctx)
 * ctx = { app, db, bcrypt, uuidv4, requireAdmin }
 */

module.exports = function registerUserRoutes(ctx) {
  const { app, db, bcrypt, uuidv4, requireAdmin } = ctx;

  // GET /api/users — list all users (passwords stripped)
  app.get('/api/users', requireAdmin, (req, res) => {
    const users = db.get('users')
      .map(u => ({ id: u.id, username: u.username, role: u.role })).value();
    res.json(users);
  });

  // POST /api/users — create user
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

  // PUT /api/users/:id — update password or role
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

  // DELETE /api/users/:id
  app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const user = db.get('users').find({ id: req.params.id }).value();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.username === 'admin' || user.username === 'guest') {
      return res.status(400).json({ error: 'Cannot delete default system accounts' });
    }
    db.get('users').remove({ id: req.params.id }).write();
    res.json({ message: 'User deleted' });
  });
};
