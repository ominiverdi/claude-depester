/**
 * Manage Claude Code SessionStart hooks for auto-patching
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
 * @license MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// Claude Code user settings path is ~/.claude/settings.json on all platforms
// (on Windows, ~ expands to %USERPROFILE%)
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');

// Log file for debugging hook execution
const LOG_PATH = path.join(HOME, '.claude', 'depester.log');
const MAX_LOG_ENTRIES = 50;

// Use --all to patch all installations (CLI + VS Code binary + webview)
// Use --log to write results to ~/.claude/depester.log for debugging
const HOOK_COMMAND = 'npx claude-depester --all --silent --log';

/**
 * Read Claude Code settings
 * @returns {object}
 */
function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // File doesn't exist or invalid JSON
  }
  return {};
}

/**
 * Write Claude Code settings
 * @param {object} settings
 */
function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Check if our hook is installed
 * @returns {boolean}
 */
function isHookInstalled() {
  const settings = readSettings();
  
  if (!settings.hooks?.SessionStart) return false;
  
  // Check if any SessionStart hook has our command
  for (const hookGroup of settings.hooks.SessionStart) {
    if (!hookGroup.hooks) continue;
    for (const hook of hookGroup.hooks) {
      if (hook.command && hook.command.includes('claude-depester')) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Install SessionStart hook for auto-patching
 * @returns {{ success: boolean, message: string }}
 */
function installHook() {
  try {
    const settings = readSettings();
    
    // Initialize hooks structure if needed
    if (!settings.hooks) {
      settings.hooks = {};
    }
    if (!settings.hooks.SessionStart) {
      settings.hooks.SessionStart = [];
    }
    
    // Check if already installed
    if (isHookInstalled()) {
      return {
        success: true,
        message: 'Hook already installed'
      };
    }
    
    // Add our hook
    settings.hooks.SessionStart.push({
      hooks: [
        {
          type: 'command',
          command: HOOK_COMMAND,
          timeout: 30
        }
      ]
    });
    
    writeSettings(settings);
    
    return {
      success: true,
      message: `Hook installed. Claude Code will auto-patch on startup.\nSettings file: ${SETTINGS_PATH}`
    };
    
  } catch (err) {
    return {
      success: false,
      message: `Failed to install hook: ${err.message}`
    };
  }
}

/**
 * Remove our SessionStart hook
 * @returns {{ success: boolean, message: string }}
 */
function removeHook() {
  try {
    const settings = readSettings();
    
    if (!settings.hooks?.SessionStart) {
      return {
        success: true,
        message: 'No hook to remove'
      };
    }
    
    // Filter out our hooks
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(hookGroup => {
      if (!hookGroup.hooks) return true;
      // Remove hook groups that only contain our depester hook
      const nonDepesterHooks = hookGroup.hooks.filter(
        hook => !hook.command?.includes('claude-depester')
      );
      if (nonDepesterHooks.length === 0) return false;
      hookGroup.hooks = nonDepesterHooks;
      return true;
    });
    
    // Clean up empty arrays
    if (settings.hooks.SessionStart.length === 0) {
      delete settings.hooks.SessionStart;
    }
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
    
    writeSettings(settings);
    
    return {
      success: true,
      message: 'Hook removed'
    };
    
  } catch (err) {
    return {
      success: false,
      message: `Failed to remove hook: ${err.message}`
    };
  }
}

/**
 * Get hook status
 * @returns {{ installed: boolean, settingsPath: string }}
 */
function getHookStatus() {
  return {
    installed: isHookInstalled(),
    settingsPath: SETTINGS_PATH
  };
}

/**
 * Search Claude debug logs for hook-related entries
 * @param {number} maxFiles - Maximum number of log files to search (default 5)
 * @returns {Array<{file: string, timestamp: string, entries: Array<{time: string, message: string}>}>}
 */
function searchHookLogs(maxFiles = 5) {
  const debugDir = path.join(HOME, '.claude', 'debug');
  const results = [];
  
  try {
    if (!fs.existsSync(debugDir)) {
      return results;
    }
    
    // Get log files sorted by modification time (newest first)
    const files = fs.readdirSync(debugDir)
      .filter(f => f.endsWith('.txt') && f !== 'latest')
      .map(f => ({
        name: f,
        path: path.join(debugDir, f),
        mtime: fs.statSync(path.join(debugDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, maxFiles);
    
    for (const file of files) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const lines = content.split('\n');
      const hookEntries = [];
      
      for (const line of lines) {
        // Look for SessionStart hook entries only (not repo URLs containing "depester")
        if (line.includes('SessionStart') || 
            line.includes('Hook output')) {
          // Parse timestamp from log line: 2026-01-18T09:07:34.119Z [DEBUG] ...
          const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+\[.*?\]\s+(.*)$/);
          if (match) {
            hookEntries.push({
              time: match[1],
              message: match[2]
            });
          }
        }
      }
      
      if (hookEntries.length > 0) {
        results.push({
          file: file.name,
          timestamp: file.mtime.toISOString(),
          entries: hookEntries
        });
      }
    }
  } catch (e) {
    // Ignore errors reading logs
  }
  
  return results;
}

/**
 * Append entry to depester log file, keeping only last MAX_LOG_ENTRIES
 * @param {string} message - Log message
 * @param {object} data - Additional data to log
 */
function appendLog(message, data = null) {
  try {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      message,
      ...(data && { data })
    };
    
    // Read existing entries
    let entries = [];
    if (fs.existsSync(LOG_PATH)) {
      const content = fs.readFileSync(LOG_PATH, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(e => e !== null);
    }
    
    // Add new entry
    entries.push(entry);
    
    // Keep only last MAX_LOG_ENTRIES
    if (entries.length > MAX_LOG_ENTRIES) {
      entries = entries.slice(-MAX_LOG_ENTRIES);
    }
    
    // Write back
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOG_PATH, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    
  } catch (e) {
    // Silently ignore logging errors
  }
}

/**
 * Read depester log entries
 * @returns {Array<{timestamp: string, message: string, data?: object}>}
 */
function readLog() {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      return [];
    }
    const content = fs.readFileSync(LOG_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(e => e !== null);
  } catch (e) {
    return [];
  }
}

module.exports = {
  installHook,
  removeHook,
  isHookInstalled,
  getHookStatus,
  searchHookLogs,
  appendLog,
  readLog,
  SETTINGS_PATH,
  HOOK_COMMAND,
  LOG_PATH
};
