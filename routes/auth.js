'use strict';
/**
 * routes/auth.js — Authentication routes
 *
 * Mounted by server.js: require('./routes/auth')(ctx)
 * ctx = { app, db, bcrypt, uuidv4, loginLimiter, requireAuth, getAuthUser }
 */

module.exports = function registerAuthRoutes(ctx) {
  const { app, db, bcrypt, uuidv4, loginLimiter, requireAuth, getAuthUser } = ctx;

  // POST /api/auth/login
  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    const user = db.get('users').find({ username }).value();
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ username: user.username, role: user.role });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out' }));
  });

  // GET /api/auth/me — returns current user
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json(getAuthUser(req));
  });

  // POST /api/auth/register — self-registration (creates member account)
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
};
