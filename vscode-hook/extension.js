/**
 * claude-depester auto-patch hook for VS Code
 *
 * Tiny companion extension that re-runs the claude-depester patcher whenever
 * VS Code auto-updates the Claude Code extension (which reverts the patch).
 * All patching logic lives in the claude-depester npm package, fetched via
 * npx at run time, so published fixes apply without reinstalling this shim.
 *
 * Installed by `npx claude-depester --install-vscode-hook`.
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
 * @license MIT
 */

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

// @latest forces npx to re-resolve the dist-tag each run so new claude-depester
// releases flow through automatically (a bare `npx claude-depester` would reuse
// a stale cached copy forever). The command is intentionally NOT configurable:
// reading it from VS Code settings would let a workspace inject shell commands.
const PATCH_COMMAND = 'npx -y claude-depester@latest --silent --log --no-animation';

// Marker word from the spinner array; present only in unpatched copies.
// Same marker family the claude-depester detector uses.
const UNPATCHED_MARKER = 'Flibbertigibbeting';

const CLAUDE_EXT_PREFIX = 'anthropic.claude-code-';

// Extension updates unpack over several seconds; wait for the dust to settle.
const DEBOUNCE_MS = 10000;
// Never run the patcher more often than this (guards against event storms
// and unpatchable versions retriggering in a loop).
const MIN_RUN_INTERVAL_MS = 60000;
// npx may need to download the package on first run.
const EXEC_TIMEOUT_MS = 180000;

/**
 * Find Claude Code extension dirs whose webview still contains silly words.
 * Only the webview is checked: it's small, it's what the user sees, and the
 * patcher always patches webview + binary together.
 * @param {string} extRoot - the editor's extensions directory
 * @returns {string[]} unpatched extension dir names
 */
function findUnpatchedExtensions(extRoot) {
  const unpatched = [];
  let entries;
  try {
    entries = fs.readdirSync(extRoot);
  } catch (e) {
    return unpatched;
  }
  for (const entry of entries) {
    if (!entry.startsWith(CLAUDE_EXT_PREFIX)) continue;
    const webviewPath = path.join(extRoot, entry, 'webview', 'index.js');
    try {
      const content = fs.readFileSync(webviewPath, 'utf-8');
      if (content.includes(UNPATCHED_MARKER)) {
        unpatched.push(entry);
      }
    } catch (e) {
      // No webview (very old version) or still unpacking - skip
    }
  }
  return unpatched;
}

function activate(context) {
  // Required lazily so this module can be loaded in plain Node for tests
  const vscode = require('vscode');

  const channel = vscode.window.createOutputChannel('Claude Depester');
  context.subscriptions.push(channel);

  // This extension is installed alongside the Claude Code extension,
  // so the parent of our own install dir is the extensions root.
  const extRoot = path.dirname(context.extensionPath);
  const state = { timer: null, running: false, lastRunAt: 0 };

  const log = (msg) => channel.appendLine(`[${new Date().toISOString()}] ${msg}`);

  const runPatcher = (reason) => {
    state.running = true;
    state.lastRunAt = Date.now();
    log(`${reason} - running: ${PATCH_COMMAND}`);
    cp.exec(PATCH_COMMAND, { timeout: EXEC_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      state.running = false;
      if (err) {
        log(`Patch run failed: ${err.message}`);
        if (stderr && stderr.trim()) log(stderr.trim());
        return;
      }
      log('Patch run completed. Details: ~/.claude/depester.log');
    });
  };

  const checkAndPatch = (reason) => {
    const found = findUnpatchedExtensions(extRoot);
    if (found.length === 0) return false;
    runPatcher(`${reason}: unpatched ${found.join(', ')}`);
    return true;
  };

  // Debounced re-check; re-arms itself while a run or cooldown is in progress
  const schedule = (reason) => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      const cooldownLeft = state.lastRunAt + MIN_RUN_INTERVAL_MS - Date.now();
      if (state.running || cooldownLeft > 0) {
        schedule(reason);
        return;
      }
      checkAndPatch(reason);
    }, DEBOUNCE_MS);
  };

  // Startup safety net: catches updates installed while no window was open
  if (!checkAndPatch('Startup check')) {
    log('Startup check: all Claude Code extensions patched.');
  }

  // The real fix: VS Code installs extension updates in the background while
  // this (old) window keeps running. Patch the new version the moment it
  // lands, so any window opened later loads already-patched files.
  try {
    const watcher = fs.watch(extRoot, (_eventType, filename) => {
      if (!filename || !filename.startsWith(CLAUDE_EXT_PREFIX)) return;
      schedule('Extension update detected');
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (err) {
    log(`Could not watch extensions directory (${extRoot}): ${err.message}`);
  }

  context.subscriptions.push({
    dispose: () => {
      if (state.timer) clearTimeout(state.timer);
    }
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  // Exported for tests and for the claude-depester CLI
  findUnpatchedExtensions,
  PATCH_COMMAND,
  UNPATCHED_MARKER,
  CLAUDE_EXT_PREFIX
};
