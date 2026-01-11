/**
 * Manage Claude Code SessionStart hooks for auto-patching
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
const HOOK_COMMAND = 'npx claude-depester --silent';

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

module.exports = {
  installHook,
  removeHook,
  isHookInstalled,
  getHookStatus,
  SETTINGS_PATH,
  HOOK_COMMAND
};
