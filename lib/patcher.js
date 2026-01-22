/**
 * Patch Claude Code to remove silly thinking words
 * Uses proper Bun binary extraction/repacking via node-lief
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
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

  // Check for spinner words (need 3+ matches)
  let spinnerFound = 0;
  for (const word of MARKER_WORDS) {
    if (str.includes(`"${word}"`)) {
      spinnerFound++;
      if (spinnerFound >= 3) return true;
    }
  }

  // Also check for completion verbs (need 3+ matches)
  // Uses same approach as hasCompletionVerbs for consistency
  let completionFound = 0;
  for (const word of COMPLETION_VERBS) {
    if (str.includes(`"${word}"`)) {
      completionFound++;
      if (completionFound >= 3) return true;
    }
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
  
  let found = 0;
  for (const word of COMPLETION_VERBS) {
    if (str.includes(`"${word}"`)) found++;
  }
  return found >= 3;
}

/**
 * Check if content is already patched (spinner words)
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function isPatched(content) {
  // If silly words are gone, it's patched.
  // We don't check for ["Thinking"] presence because newer versions 
  // include it natively even when unpatched.
  return !hasSillyWords(content);
}

/**
 * Check if completion verbs are already patched
 * @param {string|Buffer} content - File content
 * @returns {boolean}
 */
function isCompletionPatched(content) {
  return !hasCompletionVerbs(content);
}

/**
 * Find array boundaries around a marker word in binary content
 * @param {Buffer} buffer - Binary content
 * @param {string} markerWord - Word to search for as anchor
 * @param {string[]} validationWords - Words that should be present in the array
 * @param {number} minValidationCount - Minimum number of validation words required
 * @returns {{ startIdx: number, endIdx: number } | null}
 */
function findArrayBoundaries(buffer, markerWord, validationWords, minValidationCount) {
  const marker = Buffer.from(markerWord);
  const idx = buffer.indexOf(marker);

  if (idx === -1) return null;

  // Scan back for '['
  let startIdx = idx;
  const START_LIMIT = 5000;
  let steps = 0;
  while (startIdx > 0 && buffer[startIdx] !== 0x5B && steps < START_LIMIT) {
    startIdx--;
    steps++;
  }
  if (steps >= START_LIMIT || buffer[startIdx] !== 0x5B) return null;

  // Scan forward for ']'
  let endIdx = idx;
  const END_LIMIT = 20000;
  steps = 0;
  while (endIdx < buffer.length && buffer[endIdx] !== 0x5D && steps < END_LIMIT) {
    endIdx++;
    steps++;
  }
  if (steps >= END_LIMIT || buffer[endIdx] !== 0x5D) return null;

  // Verify validation words in range
  const range = buffer.subarray(startIdx, endIdx + 1);
  const rangeStr = range.toString('utf-8');

  let foundCount = 0;
  for (const word of validationWords) {
    if (rangeStr.includes(`"${word}"`)) foundCount++;
  }

  if (foundCount < minValidationCount) return null;

  return { startIdx, endIdx };
}

/**
 * Replace array in buffer with padded replacement, preserving length
 * @param {Buffer} buffer - Binary content
 * @param {number} startIdx - Start index of array
 * @param {number} endIdx - End index of array (inclusive)
 * @param {string} replacement - Replacement string (e.g. '["Thinking"]')
 * @returns {Buffer | null}
 */
function replaceArrayInBuffer(buffer, startIdx, endIdx, replacement) {
  const originalLen = endIdx - startIdx + 1;
  const replacementBuf = Buffer.from(replacement);

  if (replacementBuf.length > originalLen) return null;

  const padding = Buffer.alloc(originalLen - replacementBuf.length, 0x20); // Space
  const newContent = Buffer.concat([replacementBuf, padding]);

  return Buffer.concat([
    buffer.subarray(0, startIdx),
    newContent,
    buffer.subarray(endIdx + 1)
  ]);
}

/**
 * Patch binary content by finding array boundaries around marker words
 * Preserves exact length by padding with spaces.
 * Safe for patching bytecode sections where offset preservation is critical.
 * @param {Buffer} buffer - Binary content
 * @returns {{ patched: Buffer, count: number, spinnerCount: number, completionCount: number } | null}
 */
function patchBinaryContent(buffer) {
  let patched = buffer;
  let spinnerCount = 0;
  let completionCount = 0;

  // Patch spinner words array (anchor: "Flibbertigibbeting")
  const spinnerBounds = findArrayBoundaries(patched, 'Flibbertigibbeting', MARKER_WORDS, 3);
  if (spinnerBounds) {
    const result = replaceArrayInBuffer(patched, spinnerBounds.startIdx, spinnerBounds.endIdx, `["${REPLACEMENT_WORD}"]`);
    if (result) {
      patched = result;
      spinnerCount = 1;
    }
  }

  // Patch completion verbs array (anchor: "Cogitated")
  const completionBounds = findArrayBoundaries(patched, 'Cogitated', COMPLETION_VERBS, 3);
  if (completionBounds) {
    const result = replaceArrayInBuffer(patched, completionBounds.startIdx, completionBounds.endIdx, `["${COMPLETION_REPLACEMENT}"]`);
    if (result) {
      patched = result;
      completionCount = 1;
    }
  }

  const count = spinnerCount + completionCount;
  if (count === 0) return null;

  return {
    patched,
    count,
    spinnerCount,
    completionCount
  };
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
  
  // Generic pattern to match any string array assignment: varName=["str","str"...]
  // Capture group 1: varName
  // Capture group 2: array content including brackets
  const arrayPattern = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(\[[^\]]+\])/g;
  
  let spinnerCount = 0;
  let completionCount = 0;
  
  str = str.replace(arrayPattern, (match, varName, arrayContent) => {
    // Check for spinner words in this array
    let markerCount = 0;
    for (const marker of MARKER_WORDS) {
      if (arrayContent.includes(`"${marker}"`)) markerCount++;
    }
    
    // If we found enough marker words, this is the spinner array
    if (markerCount >= 3) {
      spinnerCount++;
      return `${varName}=["${REPLACEMENT_WORD}"]`;
    }
    
    // Check for completion verbs in this array
    // (Only exists in the binary, not in the webview)
    let completionMarkerCount = 0;
    for (const verb of COMPLETION_VERBS) {
      if (arrayContent.includes(`"${verb}"`)) completionMarkerCount++;
    }
    
    // If we found enough completion verbs, this is the completion array
    if (completionMarkerCount >= 3) {
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
      const extraction = extractClaudeJs(filePath);
      
      if (!extraction) {
        return {
          success: false,
          message: 'Could not extract claude.js from binary. Binary format may not be supported.'
        };
      }
      
      const claudeJs = extraction.content;
      const targetModuleName = extraction.moduleName;
      const targetType = extraction.type;
      
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
          message: 'Could not find silly words array in extracted content.'
        };
      }
      
      // Patch the content
      // Use binary patching for bytecode to preserve length/offsets
      let result;
      if (targetType === 'bytecode') {
        result = patchBinaryContent(claudeJs);
      } else {
        result = patchJsContent(claudeJs);
      }

      if (!result) {
        return {
          success: false,
          message: 'Could not locate words array pattern in content.'
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
      repackNativeInstallation(filePath, result.patched, filePath, targetModuleName, targetType);
      
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
      const extraction = extractClaudeJs(filePath);
      if (!extraction) {
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
      content = extraction.content;
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

/**
 * Get detailed debug info for troubleshooting
 * @param {string} filePath - Path to cli.js or binary
 * @param {object} options - Options
 * @param {string} options.type - Override type detection: 'binary', 'js', 'webview'
 * @returns {object} Detailed debug information
 */
function getDebugInfo(filePath, options = {}) {
  const debug = {
    filePath,
    fileExists: false,
    fileSize: null,
    fileModified: null,
    isBinary: false,
    isWebview: options.type === 'webview',
    binaryExtractionOk: null,
    extractedJsSize: null,
    // Detection details
    hasReplacementPattern: false,    // =["Thinking"]
    hasCompletionReplacement: false, // =["Thought"]
    hasOriginalSpinnerArray: false,  // ["Accomplishing"..."Zigzagging"]
    hasOriginalCompletionArray: false, // ["Baked"..."Worked"]
    markerWordsFound: [],
    completionVerbsFound: [],
    // Computed status
    spinnerPatched: false,
    completionPatched: false,
    hasSillyWords: false,
    hasBackup: false,
    error: null
  };

  try {
    // File metadata
    if (!fs.existsSync(filePath)) {
      debug.error = 'File does not exist';
      return debug;
    }
    debug.fileExists = true;
    
    const stats = fs.statSync(filePath);
    debug.fileSize = stats.size;
    debug.fileModified = stats.mtime.toISOString();
    
    // Backup check
    debug.hasBackup = hasBackup(filePath);
    
    // Binary detection
    const { type } = options;
    debug.isBinary = type !== 'js' && type !== 'webview' && isNativeBinary(filePath);
    
    // Get content
    let content;
    if (debug.isBinary) {
      const extraction = extractClaudeJs(filePath);
      if (!extraction) {
        debug.binaryExtractionOk = false;
        debug.error = 'Could not extract JavaScript from binary';
        return debug;
      }
      content = extraction.content;
      debug.binaryExtractionOk = true;
      debug.extractedJsSize = content.length;
    } else {
      content = fs.readFileSync(filePath);
    }
    
    const str = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
    
    // Check for replacement patterns
    debug.hasReplacementPattern = /=\["Thinking"\]/.test(str);
    debug.hasCompletionReplacement = /=\["Thought"\]/.test(str);
    
    // Check for original arrays
    debug.hasOriginalSpinnerArray = str.includes('["Accomplishing"') && str.includes('"Zigzagging"]');
    debug.hasOriginalCompletionArray = str.includes('["Baked"') && str.includes('"Worked"]');
    
    // Check for individual marker words
    for (const word of MARKER_WORDS) {
      if (str.includes(`"${word}"`)) {
        debug.markerWordsFound.push(word);
      }
    }
    
    // Check for individual completion verbs
    for (const verb of COMPLETION_VERBS) {
      if (str.includes(`"${verb}"`)) {
        debug.completionVerbsFound.push(verb);
      }
    }
    
    // Compute status using existing functions
    debug.spinnerPatched = isPatched(content);
    debug.completionPatched = isCompletionPatched(content);
    debug.hasSillyWords = hasSillyWords(content);
    
  } catch (err) {
    debug.error = err.message;
  }
  
  return debug;
}

module.exports = {
  patch,
  checkStatus,
  getDebugInfo,
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
