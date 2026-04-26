'use strict';
/**
 * routes/logs.js — Application Logs API (admin only)
 * Mounted by server.js: require('./routes/logs')(ctx)
 */

module.exports = function registerLogRoutes(ctx) {
  const { app, requireAdmin, log } = ctx;

  // GET /api/logs/dates — list available log dates, newest first
  app.get('/api/logs/dates', requireAdmin, (req, res) => {
    res.json(log.listDates());
  });

  // GET /api/logs?level=INFO|WARN|ERROR&limit=200&date=YYYY-MM-DD
  app.get('/api/logs', requireAdmin, (req, res) => {
    const level = (req.query.level || '').toUpperCase() || undefined;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 200), 1000);
    const date  = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : undefined;
    res.json(log.tail(limit, level, date));
  });

  // DELETE /api/logs — clear today's log file
  app.delete('/api/logs', requireAdmin, (req, res) => {
    log.clear();
    res.json({ message: `Log for ${log.todayTag()} cleared` });
  });
};
