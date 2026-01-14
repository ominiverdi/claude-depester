/**
 * Patch Claude Code to remove silly thinking words
 * Uses proper Bun binary extraction/repacking via node-lief
 *
 * @author Lorenzo Becchi
 * @license MIT
 */

const fs = require('fs');
const path = require('path');
const { extractClaudeJs, repackNativeInstallation } = require('./bun-binary');

// Distinctive words to verify we found the right array (present-tense spinner)
const MARKER_WORDS = [
  'Flibbertigibbeting',
  'Discombobulating', 
  'Clauding',
  'Smooshing',
  'Wibbling',
  'Schlepping'
];

// What to replace spinner words with
const REPLACEMENT_WORD = 'Thinking';

// Past-tense completion verbs (shown as "Baked for 42s" after thinking)
// These are only in the binary, not in the webview
const COMPLETION_VERBS = [
  'Baked',
  'Brewed',
  'Churned',
  'Cogitated',
  'Cooked',
  'Crunched',
  'Sautéed',
  'Worked'
];

// What to replace completion verbs with
const COMPLETION_REPLACEMENT = 'Thought';

/**
 * Check if content contains the silly words array (spinner or completion)
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function hasSillyWords(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  
  // Check for spinner words
  let found = 0;
  for (const word of MARKER_WORDS) {
    if (str.includes(`"${word}"`)) {
      found++;
      if (found >= 3) return true;
    }
  }
  
  // Also check for completion verbs (only in binary)
  if (str.includes('["Baked"')) {
    return true;
  }
  
  return false;
}

/**
 * Check if content contains the completion verbs array
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function hasCompletionVerbs(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  return str.includes('["Baked"') && str.includes('"Worked"]');
}

/**
 * Check if content is already patched (spinner words)
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function isPatched(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  const hasReplacement = /=\["Thinking"\]/.test(str);
  const hasOriginalArray = str.includes('["Accomplishing"') && str.includes('"Zigzagging"]');
  return hasReplacement && !hasOriginalArray;
}

/**
 * Check if completion verbs are already patched
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function isCompletionPatched(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  const hasReplacement = /=\["Thought"\]/.test(str);
  const hasOriginalArray = str.includes('["Baked"') && str.includes('"Worked"]');
  return hasReplacement && !hasOriginalArray;
}

/**
 * Find and replace the silly words array in JavaScript content
 * @param {Buffer} jsContent - JavaScript content as buffer
 * @param {object} options - Options
 * @param {boolean} options.isWebview - Whether this is a webview file (uses different var names)
 * @returns {{ patched: Buffer, count: number, spinnerCount: number, completionCount: number } | null}
 */
function patchJsContent(jsContent, options = {}) {
  let str = jsContent.toString('utf-8');
  
  // Pattern to match the array assignment: varName=["Accomplishing",...,"LastWord"]
  // Different versions may end with different words:
  // - CLI binary: ends with "Zigzagging"
  // - Webview: ends with "Wrangling"
  // We need to find arrays that contain our marker words
  // Note: Webview uses longer var names like "Tte", binaries use shorter like "ouI"
  const spinnerPatterns = [
    /([a-zA-Z_$][a-zA-Z0-9_$]*)=\["Accomplishing"[^\]]*"Zigzagging"\]/g,  // CLI binary
    /([a-zA-Z_$][a-zA-Z0-9_$]*)=\["Accomplishing"[^\]]*"Wrangling"\]/g,   // Webview
  ];
  
  let spinnerCount = 0;
  for (const arrayPattern of spinnerPatterns) {
    str = str.replace(arrayPattern, (match, varName) => {
      // Verify it contains marker words
      let markerCount = 0;
      for (const marker of MARKER_WORDS) {
        if (match.includes(`"${marker}"`)) markerCount++;
      }
      
      if (markerCount >= 3) {
        spinnerCount++;
        return `${varName}=["${REPLACEMENT_WORD}"]`;
      }
      return match;
    });
  }
  
  // Pattern to match the completion verbs array: varName=["Baked",...,"Worked"]
  // This array only exists in the binary, not in the webview
  const completionPattern = /([a-zA-Z_$][a-zA-Z0-9_$]*)=\["Baked"[^\]]*"Worked"\]/g;
  
  let completionCount = 0;
  str = str.replace(completionPattern, (match, varName) => {
    // Verify it contains expected completion verbs
    if (match.includes('"Brewed"') || match.includes('"Churned"')) {
      completionCount++;
      return `${varName}=["${COMPLETION_REPLACEMENT}"]`;
    }
    return match;
  });
  
  const count = spinnerCount + completionCount;
  if (count === 0) return null;
  
  return {
    patched: Buffer.from(str, 'utf-8'),
    count,
    spinnerCount,
    completionCount
  };
}

/**
 * Create backup of file
 * @param {string} filePath - Path to file
 * @returns {string} - Backup path
 */
function createBackup(filePath) {
  const backupPath = filePath + '.depester.backup';
  
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  
  return backupPath;
}

/**
 * Restore from backup
 * @param {string} filePath - Path to file
 * @returns {boolean} - Success
 */
function restoreBackup(filePath) {
  const backupPath = filePath + '.depester.backup';
  
  if (!fs.existsSync(backupPath)) {
    return false;
  }
  
  fs.copyFileSync(backupPath, filePath);
  return true;
}

/**
 * Check if backup exists
 * @param {string} filePath - Path to file
 * @returns {boolean}
 */
function hasBackup(filePath) {
  return fs.existsSync(filePath + '.depester.backup');
}

/**
 * Detect if file is a native binary (vs plain JS)
 * @param {string} filePath - Path to file
 * @returns {boolean}
 */
function isNativeBinary(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    // Check for ELF magic
    if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      return true;
    }
    // Check for MachO magic (32/64 bit, both endians)
    const magic = buffer.readUInt32LE(0);
    if (magic === 0xfeedface || magic === 0xfeedfacf || 
        magic === 0xcefaedfe || magic === 0xcffaedfe) {
      return true;
    }
    // Check for PE (MZ header)
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return true;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Format patch result message with details
 * @param {object} result - Result from patchJsContent
 * @param {string} fileType - Type of file (binary, webview, JavaScript)
 * @param {boolean} isDryRun - Whether this is a dry run
 * @returns {string}
 */
function formatPatchMessage(result, fileType, isDryRun) {
  const parts = [];
  
  if (result.spinnerCount > 0) {
    parts.push(`spinner words (${result.spinnerCount})`);
  }
  if (result.completionCount > 0) {
    parts.push(`completion verbs (${result.completionCount})`);
  }
  
  const what = parts.join(' + ');
  const prefix = isDryRun ? 'Dry run - would patch' : 'Patched';
  
  return `${prefix} ${what} in ${fileType}`;
}

/**
 * Main patch function
 * @param {string} filePath - Path to cli.js or binary
 * @param {object} options - Options
 * @param {boolean} options.dryRun - Don't actually patch
 * @param {string} options.type - Override type detection: 'binary', 'js', 'webview'
 * @returns {{ success: boolean, message: string, alreadyPatched?: boolean, spinnerCount?: number, completionCount?: number }}
 */
function patch(filePath, options = {}) {
  const { dryRun = false, type } = options;
  
  try {
    // Always verify with isNativeBinary() - detector may misclassify npm installs as binaries
    // (e.g., `which claude` on Mac can return cli.js symlink, not actual binary)
    const isBinary = type !== 'js' && type !== 'webview' && isNativeBinary(filePath);
    const isWebview = type === 'webview';
    
    if (isBinary) {
      // Native binary - extract JS, patch, repack
      const claudeJs = extractClaudeJs(filePath);
      
      if (!claudeJs) {
        return {
          success: false,
          message: 'Could not extract claude.js from binary. Binary format may not be supported.'
        };
      }
      
      // Check if already patched
      if (isPatched(claudeJs)) {
        return {
          success: true,
          message: 'Already patched',
          alreadyPatched: true
        };
      }
      
      // Check for silly words
      if (!hasSillyWords(claudeJs)) {
        return {
          success: false,
          message: 'Could not find silly words array in extracted JavaScript.'
        };
      }
      
      // Patch the JS content
      const result = patchJsContent(claudeJs);
      if (!result) {
        return {
          success: false,
          message: 'Could not locate words array pattern in JavaScript.'
        };
      }
      
      if (dryRun) {
        return {
          success: true,
          message: formatPatchMessage(result, 'binary', true),
          dryRun: true,
          spinnerCount: result.spinnerCount,
          completionCount: result.completionCount
        };
      }
      
      // Create backup
      const backupPath = createBackup(filePath);
      
      // Repack binary with patched JS
      repackNativeInstallation(filePath, result.patched, filePath);
      
      return {
        success: true,
        message: `${formatPatchMessage(result, 'binary', false)}. Backup at: ${backupPath}`,
        backupPath,
        spinnerCount: result.spinnerCount,
        completionCount: result.completionCount
      };
      
    } else {
      // Plain JS file (npm installation) or webview file
      const content = fs.readFileSync(filePath);
      const fileType = isWebview ? 'webview' : 'JavaScript';
      
      if (isPatched(content)) {
        return {
          success: true,
          message: 'Already patched',
          alreadyPatched: true
        };
      }
      
      if (!hasSillyWords(content)) {
        return {
          success: false,
          message: `Could not find silly words array in ${fileType}. Claude Code version may not be supported.`
        };
      }
      
      const result = patchJsContent(content, { isWebview });
      if (!result) {
        return {
          success: false,
          message: `Could not locate words array pattern in ${fileType}`
        };
      }
      
      if (dryRun) {
        return {
          success: true,
          message: formatPatchMessage(result, fileType, true),
          dryRun: true,
          spinnerCount: result.spinnerCount,
          completionCount: result.completionCount
        };
      }
      
      // Create backup
      const backupPath = createBackup(filePath);
      
      // Write patched content
      fs.writeFileSync(filePath, result.patched);
      
      return {
        success: true,
        message: `${formatPatchMessage(result, fileType, false)}. Backup at: ${backupPath}`,
        backupPath,
        spinnerCount: result.spinnerCount,
        completionCount: result.completionCount
      };
    }
    
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err.message}`
    };
  }
}

/**
 * Check patch status
 * @param {string} filePath - Path to cli.js or binary
 * @param {object} options - Options
 * @param {string} options.type - Override type detection: 'binary', 'js', 'webview'
 * @returns {{ patched: boolean, hasSillyWords: boolean, hasBackup: boolean, isBinary: boolean, isWebview: boolean, completionPatched: boolean, hasCompletionVerbs: boolean }}
 */
function checkStatus(filePath, options = {}) {
  try {
    const { type } = options;
    // Always verify with isNativeBinary() - detector may misclassify npm installs as binaries
    const isBinary = type !== 'js' && type !== 'webview' && isNativeBinary(filePath);
    const isWebview = type === 'webview';
    
    let content;
    if (isBinary) {
      content = extractClaudeJs(filePath);
      if (!content) {
        return {
          patched: false,
          hasSillyWords: false,
          hasBackup: hasBackup(filePath),
          isBinary: true,
          isWebview: false,
          completionPatched: false,
          hasCompletionVerbs: false,
          error: 'Could not extract JavaScript from binary'
        };
      }
    } else {
      content = fs.readFileSync(filePath);
    }
    
    return {
      patched: isPatched(content),
      hasSillyWords: hasSillyWords(content),
      hasBackup: hasBackup(filePath),
      isBinary,
      isWebview,
      completionPatched: isCompletionPatched(content),
      hasCompletionVerbs: hasCompletionVerbs(content)
    };
  } catch (err) {
    return {
      patched: false,
      hasSillyWords: false,
      hasBackup: false,
      isBinary: false,
      isWebview: false,
      error: err.message
    };
  }
}

module.exports = {
  patch,
  checkStatus,
  restoreBackup,
  hasBackup,
  hasSillyWords,
  hasCompletionVerbs,
  isPatched,
  isCompletionPatched,
  isNativeBinary,
  MARKER_WORDS,
  REPLACEMENT_WORD,
  COMPLETION_VERBS,
  COMPLETION_REPLACEMENT
};
