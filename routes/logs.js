'use strict';
/**
 * routes/logs.js — Application Logs API routes (admin only)
 *
 * Mounted by server.js: require('./routes/logs')(ctx)
 * ctx = { app, requireAdmin, log }
 */

module.exports = function registerLogRoutes(ctx) {
  const { app, requireAdmin, log } = ctx;

  // GET /api/logs?level=&limit= — tail recent log entries
  app.get('/api/logs', requireAdmin, (req, res) => {
    const level  = (req.query.level  || '').toUpperCase() || undefined;
    const limit  = Math.min(parseInt(req.query.limit) || 200, 1000);
    const entries = log.tail(limit, level);
    res.json(entries);
  });

  // DELETE /api/logs — clear the log file
  app.delete('/api/logs', requireAdmin, (req, res) => {
    log.clear();
    res.json({ message: 'Logs cleared' });
  });
};
