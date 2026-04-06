'use strict';
/**
 * watcher.js — process supervisor for server.js
 *
 * Spawns server.js as a child process and restarts it automatically if it
 * crashes or exits unexpectedly.  Exponential back-off (1 s → 2 s → 4 s …
 * capped at 30 s) prevents a tight restart loop when there is a boot-time
 * error in the server code itself.
 *
 * Usage:  node watcher.js
 */

const { spawn } = require('child_process');
const path      = require('path');

const SERVER      = path.join(__dirname, 'server.js');
const MIN_DELAY   = 1_000;   // ms — first restart delay
const MAX_DELAY   = 30_000;  // ms — maximum back-off

let proc         = null;
let restartDelay = MIN_DELAY;
let restartCount = 0;
let stopping     = false;

function start() {
  if (stopping) return;

  console.log(`[watcher] Starting server.js… (restart #${restartCount})`);

  proc = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    env:   process.env,
  });

  // Reset back-off after the process has been up for 10 s (considered healthy)
  const healthTimer = setTimeout(() => { restartDelay = MIN_DELAY; }, 10_000);

  proc.on('error', err => {
    clearTimeout(healthTimer);
    console.error(`[watcher] Failed to spawn server: ${err.message}`);
    scheduleRestart();
  });

  proc.on('exit', (code, signal) => {
    clearTimeout(healthTimer);
    if (stopping) return;

    if (code === 0) {
      // Clean exit — don't restart
      console.log('[watcher] Server exited cleanly. Shutting down.');
      process.exit(0);
    }

    console.error(
      `[watcher] Server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}). ` +
      `Restarting in ${restartDelay / 1000} s…`
    );
    scheduleRestart();
  });
}

function scheduleRestart() {
  restartCount++;
  const delay = restartDelay;
  restartDelay = Math.min(restartDelay * 2, MAX_DELAY);
  setTimeout(start, delay);
}

// Gracefully forward stop signals to the child so it can flush/close cleanly
function shutdown(signal) {
  stopping = true;
  console.log(`[watcher] Received ${signal}. Forwarding to server…`);
  if (proc && !proc.exitCode) proc.kill(signal);
  // Give the child 5 s to exit, then force-quit
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
