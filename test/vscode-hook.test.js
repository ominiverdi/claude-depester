const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findUnpatchedExtensions,
  PATCH_COMMAND,
  UNPATCHED_MARKER,
  CLAUDE_EXT_PREFIX
} = require('../vscode-hook/extension');

const {
  scanForHook,
  compareVersions,
  getBundledHookVersion,
  HOOK_EXTENSION_ID
} = require('../lib/vscode-hook');

const { HOOK_COMMAND } = require('../lib/hooks');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNPATCHED_WEBVIEW = 'var x=["Flibbertigibbeting","Discombobulating","Clauding"]';
const PATCHED_WEBVIEW = 'var x=["Thinking"]';

const tmpDirs = [];

function makeExtRoot(extensions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depester-test-'));
  tmpDirs.push(root);
  for (const [dirName, webviewContent] of Object.entries(extensions)) {
    const extDir = path.join(root, dirName);
    if (webviewContent === null) {
      // Extension dir without a webview
      fs.mkdirSync(extDir, { recursive: true });
    } else {
      fs.mkdirSync(path.join(extDir, 'webview'), { recursive: true });
      fs.writeFileSync(path.join(extDir, 'webview', 'index.js'), webviewContent);
    }
  }
  return root;
}

after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Shim extension: findUnpatchedExtensions
// ---------------------------------------------------------------------------

describe('findUnpatchedExtensions', () => {
  it('detects an unpatched Claude Code extension', () => {
    const root = makeExtRoot({
      'anthropic.claude-code-2.1.198-darwin-arm64': UNPATCHED_WEBVIEW
    });
    assert.deepEqual(findUnpatchedExtensions(root), [
      'anthropic.claude-code-2.1.198-darwin-arm64'
    ]);
  });

  it('ignores a patched Claude Code extension', () => {
    const root = makeExtRoot({
      'anthropic.claude-code-2.1.198-darwin-arm64': PATCHED_WEBVIEW
    });
    assert.deepEqual(findUnpatchedExtensions(root), []);
  });

  it('reports only the unpatched version when multiple are installed', () => {
    const root = makeExtRoot({
      'anthropic.claude-code-2.1.197-darwin-arm64': PATCHED_WEBVIEW,
      'anthropic.claude-code-2.1.198-darwin-arm64': UNPATCHED_WEBVIEW
    });
    assert.deepEqual(findUnpatchedExtensions(root), [
      'anthropic.claude-code-2.1.198-darwin-arm64'
    ]);
  });

  it('ignores non-Claude extensions even if they contain the marker', () => {
    const root = makeExtRoot({
      'some.other-extension-1.0.0': UNPATCHED_WEBVIEW
    });
    assert.deepEqual(findUnpatchedExtensions(root), []);
  });

  it('skips Claude extensions without a webview', () => {
    const root = makeExtRoot({
      'anthropic.claude-code-1.0.0-darwin-arm64': null
    });
    assert.deepEqual(findUnpatchedExtensions(root), []);
  });

  it('returns empty for a nonexistent extensions root', () => {
    assert.deepEqual(findUnpatchedExtensions('/nonexistent/path/here'), []);
  });
});

// ---------------------------------------------------------------------------
// Shim extension: constants
// ---------------------------------------------------------------------------

describe('shim constants', () => {
  it('patch command pins @latest so npx re-resolves each run', () => {
    assert.ok(PATCH_COMMAND.includes('claude-depester@latest'));
    assert.ok(PATCH_COMMAND.includes('-y'));
  });

  it('patch command runs silently and logs for debugging', () => {
    assert.ok(PATCH_COMMAND.includes('--silent'));
    assert.ok(PATCH_COMMAND.includes('--log'));
  });

  it('marker word matches the detector marker family', () => {
    assert.equal(UNPATCHED_MARKER, 'Flibbertigibbeting');
    assert.equal(CLAUDE_EXT_PREFIX, 'anthropic.claude-code-');
  });
});

// ---------------------------------------------------------------------------
// SessionStart hook command
// ---------------------------------------------------------------------------

describe('HOOK_COMMAND', () => {
  it('pins @latest so npx re-resolves each run', () => {
    assert.ok(HOOK_COMMAND.includes('claude-depester@latest'));
    assert.ok(HOOK_COMMAND.includes('-y'));
  });
});

// ---------------------------------------------------------------------------
// lib/vscode-hook: version handling and shim scanning
// ---------------------------------------------------------------------------

describe('compareVersions', () => {
  it('orders versions numerically', () => {
    assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
    assert.equal(compareVersions('2.1.198', '2.1.198'), 0);
  });
});

describe('scanForHook', () => {
  it('finds an installed shim and parses its version', () => {
    const root = makeExtRoot({});
    fs.mkdirSync(path.join(root, `${HOOK_EXTENSION_ID}-1.0.0`));
    const found = scanForHook([['VS Code', root]]);
    assert.equal(found.length, 1);
    assert.equal(found[0].editor, 'VS Code');
    assert.equal(found[0].version, '1.0.0');
  });

  it('picks the highest version when multiple shim versions exist', () => {
    const root = makeExtRoot({});
    fs.mkdirSync(path.join(root, `${HOOK_EXTENSION_ID}-1.0.0`));
    fs.mkdirSync(path.join(root, `${HOOK_EXTENSION_ID}-1.2.0`));
    const found = scanForHook([['VS Code', root]]);
    assert.equal(found.length, 1);
    assert.equal(found[0].version, '1.2.0');
  });

  it('ignores unrelated extension dirs and missing roots', () => {
    const root = makeExtRoot({
      'anthropic.claude-code-2.1.198-darwin-arm64': PATCHED_WEBVIEW
    });
    const found = scanForHook([
      ['VS Code', root],
      ['VSCodium', '/nonexistent/path/here']
    ]);
    assert.deepEqual(found, []);
  });
});

describe('getBundledHookVersion', () => {
  it('reads the shim version from vscode-hook/package.json', () => {
    const version = getBundledHookVersion();
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'vscode-hook', 'package.json'), 'utf-8')
    );
    assert.equal(version, pkg.version);
  });
});
