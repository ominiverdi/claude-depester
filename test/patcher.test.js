const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  hasSillyWords,
  hasCompletionVerbs,
  hasSpinnerIconAnimation,
  isPatched,
  isCompletionPatched,
  isAnimationPatched,
  isNativeBinary,
  MARKER_WORDS,
  REPLACEMENT_WORD,
  COMPLETION_VERBS,
  COMPLETION_REPLACEMENT,
  SPINNER_ICON_CHARS,
  SPINNER_ICON_ESCAPED,
  STATIC_ICON_CHAR,
  STATIC_ICON_ESCAPED
} = require('../lib/patcher');

// ---------------------------------------------------------------------------
// Test fixtures - simulated content
// ---------------------------------------------------------------------------

// Unpatched spinner array (like what Claude Code ships with)
const UNPATCHED_SPINNER = `var x=["Flibbertigibbeting","Discombobulating","Clauding","Smooshing","Wibbling","Schlepping","Zigzagging"]`;

// Patched spinner array
const PATCHED_SPINNER = `var x=["Thinking"]`;

// Unpatched completion verbs
const UNPATCHED_COMPLETION = `var y=["Baked","Brewed","Churned","Cogitated","Cooked","Crunched","Worked"]`;

// Patched completion verbs
const PATCHED_COMPLETION = `var y=["Thought"]`;

// Webview spinner icon animation (raw Unicode)
const WEBVIEW_ANIMATION = `var icons=["·","✢","*","✶","✻","✽"]`;

// Patched webview animation
const WEBVIEW_ANIMATION_PATCHED = `var icons=["·"]`;

// Binary spinner icon animation (escaped Unicode)
const BINARY_ANIMATION = `return["\\xB7","\\u2722","*","\\u2736","\\u273B","\\u273D"]`;

// Patched binary animation
const BINARY_ANIMATION_PATCHED = `return["\\xB7"]`;

// Second binary spinner (ghostty variant)
const BINARY_ANIMATION_GHOSTTY = `return["\\xB7","\\u2722","\\u2733","\\u2736","\\u273B","*"]`;

// Full unpatched content combining all arrays
const FULL_UNPATCHED = [UNPATCHED_SPINNER, UNPATCHED_COMPLETION, WEBVIEW_ANIMATION].join(';');
const FULL_PATCHED = [PATCHED_SPINNER, PATCHED_COMPLETION, WEBVIEW_ANIMATION_PATCHED].join(';');

// Binary-like content with escaped Unicode animation
const BINARY_CONTENT = [UNPATCHED_SPINNER, UNPATCHED_COMPLETION, BINARY_ANIMATION_GHOSTTY, BINARY_ANIMATION].join(';');

// ---------------------------------------------------------------------------
// hasSillyWords
// ---------------------------------------------------------------------------

describe('hasSillyWords', () => {
  it('detects unpatched spinner words', () => {
    assert.equal(hasSillyWords(UNPATCHED_SPINNER), true);
  });

  it('detects unpatched completion verbs', () => {
    assert.equal(hasSillyWords(UNPATCHED_COMPLETION), true);
  });

  it('returns false for patched content', () => {
    assert.equal(hasSillyWords(PATCHED_SPINNER), false);
  });

  it('returns false for content without any marker words', () => {
    assert.equal(hasSillyWords('var x=["hello","world"]'), false);
  });

  it('requires at least 3 matching words', () => {
    const twoWords = 'var x=["Flibbertigibbeting","Discombobulating"]';
    assert.equal(hasSillyWords(twoWords), false);
  });

  it('works with Buffer input', () => {
    assert.equal(hasSillyWords(Buffer.from(UNPATCHED_SPINNER)), true);
  });
});

// ---------------------------------------------------------------------------
// hasCompletionVerbs
// ---------------------------------------------------------------------------

describe('hasCompletionVerbs', () => {
  it('detects unpatched completion verbs', () => {
    assert.equal(hasCompletionVerbs(UNPATCHED_COMPLETION), true);
  });

  it('returns false for patched completion', () => {
    assert.equal(hasCompletionVerbs(PATCHED_COMPLETION), false);
  });

  it('returns false for spinner-only content', () => {
    assert.equal(hasCompletionVerbs(UNPATCHED_SPINNER), false);
  });

  it('requires at least 3 matching verbs', () => {
    const twoVerbs = 'var y=["Baked","Brewed"]';
    assert.equal(hasCompletionVerbs(twoVerbs), false);
  });
});

// ---------------------------------------------------------------------------
// isPatched / isCompletionPatched
// ---------------------------------------------------------------------------

describe('isPatched', () => {
  it('returns true when spinner words are gone', () => {
    assert.equal(isPatched(PATCHED_SPINNER), true);
  });

  it('returns false when spinner words are present', () => {
    assert.equal(isPatched(UNPATCHED_SPINNER), false);
  });
});

describe('isCompletionPatched', () => {
  it('returns true when completion verbs are gone', () => {
    assert.equal(isCompletionPatched(PATCHED_COMPLETION), true);
  });

  it('returns false when completion verbs are present', () => {
    assert.equal(isCompletionPatched(UNPATCHED_COMPLETION), false);
  });
});

// ---------------------------------------------------------------------------
// hasSpinnerIconAnimation
// ---------------------------------------------------------------------------

describe('hasSpinnerIconAnimation', () => {
  it('detects raw Unicode spinner icons (webview)', () => {
    assert.equal(hasSpinnerIconAnimation(WEBVIEW_ANIMATION), true);
  });

  it('returns false for patched webview animation', () => {
    assert.equal(hasSpinnerIconAnimation(WEBVIEW_ANIMATION_PATCHED), false);
  });

  it('detects escaped Unicode spinner arrays (binary)', () => {
    assert.equal(hasSpinnerIconAnimation(BINARY_ANIMATION), true);
  });

  it('returns false for patched binary animation', () => {
    assert.equal(hasSpinnerIconAnimation(BINARY_ANIMATION_PATCHED), false);
  });

  it('detects ghostty variant', () => {
    assert.equal(hasSpinnerIconAnimation(BINARY_ANIMATION_GHOSTTY), true);
  });

  it('returns false for unrelated content', () => {
    assert.equal(hasSpinnerIconAnimation('var x=["hello","world"]'), false);
  });

  it('avoids false positives from isolated escaped chars', () => {
    // Individual \u273B appears in many places in the binary (JSX etc.)
    // Detection should only trigger on the array pattern
    const isolatedChars = 'aa="\\u273B";bb="\\u2722";cc="\\u2736"';
    assert.equal(hasSpinnerIconAnimation(isolatedChars), false);
  });
});

// ---------------------------------------------------------------------------
// isAnimationPatched
// ---------------------------------------------------------------------------

describe('isAnimationPatched', () => {
  it('returns true when animation is gone', () => {
    assert.equal(isAnimationPatched(WEBVIEW_ANIMATION_PATCHED), true);
  });

  it('returns false when animation is present (webview)', () => {
    assert.equal(isAnimationPatched(WEBVIEW_ANIMATION), false);
  });

  it('returns false when animation is present (binary)', () => {
    assert.equal(isAnimationPatched(BINARY_ANIMATION), false);
  });
});

// ---------------------------------------------------------------------------
// isNativeBinary
// ---------------------------------------------------------------------------

describe('isNativeBinary', () => {
  it('returns false for non-existent file', () => {
    assert.equal(isNativeBinary('/tmp/does-not-exist-depester-test'), false);
  });

  it('returns false for plain text file', () => {
    const fs = require('fs');
    const path = '/tmp/depester-test-textfile.js';
    fs.writeFileSync(path, 'console.log("hello")');
    try {
      assert.equal(isNativeBinary(path), false);
    } finally {
      fs.unlinkSync(path);
    }
  });

  it('detects ELF binary', () => {
    const fs = require('fs');
    const path = '/tmp/depester-test-elf';
    // ELF magic: 0x7f ELF
    const buf = Buffer.alloc(16);
    buf[0] = 0x7f; buf[1] = 0x45; buf[2] = 0x4c; buf[3] = 0x46;
    fs.writeFileSync(path, buf);
    try {
      assert.equal(isNativeBinary(path), true);
    } finally {
      fs.unlinkSync(path);
    }
  });

  it('detects PE binary (MZ header)', () => {
    const fs = require('fs');
    const path = '/tmp/depester-test-pe';
    const buf = Buffer.alloc(16);
    buf[0] = 0x4d; buf[1] = 0x5a; // MZ
    fs.writeFileSync(path, buf);
    try {
      assert.equal(isNativeBinary(path), true);
    } finally {
      fs.unlinkSync(path);
    }
  });
});

// ---------------------------------------------------------------------------
// patchJsContent (via internal require - test the exported patch function
// indirectly through content manipulation)
// ---------------------------------------------------------------------------

// We can't easily call patchJsContent directly since it's not exported,
// but we can test it through the patch() function with temporary files.

describe('patch (JS content)', () => {
  const fs = require('fs');
  const tmpFile = '/tmp/depester-test-patch.js';

  it('patches spinner words in JS file', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'js' });
      assert.equal(result.success, true);
      assert.equal(result.spinnerCount, 1);

      const patched = fs.readFileSync(tmpFile, 'utf-8');
      assert.ok(patched.includes(`["${REPLACEMENT_WORD}"]`));
      assert.ok(!patched.includes('Flibbertigibbeting'));
    } finally {
      fs.unlinkSync(tmpFile);
      // Clean up backup
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });

  it('patches completion verbs in JS file', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_COMPLETION);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'js' });
      assert.equal(result.success, true);
      assert.equal(result.completionCount, 1);

      const patched = fs.readFileSync(tmpFile, 'utf-8');
      assert.ok(patched.includes(`["${COMPLETION_REPLACEMENT}"]`));
      assert.ok(!patched.includes('Cogitated'));
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });

  it('patches both spinner and completion in one pass', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER + ';' + UNPATCHED_COMPLETION);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'js' });
      assert.equal(result.success, true);
      assert.equal(result.spinnerCount, 1);
      assert.equal(result.completionCount, 1);
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });

  it('reports already patched for patched content', () => {
    fs.writeFileSync(tmpFile, PATCHED_SPINNER);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'js' });
      assert.equal(result.success, true);
      assert.equal(result.alreadyPatched, true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('dry-run does not modify file', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'js', dryRun: true });
      assert.equal(result.success, true);
      assert.equal(result.dryRun, true);

      const content = fs.readFileSync(tmpFile, 'utf-8');
      assert.ok(content.includes('Flibbertigibbeting'));
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('creates backup before patching', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER);
    try {
      const { patch, hasBackup } = require('../lib/patcher');
      patch(tmpFile, { type: 'js' });
      assert.equal(hasBackup(tmpFile), true);

      // Backup should contain original content
      const backup = fs.readFileSync(tmpFile + '.depester.backup', 'utf-8');
      assert.ok(backup.includes('Flibbertigibbeting'));
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// Animation patching
// ---------------------------------------------------------------------------

describe('patch animation (webview)', () => {
  const fs = require('fs');
  const tmpFile = '/tmp/depester-test-anim.js';

  it('patches webview animation when --no-animation is set', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER + ';' + WEBVIEW_ANIMATION);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'webview', noAnimation: true });
      assert.equal(result.success, true);
      assert.equal(result.animationCount, 1);

      const patched = fs.readFileSync(tmpFile, 'utf-8');
      assert.ok(!patched.includes('"✢"'));
      assert.ok(!patched.includes('"✽"'));
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });

  it('does not patch animation without --no-animation', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER + ';' + WEBVIEW_ANIMATION);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'webview', noAnimation: false });
      assert.equal(result.success, true);
      assert.equal(result.animationCount, 0);

      const patched = fs.readFileSync(tmpFile, 'utf-8');
      assert.ok(patched.includes('"✢"'));
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });

  it('patches animation on already word-patched content', () => {
    fs.writeFileSync(tmpFile, PATCHED_SPINNER + ';' + WEBVIEW_ANIMATION);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'webview', noAnimation: true });
      assert.equal(result.success, true);
      assert.ok(result.animationCount > 0);
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });
});

describe('patch animation (binary escaped)', () => {
  const fs = require('fs');
  const tmpFile = '/tmp/depester-test-binaryanim.js';

  it('patches escaped Unicode spinner arrays with --no-animation', () => {
    const content = UNPATCHED_SPINNER + ';' + BINARY_ANIMATION_GHOSTTY + ';' + BINARY_ANIMATION;
    fs.writeFileSync(tmpFile, content);
    try {
      const { patch } = require('../lib/patcher');
      const result = patch(tmpFile, { type: 'js', noAnimation: true });
      assert.equal(result.success, true);
      assert.equal(result.animationCount, 2); // ghostty + default

      const patched = fs.readFileSync(tmpFile, 'utf-8');
      assert.ok(!patched.includes('"\\u273D"'));
      assert.ok(!patched.includes('"\\u2733"'));
      // Static replacement should be present
      assert.ok(patched.includes(`["${STATIC_ICON_ESCAPED}"]`));
    } finally {
      fs.unlinkSync(tmpFile);
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

describe('restoreBackup', () => {
  const fs = require('fs');
  const tmpFile = '/tmp/depester-test-restore.js';

  it('restores from backup', () => {
    fs.writeFileSync(tmpFile, UNPATCHED_SPINNER);
    try {
      const { patch, restoreBackup } = require('../lib/patcher');
      patch(tmpFile, { type: 'js' });

      // File should be patched
      assert.ok(!fs.readFileSync(tmpFile, 'utf-8').includes('Flibbertigibbeting'));

      // Restore
      const success = restoreBackup(tmpFile);
      assert.equal(success, true);

      // File should have original content
      assert.ok(fs.readFileSync(tmpFile, 'utf-8').includes('Flibbertigibbeting'));
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
      try { fs.unlinkSync(tmpFile + '.depester.backup'); } catch {}
    }
  });

  it('returns false when no backup exists', () => {
    const { restoreBackup } = require('../lib/patcher');
    assert.equal(restoreBackup('/tmp/depester-no-backup-exists'), false);
  });
});

// ---------------------------------------------------------------------------
// checkStatus
// ---------------------------------------------------------------------------

describe('checkStatus', () => {
  const fs = require('fs');
  const tmpFile = '/tmp/depester-test-status.js';

  it('reports not patched for unpatched content', () => {
    fs.writeFileSync(tmpFile, FULL_UNPATCHED);
    try {
      const { checkStatus } = require('../lib/patcher');
      const status = checkStatus(tmpFile, { type: 'webview' });
      assert.equal(status.patched, false);
      assert.equal(status.hasSillyWords, true);
      assert.equal(status.hasSpinnerIconAnimation, true);
      assert.equal(status.isWebview, true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('reports patched for patched content', () => {
    fs.writeFileSync(tmpFile, FULL_PATCHED);
    try {
      const { checkStatus } = require('../lib/patcher');
      const status = checkStatus(tmpFile, { type: 'webview' });
      assert.equal(status.patched, true);
      assert.equal(status.hasSillyWords, false);
      assert.equal(status.animationPatched, true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns error for non-existent file', () => {
    const { checkStatus } = require('../lib/patcher');
    const status = checkStatus('/tmp/depester-nonexistent-file');
    assert.equal(status.patched, false);
    assert.ok(status.error);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('has enough marker words for reliable detection', () => {
    assert.ok(MARKER_WORDS.length >= 3);
  });

  it('has enough completion verbs for reliable detection', () => {
    assert.ok(COMPLETION_VERBS.length >= 3);
  });

  it('has enough spinner icon chars for reliable detection', () => {
    assert.ok(SPINNER_ICON_CHARS.length >= 4);
  });

  it('has enough escaped spinner chars for reliable detection', () => {
    assert.ok(SPINNER_ICON_ESCAPED.length >= 3);
  });

  it('static icon char is the first spinner char (dot)', () => {
    assert.equal(STATIC_ICON_CHAR, SPINNER_ICON_CHARS[0]);
  });

  it('replacement word is Thinking', () => {
    assert.equal(REPLACEMENT_WORD, 'Thinking');
  });

  it('completion replacement is Thought', () => {
    assert.equal(COMPLETION_REPLACEMENT, 'Thought');
  });
});
