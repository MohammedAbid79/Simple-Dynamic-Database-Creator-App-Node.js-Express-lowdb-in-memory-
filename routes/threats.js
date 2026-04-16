'use strict';
/**
 * routes/threats.js — Threat Monitor routes (admin only)
 *
 * Mounted by server.js: require('./routes/threats')(ctx)
 * ctx = { app, requireAdmin, _threatLog, _blockedIPs }
 */

module.exports = function registerThreatRoutes(ctx) {
  const { app, requireAdmin, _threatLog, _blockedIPs } = ctx;

  // GET /api/threats — return recent threat log entries (newest first)
  app.get('/api/threats', requireAdmin, (req, res) => {
    res.json([..._threatLog].reverse().slice(0, 200));
  });

  // GET /api/threats/stats — aggregated counts per threat type
  app.get('/api/threats/stats', requireAdmin, (req, res) => {
    const since24h   = new Date(Date.now() - 86_400_000).toISOString();
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

  // DELETE /api/threats — clear the threat log
  app.delete('/api/threats', requireAdmin, (req, res) => {
    _threatLog.length = 0;
    res.json({ message: 'Threat log cleared' });
  });
};
