/**
 * Detect Claude Code installation paths
 * Supports: native binary, local npm, global npm, homebrew
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
  
  // Priority 1: Native binary (recommended installation method)
  // The binary is at ~/.local/bin/claude which symlinks to ~/.local/share/claude/versions/X.Y.Z
  if (process.platform !== 'win32') {
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
  }
  
  // Also check versions directory directly
  const versionsDir = path.join(HOME, '.local', 'share', 'claude', 'versions');
  try {
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir)
        .filter(f => /^\d+\.\d+\.\d+$/.test(f))
        .sort((a, b) => {
          const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
          const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
          return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
        });
      
      if (versions.length > 0) {
        paths.push({
          method: 'native binary (~/.local/share/claude/versions)',
          path: path.join(versionsDir, versions[0]),
          type: 'binary'
        });
      }
    }
  } catch (e) {
    // Failed to read versions dir
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
  
  // Priority 4: Derive from process.execPath
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
  
  // Priority 5: Common homebrew locations (macOS)
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
 * Check if a file contains the silly words (works for both JS and binary)
 */
function containsSillyWords(filePath) {
  try {
    // Read as buffer to handle both text and binary
    const content = fs.readFileSync(filePath);
    const contentStr = content.toString('utf-8');
    
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

/**
 * Find Claude Code installation (cli.js or native binary)
 * @returns {{ path: string, method: string, type: 'js' | 'binary' } | null}
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
 * Get all searched paths for error reporting
 */
function getSearchedPaths() {
  return getPotentialPaths();
}

module.exports = {
  findClaudeCode,
  findCliJs,
  getSearchedPaths
};
