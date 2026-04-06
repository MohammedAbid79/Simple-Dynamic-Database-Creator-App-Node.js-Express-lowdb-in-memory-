'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_SIZE = 5 * 1024 * 1024;  // rotate at 5 MB
const MAX_ROTATED = 5;              // keep at most 5 old files

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function rotate() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_SIZE) return;

    // Shift existing rotated files: app.log.4 → deleted, app.log.3 → .4, …
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const src  = `${LOG_FILE}.${i}`;
      const dest = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i === MAX_ROTATED - 1) fs.unlinkSync(src);
        else fs.renameSync(src, dest);
      }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (_) { /* rotation errors are non-fatal */ }
}

function write(level, msg, meta) {
  const entry = { ts: new Date().toISOString(), level, msg };
  if (meta !== undefined) entry.meta = meta;

  // Console output with colour hints
  const line = `[${entry.ts}] [${level}] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
  if      (level === 'ERROR') console.error(line);
  else if (level === 'WARN')  console.warn(line);
  else                        console.log(line);

  // File output (best-effort)
  try {
    rotate();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (_) {}
}

// Return the last `n` parsed log entries from the current log file
function tail(n = 200) {
  try {
    const raw  = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').slice(-n).map(line => {
      try { return JSON.parse(line); }
      catch { return { ts: '', level: 'INFO', msg: line }; }
    });
  } catch { return []; }
}

// Clear the current log file (keep rotated files intact)
function clear() {
  try { fs.writeFileSync(LOG_FILE, ''); } catch (_) {}
}

module.exports = {
  info:  (msg, meta) => write('INFO',  msg, meta),
  warn:  (msg, meta) => write('WARN',  msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  tail,
  clear,
};
