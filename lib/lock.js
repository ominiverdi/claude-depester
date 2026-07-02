/**
 * Cross-process lock for patch/restore operations
 *
 * Concurrent patcher runs are a real scenario, not an edge case: the VS Code
 * auto-patch hook activates in every open window (and in Cursor), the
 * SessionStart hook fires per session, and manual runs can overlap with
 * either. Binary patching is a multi-second extract/repack/write of large
 * files - two interleaved writers corrupt the binary. This lock serializes
 * writers; losers skip (the winner patches everything anyway).
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
 * @license MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Overridable for tests
const LOCK_PATH = process.env.DEPESTER_LOCK_PATH ||
  path.join(os.homedir(), '.claude', 'depester.lock');

// A patch run across many installations can take a few minutes; anything
// older than this is a crashed run
const STALE_MS = 10 * 60 * 1000;

/**
 * Check whether a pid belongs to a live process
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to another user
    return e.code === 'EPERM';
  }
}

/**
 * Try to acquire the lock. Non-blocking: returns false if another live
 * run holds it. Stale locks (crashed runs) are stolen via rename so only
 * one of several contenders can win.
 * @returns {boolean}
 */
function acquireLock() {
  const dir = path.dirname(LOCK_PATH);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return false;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK_PATH, JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString()
      }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
    }

    // Lock exists - is the holder alive?
    try {
      const stat = fs.statSync(LOCK_PATH);
      let holderPid = null;
      try {
        holderPid = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8')).pid;
      } catch (e) {
        // Unreadable lock content - rely on age alone
      }
      const stale = (Date.now() - stat.mtimeMs > STALE_MS) ||
        (holderPid !== null && !isProcessAlive(holderPid));
      if (!stale) return false;

      // Steal via rename: if two contenders race, only one rename succeeds
      const stolen = `${LOCK_PATH}.stale-${process.pid}`;
      fs.renameSync(LOCK_PATH, stolen);
      fs.unlinkSync(stolen);
    } catch (e) {
      // Someone else stole it first, or the holder finished - retry once
    }
  }

  return false;
}

/**
 * Release the lock if this process holds it. Safe to call unconditionally
 * (e.g. from a process exit handler).
 */
function releaseLock() {
  try {
    const content = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8'));
    if (content.pid === process.pid) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch (e) {
    // Not held, not ours, or already gone
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  isProcessAlive,
  LOCK_PATH
};
