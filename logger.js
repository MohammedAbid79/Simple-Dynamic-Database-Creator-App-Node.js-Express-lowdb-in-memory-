'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR   = path.join(__dirname, 'logs');
const KEEP_DAYS = 7;   // delete log files older than this many days

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ─── Date helpers ─────────────────────────────────────────────────────────────
function todayTag() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function logFilePath(tag = todayTag()) {
  return path.join(LOG_DIR, `app-${tag}.log`);
}

// ─── Pruning ──────────────────────────────────────────────────────────────────
function pruneOldLogs() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    }
  } catch (_) {}
}

// Prune at startup, then once per hour so midnight rolls cleanly
pruneOldLogs();
let _lastDay = todayTag();
setInterval(() => {
  const today = todayTag();
  if (today !== _lastDay) { _lastDay = today; pruneOldLogs(); }
}, 60 * 60 * 1000).unref();

// ─── Write ────────────────────────────────────────────────────────────────────
function write(level, msg, meta) {
  const entry = { ts: new Date().toISOString(), level, msg };
  if (meta !== undefined) entry.meta = meta;

  const line = `[${entry.ts}] [${level}] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
  if      (level === 'ERROR') console.error(line);
  else if (level === 'WARN')  console.warn(line);
  else                        console.log(line);

  try { fs.appendFileSync(logFilePath(), JSON.stringify(entry) + '\n'); } catch (_) {}
}

// ─── Read ─────────────────────────────────────────────────────────────────────

// Return up to `n` log entries for `date` (default today), newest first.
// Optionally filter by `level`.
function tail(n = 200, level, date) {
  try {
    const raw = fs.readFileSync(logFilePath(date || todayTag()), 'utf8').trim();
    if (!raw) return [];
    let entries = raw.split('\n').map(line => {
      try { return JSON.parse(line); }
      catch { return { ts: '', level: 'INFO', msg: line }; }
    });
    if (level) entries = entries.filter(e => e.level === level);
    return entries.slice(-n).reverse();
  } catch { return []; }
}

// Return list of available log dates, newest first
function listDates() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => f.slice(4, -4))   // strip "app-" prefix and ".log" suffix
      .sort()
      .reverse();
  } catch { return []; }
}

// Clear today's log file only
function clear() {
  try { fs.writeFileSync(logFilePath(), ''); } catch (_) {}
}

module.exports = {
  info:  (msg, meta) => write('INFO',  msg, meta),
  warn:  (msg, meta) => write('WARN',  msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  tail,
  clear,
  listDates,
  todayTag,
};
