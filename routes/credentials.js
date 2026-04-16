'use strict';
/**
 * routes/credentials.js — Credentials Vault routes (admin only)
 *
 * Mounted by server.js: require('./routes/credentials')(ctx)
 * ctx = { app, db, uuidv4, requireAdmin, getAuthUser, logActivity }
 */

module.exports = function registerCredentialRoutes(ctx) {
  const { app, db, uuidv4, requireAdmin, getAuthUser, logActivity } = ctx;

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
};
