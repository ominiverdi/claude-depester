/**
 * Patch Claude Code to remove silly thinking words
 * Uses proper Bun binary extraction/repacking via node-lief
 */

const fs = require('fs');
const path = require('path');
const { extractClaudeJs, repackNativeInstallation } = require('./bun-binary');

// Distinctive words to verify we found the right array
const MARKER_WORDS = [
  'Flibbertigibbeting',
  'Discombobulating', 
  'Clauding',
  'Smooshing',
  'Wibbling',
  'Schlepping'
];

// What to replace with
const REPLACEMENT_WORD = 'Thinking';

/**
 * Check if content contains the silly words array
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function hasSillyWords(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  let found = 0;
  for (const word of MARKER_WORDS) {
    if (str.includes(`"${word}"`)) {
      found++;
      if (found >= 3) return true;
    }
  }
  return false;
}

/**
 * Check if content is already patched
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
 * Find and replace the silly words array in JavaScript content
 * @param {Buffer} jsContent - JavaScript content as buffer
 * @returns {{ patched: Buffer, count: number } | null}
 */
function patchJsContent(jsContent) {
  let str = jsContent.toString('utf-8');
  
  // Pattern to match the array assignment: varName=["Accomplishing",...,"Zigzagging"]
  // We need to find arrays that contain our marker words
  const arrayPattern = /([a-zA-Z_$][a-zA-Z0-9_$]*)=\["Accomplishing"[^\]]*"Zigzagging"\]/g;
  
  let count = 0;
  str = str.replace(arrayPattern, (match, varName) => {
    // Verify it contains marker words
    let markerCount = 0;
    for (const marker of MARKER_WORDS) {
      if (match.includes(`"${marker}"`)) markerCount++;
    }
    
    if (markerCount >= 3) {
      count++;
      return `${varName}=["${REPLACEMENT_WORD}"]`;
    }
    return match;
  });
  
  if (count === 0) return null;
  
  return {
    patched: Buffer.from(str, 'utf-8'),
    count
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
 * Main patch function
 * @param {string} filePath - Path to cli.js or binary
 * @param {object} options - Options
 * @returns {{ success: boolean, message: string, alreadyPatched?: boolean }}
 */
function patch(filePath, options = {}) {
  const { dryRun = false } = options;
  
  try {
    const isBinary = isNativeBinary(filePath);
    
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
          message: `Dry run - would patch ${result.count} occurrence(s) of silly words array in binary`,
          dryRun: true
        };
      }
      
      // Create backup
      const backupPath = createBackup(filePath);
      
      // Repack binary with patched JS
      repackNativeInstallation(filePath, result.patched, filePath);
      
      return {
        success: true,
        message: `Patched ${result.count} occurrence(s) successfully. Backup at: ${backupPath}`,
        backupPath
      };
      
    } else {
      // Plain JS file (npm installation)
      const content = fs.readFileSync(filePath);
      
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
          message: 'Could not find silly words array. Claude Code version may not be supported.'
        };
      }
      
      const result = patchJsContent(content);
      if (!result) {
        return {
          success: false,
          message: 'Could not locate words array pattern'
        };
      }
      
      if (dryRun) {
        return {
          success: true,
          message: `Dry run - would patch ${result.count} occurrence(s) of silly words array`,
          dryRun: true
        };
      }
      
      // Create backup
      const backupPath = createBackup(filePath);
      
      // Write patched content
      fs.writeFileSync(filePath, result.patched);
      
      return {
        success: true,
        message: `Patched ${result.count} occurrence(s) successfully. Backup at: ${backupPath}`,
        backupPath
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
 * @returns {{ patched: boolean, hasSillyWords: boolean, hasBackup: boolean, isBinary: boolean }}
 */
function checkStatus(filePath) {
  try {
    const isBinary = isNativeBinary(filePath);
    
    let content;
    if (isBinary) {
      content = extractClaudeJs(filePath);
      if (!content) {
        return {
          patched: false,
          hasSillyWords: false,
          hasBackup: hasBackup(filePath),
          isBinary: true,
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
      isBinary
    };
  } catch (err) {
    return {
      patched: false,
      hasSillyWords: false,
      hasBackup: false,
      isBinary: false,
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
  isPatched,
  isNativeBinary,
  MARKER_WORDS,
  REPLACEMENT_WORD
};
