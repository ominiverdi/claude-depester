/**
 * Manage the VS Code auto-patch companion extension (the "shim")
 *
 * The shim is a tiny sideloaded extension (see vscode-hook/) that re-runs the
 * patcher whenever VS Code auto-updates the Claude Code extension. It is
 * installed/removed via the editor's CLI (`code --install-extension`), never
 * through the marketplace, so it is never auto-updated or overwritten.
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
 * @license MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();

const HOOK_EXTENSION_ID = 'ominiverdi.claude-depester-hook';
const VSIX_PATH = path.join(__dirname, '..', 'dist', 'claude-depester-hook.vsix');
const HOOK_PACKAGE_JSON = path.join(__dirname, '..', 'vscode-hook', 'package.json');

// Editor CLIs that support --install-extension. PATH lookup alone is not
// enough: `code` is often missing from PATH on macOS, apps get renamed or
// moved to ~/Applications, and `cursor` on PATH may be Cursor's agent CLI
// which doesn't manage extensions. So candidates come from PATH, Spotlight
// (by bundle id, immune to renamed/moved apps), and static app paths - and
// each candidate is validated with --list-extensions before use.
const EDITOR_CLIS = [
  {
    name: 'VS Code',
    bin: 'code',
    bundleIds: ['com.microsoft.VSCode'],
    macApps: ['Visual Studio Code.app']
  },
  {
    name: 'VS Code Insiders',
    bin: 'code-insiders',
    bundleIds: ['com.microsoft.VSCodeInsiders'],
    macApps: ['Visual Studio Code - Insiders.app']
  },
  {
    name: 'VSCodium',
    bin: 'codium',
    bundleIds: ['com.vscodium', 'com.visualstudio.code.oss'],
    macApps: ['VSCodium.app']
  },
  {
    name: 'Cursor',
    bin: 'cursor',
    bundleIds: ['com.todesktop.230313mzl4w4u92'],
    macApps: ['Cursor.app']
  }
];

// Extension directories to scan when checking whether the shim is installed
const HOOK_EXT_DIRS = [
  ['VS Code', path.join(HOME, '.vscode', 'extensions')],
  ['VS Code Insiders', path.join(HOME, '.vscode-insiders', 'extensions')],
  ['VSCodium', path.join(HOME, '.vscode-oss', 'extensions')],
  ['Cursor', path.join(HOME, '.cursor', 'extensions')],
  ['VS Code Server', path.join(HOME, '.vscode-server', 'extensions')],
  ['Cursor Server', path.join(HOME, '.cursor-server', 'extensions')]
];

/**
 * Version of the shim bundled with this package
 * @returns {string|null}
 */
function getBundledHookVersion() {
  try {
    return JSON.parse(fs.readFileSync(HOOK_PACKAGE_JSON, 'utf-8')).version || null;
  } catch (e) {
    return null;
  }
}

/**
 * Compare two x.y.z version strings
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const ALL_KNOWN_BUNDLE_IDS = EDITOR_CLIS.flatMap(e => e.bundleIds);

/**
 * Read a macOS app bundle's identifier
 * @returns {string|null}
 */
function getMacBundleId(appPath) {
  try {
    return execSync(`defaults read "${path.join(appPath, 'Contents', 'Info')}" CFBundleIdentifier`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000
    }).trim() || null;
  } catch (e) {
    return null;
  }
}

/**
 * Guard against cross-fork CLI aliases: Cursor.app ships a bin/code, so a
 * bin-name match alone can misidentify the editor. If the candidate lives
 * inside an .app bundle that identifies as a DIFFERENT known editor, reject
 * it. Unknown or unreadable bundle ids are accepted (the --list-extensions
 * validation still applies).
 */
function matchesEditorIdentity(candidate, editor) {
  if (process.platform !== 'darwin') return true;

  let resolved = candidate;
  try {
    resolved = fs.realpathSync(candidate);
  } catch (e) {
    // Keep unresolved path
  }

  const appIdx = resolved.indexOf('.app/');
  if (appIdx === -1) return true; // Not inside an app bundle - nothing to verify

  const bundleId = getMacBundleId(resolved.slice(0, appIdx + 4));
  if (!bundleId || editor.bundleIds.includes(bundleId)) return true;
  return !ALL_KNOWN_BUNDLE_IDS.includes(bundleId);
}

/**
 * Check that a candidate CLI actually manages extensions (filters out
 * same-named tools like Cursor's agent CLI)
 */
function isWorkingEditorCli(command) {
  try {
    execSync(`"${command}" --list-extensions`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Collect candidate CLI paths for one editor, most reliable first
 * @returns {string[]}
 */
function getCliCandidates(editor) {
  const candidates = [];
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const whichCmd = isWindows ? 'where' : 'which';

  try {
    const results = execSync(`${whichCmd} ${editor.bin}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (isWindows) {
      // `where` lists VS Code's extensionless POSIX shell script (shipped for
      // Git Bash) before code.cmd; only .cmd/.exe/.bat run under cmd.exe
      const executable = results.filter(r => /\.(cmd|exe|bat)$/i.test(r));
      candidates.push(...(executable.length > 0 ? executable : results));
    } else if (results.length > 0) {
      candidates.push(results[0]);
    }
  } catch (e) {
    // Not on PATH
  }

  if (isMac) {
    const appPaths = [];

    // Well-known locations first
    for (const appName of editor.macApps) {
      appPaths.push(path.join('/Applications', appName));
      appPaths.push(path.join(HOME, 'Applications', appName));
    }

    // Spotlight finds apps regardless of name or location
    for (const bundleId of editor.bundleIds) {
      try {
        const result = execSync(`mdfind "kMDItemCFBundleIdentifier == '${bundleId}'"`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000
        }).trim();
        if (result) appPaths.push(...result.split('\n'));
      } catch (e) {
        // Spotlight unavailable or timed out
      }
    }

    // Scan Applications dirs for renamed bundles (e.g. "Visual Studio Code 2.app").
    // Each fork ships a distinct bin name (code/code-insiders/codium/cursor),
    // so matching on the bundled CLI identifies the editor regardless of app name
    for (const appsDir of ['/Applications', path.join(HOME, 'Applications')]) {
      try {
        for (const entry of fs.readdirSync(appsDir)) {
          if (entry.endsWith('.app')) appPaths.push(path.join(appsDir, entry));
        }
      } catch (e) {
        // Unreadable dir - skip
      }
    }

    for (const appPath of appPaths) {
      const cliPath = path.join(appPath.trim(), 'Contents', 'Resources', 'app', 'bin', editor.bin);
      if (fs.existsSync(cliPath)) candidates.push(cliPath);
    }
  }

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    const winPaths = {
      code: path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      'code-insiders': path.join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
      codium: path.join(localAppData, 'Programs', 'VSCodium', 'bin', 'codium.cmd'),
      cursor: path.join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')
    };
    if (winPaths[editor.bin] && fs.existsSync(winPaths[editor.bin])) {
      candidates.push(winPaths[editor.bin]);
    }
  }

  return candidates;
}

/**
 * Find editor CLIs available on this machine (first working candidate per
 * editor - multiple app copies share the same extensions directory anyway)
 * @returns {Array<{name: string, command: string}>}
 */
function findEditorClis() {
  const found = [];
  const seen = new Set();

  for (const editor of EDITOR_CLIS) {
    for (const candidate of getCliCandidates(editor)) {
      // Dedupe aliases pointing at the same binary
      let key = candidate;
      try {
        key = fs.realpathSync(candidate);
      } catch (e) {
        // Keep unresolved path as key
      }
      if (seen.has(key)) continue;

      if (matchesEditorIdentity(candidate, editor) && isWorkingEditorCli(candidate)) {
        seen.add(key);
        found.push({ name: editor.name, command: candidate });
        break;
      }
    }
  }

  return found;
}

/**
 * Scan extension directories for installed copies of the shim
 * @param {Array<[string, string]>} extDirs - [editorName, extensionsDir] pairs
 * @returns {Array<{editor: string, version: string, dir: string}>}
 */
function scanForHook(extDirs = HOOK_EXT_DIRS) {
  const installations = [];
  const dirPattern = new RegExp(
    `^${HOOK_EXTENSION_ID.replace('.', '\\.')}-(\\d+\\.\\d+\\.\\d+)$`
  );

  for (const [editor, extDir] of extDirs) {
    try {
      if (!fs.existsSync(extDir)) continue;
      const versions = fs.readdirSync(extDir)
        .map(entry => {
          const match = entry.match(dirPattern);
          return match ? { version: match[1], dir: path.join(extDir, entry) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => compareVersions(b.version, a.version));

      if (versions.length > 0) {
        installations.push({ editor, version: versions[0].version, dir: versions[0].dir });
      }
    } catch (e) {
      // Unreadable extensions dir - skip
    }
  }

  return installations;
}

/**
 * Get shim install status across all editors
 * @returns {{ installed: boolean, bundledVersion: string|null, outdated: boolean,
 *             installations: Array<{editor: string, version: string, dir: string}> }}
 */
function getVsCodeHookStatus() {
  const installations = scanForHook();
  const bundledVersion = getBundledHookVersion();
  const outdated = bundledVersion !== null && installations.some(
    inst => compareVersions(inst.version, bundledVersion) < 0
  );
  return {
    installed: installations.length > 0,
    bundledVersion,
    outdated,
    installations
  };
}

/**
 * Install the shim into every editor found
 * @returns {{ success: boolean, message: string }}
 */
function installVsCodeHook() {
  if (!fs.existsSync(VSIX_PATH)) {
    return {
      success: false,
      message: `Bundled extension not found: ${VSIX_PATH}\n` +
        'If running from a git clone, build it first: npm run build:vsix'
    };
  }

  const clis = findEditorClis();
  if (clis.length === 0) {
    return {
      success: false,
      message: 'No VS Code-compatible editor CLI found (looked for: code, code-insiders, codium, cursor).\n' +
        'In VS Code, run "Shell Command: Install \'code\' command in PATH" from the Command Palette, then retry.'
    };
  }

  const lines = [];
  let okCount = 0;
  for (const cli of clis) {
    try {
      execSync(`"${cli.command}" --install-extension "${VSIX_PATH}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000
      });
      lines.push(`  ${cli.name}: installed`);
      okCount++;
    } catch (err) {
      const detail = (err.stderr || err.message || '').trim().split('\n')[0];
      lines.push(`  ${cli.name}: failed (${detail})`);
    }
  }

  if (okCount === 0) {
    return { success: false, message: `Failed to install VS Code hook:\n${lines.join('\n')}` };
  }

  return {
    success: true,
    message: `VS Code auto-patch hook installed:\n${lines.join('\n')}\n` +
      'New Claude Code extension updates will now be patched automatically.\n' +
      'Already-open windows pick it up after a restart; new windows load it automatically.'
  };
}

/**
 * Uninstall the shim from every editor found
 * @returns {{ success: boolean, message: string }}
 */
function removeVsCodeHook() {
  const clis = findEditorClis();
  if (clis.length === 0) {
    return {
      success: false,
      message: 'No VS Code-compatible editor CLI found (looked for: code, code-insiders, codium, cursor).'
    };
  }

  const lines = [];
  let failCount = 0;
  for (const cli of clis) {
    try {
      execSync(`"${cli.command}" --uninstall-extension "${HOOK_EXTENSION_ID}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000
      });
      lines.push(`  ${cli.name}: removed`);
    } catch (err) {
      const detail = (err.stderr || err.message || '').trim();
      if (/not installed/i.test(detail)) {
        lines.push(`  ${cli.name}: not installed`);
      } else {
        lines.push(`  ${cli.name}: failed (${detail.split('\n')[0]})`);
        failCount++;
      }
    }
  }

  return {
    success: failCount === 0,
    message: `VS Code auto-patch hook removal:\n${lines.join('\n')}`
  };
}

module.exports = {
  installVsCodeHook,
  removeVsCodeHook,
  getVsCodeHookStatus,
  scanForHook,
  findEditorClis,
  getBundledHookVersion,
  compareVersions,
  HOOK_EXTENSION_ID,
  VSIX_PATH
};
