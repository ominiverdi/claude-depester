const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Point the lock at a temp path BEFORE requiring the module
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'depester-lock-'));
process.env.DEPESTER_LOCK_PATH = path.join(tmpRoot, 'depester.lock');

const { acquireLock, releaseLock, isProcessAlive, LOCK_PATH } = require('../lib/lock');
const { verifyBinary } = require('../lib/patcher');

const isWindows = process.platform === 'win32';

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Cross-process lock
// ---------------------------------------------------------------------------

describe('lock', () => {
  it('uses the overridden lock path', () => {
    assert.equal(LOCK_PATH, process.env.DEPESTER_LOCK_PATH);
  });

  it('acquires and releases', () => {
    assert.equal(acquireLock(), true);
    assert.ok(fs.existsSync(LOCK_PATH));
    const content = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8'));
    assert.equal(content.pid, process.pid);
    releaseLock();
    assert.ok(!fs.existsSync(LOCK_PATH));
  });

  it('refuses when a live process holds the lock', () => {
    // Held by this very process - definitely alive
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    // A different "process" trying to acquire is simulated by the module
    // seeing an existing, fresh, live-pid lock
    assert.equal(acquireLock(), false);
    fs.unlinkSync(LOCK_PATH);
  });

  it('steals a lock held by a dead process', () => {
    // spawnSync gives us a pid guaranteed to have exited
    const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: dead.pid, startedAt: new Date().toISOString() }));
    assert.equal(acquireLock(), true);
    const content = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8'));
    assert.equal(content.pid, process.pid);
    releaseLock();
  });

  it('steals a lock older than the staleness window', () => {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(LOCK_PATH, old, old);
    assert.equal(acquireLock(), true);
    releaseLock();
  });

  it('release does not remove a lock owned by another pid', () => {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }));
    releaseLock();
    assert.ok(fs.existsSync(LOCK_PATH));
    fs.unlinkSync(LOCK_PATH);
  });

  it('detects live and dead pids', () => {
    assert.equal(isProcessAlive(process.pid), true);
    const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    assert.equal(isProcessAlive(dead.pid), false);
  });
});

// ---------------------------------------------------------------------------
// Binary verification
// ---------------------------------------------------------------------------

describe('verifyBinary', { skip: isWindows && 'shell-script fixtures' }, () => {
  function makeFakeBinary(script) {
    const p = path.join(tmpRoot, `fake-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(p, `#!/bin/sh\n${script}\n`);
    fs.chmodSync(p, 0o755);
    return p;
  }

  it('accepts a binary that reports a version', () => {
    const bin = makeFakeBinary('echo "2.1.198 (Claude Code)"');
    assert.equal(verifyBinary(bin), true);
  });

  it('rejects a binary that exits nonzero (parse failure)', () => {
    const bin = makeFakeBinary('echo "SyntaxError: Invalid character" >&2; exit 1');
    assert.equal(verifyBinary(bin), false);
  });

  it('rejects a binary that prints no version', () => {
    const bin = makeFakeBinary('echo "garbage"');
    assert.equal(verifyBinary(bin), false);
  });

  it('rejects a nonexistent binary', () => {
    assert.equal(verifyBinary(path.join(tmpRoot, 'missing')), false);
  });
});
