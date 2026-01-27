/**
 * Detect Claude Code installation paths
 * Supports: native binary, local npm, global npm, homebrew
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
 * @license MIT
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const HOME = os.homedir();

/**
 * Get all potential paths to check (both cli.js and native binary)
 */
function getPotentialPaths() {
  const paths = [];
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  
  // Priority 1: Native binary (recommended installation method)
  // Linux/macOS: ~/.local/bin/claude symlinks to ~/.local/share/claude/versions/X.Y.Z
  // Windows: %USERPROFILE%\.local\bin\claude.exe
  if (!isWindows) {
    try {
      const claudePath = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (claudePath) {
        // Resolve symlinks to get the actual binary
        const realPath = fs.realpathSync(claudePath);
        paths.push({
          method: 'native binary (which claude)',
          path: realPath,
          type: 'binary'
        });
      }
    } catch (e) {
      // which failed or claude not found
    }
  } else {
    // Windows: try where command
    try {
      const claudePath = execSync('where claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
      if (claudePath) {
        paths.push({
          method: 'native binary (where claude)',
          path: claudePath,
          type: 'binary'
        });
      }
    } catch (e) {
      // where failed or claude not found
    }
  }
  
  // Check versions directory directly
  // Linux: ~/.local/share/claude/versions/X.Y.Z
  // macOS: ~/Library/Application Support/Claude/versions/X.Y.Z (also ~/.local/share/claude)
  // Windows: %LOCALAPPDATA%\Claude\versions\X.Y.Z
  const versionsDirs = [];
  
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    versionsDirs.push(path.join(localAppData, 'Claude', 'versions'));
    versionsDirs.push(path.join(HOME, '.local', 'share', 'claude', 'versions'));
  } else if (isMac) {
    versionsDirs.push(path.join(HOME, 'Library', 'Application Support', 'Claude', 'versions'));
    versionsDirs.push(path.join(HOME, '.local', 'share', 'claude', 'versions'));
  } else {
    versionsDirs.push(path.join(HOME, '.local', 'share', 'claude', 'versions'));
  }
  
  for (const versionsDir of versionsDirs) {
    try {
      if (fs.existsSync(versionsDir)) {
        const versions = fs.readdirSync(versionsDir)
          .filter(f => /^\d+\.\d+\.\d+$/.test(f))
          .sort((a, b) => {
            const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
            const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
            return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
          });
        
        for (const version of versions) {
          const binaryName = isWindows ? 'claude.exe' : 'claude';
          const binaryPath = path.join(versionsDir, version, binaryName);
          // Also check if version folder itself is the binary (some installations)
          const versionPath = path.join(versionsDir, version);
          
          if (fs.existsSync(binaryPath)) {
            paths.push({
              method: `native binary (${versionsDir})`,
              path: binaryPath,
              type: 'binary'
            });
          } else if (fs.existsSync(versionPath) && fs.statSync(versionPath).isFile()) {
            paths.push({
              method: `native binary (${versionsDir})`,
              path: versionPath,
              type: 'binary'
            });
          }
        }
      }
    } catch (e) {
      // Failed to read versions dir
    }
  }
  
  // Windows: also check .local\bin directly
  if (isWindows) {
    const winBinaryPath = path.join(HOME, '.local', 'bin', 'claude.exe');
    paths.push({
      method: 'native binary (Windows .local\\bin)',
      path: winBinaryPath,
      type: 'binary'
    });
  }
  
  // Priority 2: Local npm installations
  paths.push({
    method: 'local npm (~/.claude)',
    path: path.join(HOME, '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    type: 'js'
  });
  paths.push({
    method: 'local npm (~/.config/claude)',
    path: path.join(HOME, '.config', 'claude', 'local', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    type: 'js'
  });
  
  // Priority 3: Global npm (dynamic)
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (npmRoot) {
      paths.push({
        method: 'global npm (npm root -g)',
        path: path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js'),
        type: 'js'
      });
    }
  } catch (e) {
    // npm not available or failed
  }
  
  // Priority 4: VS Code / VSCodium extensions
  // Linux: ~/.vscode/extensions, ~/.vscode-oss/extensions
  // macOS: ~/.vscode/extensions, ~/Library/Application Support/Code/User/extensions (rare)
  // Windows: %USERPROFILE%\.vscode\extensions, %APPDATA%\Code\User\extensions
  const vscodeExtDirs = [
    path.join(HOME, '.vscode', 'extensions'),           // VS Code (all platforms)
    path.join(HOME, '.vscode-oss', 'extensions'),       // VSCodium (Linux)
    path.join(HOME, '.vscode-insiders', 'extensions'),  // VS Code Insiders
    path.join(HOME, '.vscode-server', 'extensions'),    // VS Code Remote Server
    path.join(HOME, '.vscode-server-insiders', 'extensions'), // VS Code Remote Server (Insiders)
    path.join(HOME, '.cursor-server', 'extensions'),    // Cursor Remote Server
  ];
  
  // Add Windows-specific paths
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    vscodeExtDirs.push(path.join(appData, 'Code', 'User', 'extensions'));
    vscodeExtDirs.push(path.join(appData, 'Code - Insiders', 'User', 'extensions'));
    vscodeExtDirs.push(path.join(appData, 'VSCodium', 'User', 'extensions'));
  }
  
  // Add macOS-specific paths  
  if (isMac) {
    vscodeExtDirs.push(path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'extensions'));
    vscodeExtDirs.push(path.join(HOME, 'Library', 'Application Support', 'Code - Insiders', 'User', 'extensions'));
    vscodeExtDirs.push(path.join(HOME, 'Library', 'Application Support', 'VSCodium', 'User', 'extensions'));
  }
  
  for (const extDir of vscodeExtDirs) {
    try {
      if (fs.existsSync(extDir)) {
        const extensions = fs.readdirSync(extDir)
          .filter(f => f.startsWith('anthropic.claude-code-'))
          .sort()
          .reverse(); // Latest version first
        
        for (const ext of extensions) {
          // Native binary in extension
          const binaryName = isWindows ? 'claude.exe' : 'claude';
          const binaryPath = path.join(extDir, ext, 'resources', 'native-binary', binaryName);
          if (fs.existsSync(binaryPath)) {
            paths.push({
              method: `VS Code extension binary (${ext})`,
              path: binaryPath,
              type: 'binary'
            });
          }
          
          // Webview frontend JS - has separate copy of spinner words
          const webviewPath = path.join(extDir, ext, 'webview', 'index.js');
          if (fs.existsSync(webviewPath)) {
            paths.push({
              method: `VS Code extension webview (${ext})`,
              path: webviewPath,
              type: 'webview'
            });
          }
        }
      }
    } catch (e) {
      // Failed to read extensions dir
    }
  }
  
  // Priority 5: Derive from process.execPath
  try {
    const nodeDir = path.dirname(process.execPath);
    paths.push({
      method: 'derived from node binary',
      path: path.join(nodeDir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      type: 'js'
    });
  } catch (e) {
    // Failed to derive
  }
  
  // Priority 6: Common homebrew locations (macOS)
  if (process.platform === 'darwin') {
    paths.push({
      method: 'homebrew (arm64)',
      path: '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      type: 'js'
    });
    paths.push({
      method: 'homebrew (x86)',
      path: '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      type: 'js'
    });
  }
  
  return paths;
}

/**
 * Check if a file contains the silly words OR has been patched (works for both JS and binary)
 */
function containsSillyWordsOrPatched(filePath) {
  try {
    // Read as buffer to handle both text and binary
    const content = fs.readFileSync(filePath);
    const contentStr = content.toString('utf-8');
    
    // Check if already patched (replacement pattern)
    if (/=\["Thinking"\]/.test(contentStr)) {
      return true;
    }
    
    // Check for marker words
    const markers = ['Flibbertigibbeting', 'Discombobulating', 'Clauding'];
    let found = 0;
    for (const marker of markers) {
      if (contentStr.includes(marker)) {
        found++;
      }
    }
    return found >= 2;
  } catch (e) {
    return false;
  }
}

// Legacy alias
function containsSillyWords(filePath) {
  return containsSillyWordsOrPatched(filePath);
}

/**
 * Find Claude Code installation (cli.js or native binary)
 * @returns {{ path: string, method: string, type: 'js' | 'binary' | 'webview' } | null}
 */
function findClaudeCode() {
  const potentialPaths = getPotentialPaths();
  
  for (const { method, path: codePath, type } of potentialPaths) {
    try {
      const resolvedPath = path.resolve(codePath);
      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath);
        if (stats.isFile() && containsSillyWords(resolvedPath)) {
          return { path: resolvedPath, method, type };
        }
      }
    } catch (e) {
      // File doesn't exist or can't be read
    }
  }
  
  return null;
}

// Legacy alias
function findCliJs() {
  const result = findClaudeCode();
  if (result) {
    return { path: result.path, method: result.method, type: result.type };
  }
  return null;
}

/**
 * Find ALL Claude Code installations (CLI + VS Code extensions + webviews)
 * @returns {Array<{ path: string, method: string, type: 'js' | 'binary' | 'webview' }>}
 */
function findAllClaudeCode() {
  const potentialPaths = getPotentialPaths();
  const found = [];
  const seenPaths = new Set();
  
  for (const { method, path: codePath, type } of potentialPaths) {
    try {
      const resolvedPath = path.resolve(codePath);
      if (seenPaths.has(resolvedPath)) continue;
      
      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath);
        if (stats.isFile() && containsSillyWords(resolvedPath)) {
          found.push({ path: resolvedPath, method, type });
          seenPaths.add(resolvedPath);
        }
      }
    } catch (e) {
      // File doesn't exist or can't be read
    }
  }
  
  return found;
}

/**
 * Get all searched paths for error reporting
 */
function getSearchedPaths() {
  return getPotentialPaths();
}

module.exports = {
  findClaudeCode,
  findCliJs,
  findAllClaudeCode,
  getSearchedPaths
};
