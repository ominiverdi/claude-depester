# claude-depester

Remove silly thinking words from Claude Code.

Instead of seeing "Flibbertigibbeting", "Discombobulating", "Clauding", etc., you'll see "Thinking".

> **Last updated:** 2026-01-11 | **Tested with:** Claude Code 2.1.4

![Thinking... instead of silly words](img/screenshot1.png)

## The Problem

Claude Code displays random silly words while thinking:

```
Flibbertigibbeting...
Discombobulating...
Smooshing...
```

This tool replaces them with a simple "Thinking".

## Quick Start

```bash
# Preview changes first (recommended)
npx claude-depester --dry-run

# Patch Claude Code
npx claude-depester

# Auto-patch after updates (recommended)
npx claude-depester --install-hook
```

That's it! Restart Claude Code for changes to take effect.

## How It Works

1. **Detects** your Claude Code installation (native binary, npm, homebrew)
2. **Finds** the silly words array by content (not variable names - those change every version)
3. **Creates backup** before patching (can restore anytime)
4. **Patches** the file with proper padding to maintain binary integrity
5. **SessionStart hook** re-applies patch automatically after updates

### Detection Strategy

The tool finds the array by looking for its unique content:
- Starts with `"Accomplishing"`
- Ends with `"Zigzagging"`
- Contains distinctive words like `"Flibbertigibbeting"`, `"Discombobulating"`

This works regardless of minified variable names (which change every version).

## Commands

```bash
npx claude-depester              # Patch now
npx claude-depester --dry-run    # Preview changes (safe, no modifications)
npx claude-depester --check      # Check if patched
npx claude-depester --restore    # Restore original
npx claude-depester --verbose    # Show detailed info

npx claude-depester --install-hook   # Auto-patch after updates
npx claude-depester --remove-hook    # Remove auto-patch hook
npx claude-depester --hook-status    # Check hook status

npx claude-depester --help       # Show help
```

## Installation Methods Supported

- **Native binary** (`~/.local/bin/claude` -> `~/.local/share/claude/versions/X.Y.Z`) - Recommended by Anthropic
- **Local npm** (`~/.claude/local/...`)
- **Global npm** (`npm install -g @anthropic-ai/claude-code`)
- **Homebrew** (`brew install --cask claude-code`)

The tool auto-detects your installation.

## After Claude Code Updates

If you have the hook installed (`--install-hook`), patching happens automatically on startup.

Otherwise, just run `npx claude-depester` again after updating.

## Restore Original

```bash
npx claude-depester --restore
```

This restores from the backup created during patching.

## How the Hook Works

The `--install-hook` command adds a SessionStart hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-depester --silent",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Every time Claude Code starts, it checks and re-applies the patch if needed.

## Troubleshooting

### "Could not find Claude Code installation"

Make sure Claude Code is installed:
- Check with `claude --version`
- Run with `--verbose` to see searched paths

### Patch not working after update

The detection uses content-based matching, so it should survive version updates.
If the patch fails:
1. Open an issue with your Claude Code version (`claude --version`)
2. Include the output of `npx claude-depester --dry-run --verbose`

### Want to undo everything

```bash
npx claude-depester --restore      # Restore original file
npx claude-depester --remove-hook  # Remove auto-patch hook
```

## Technical Details

- **Native binaries**: Claude Code native is a Bun-compiled executable. We use [node-lief](https://www.npmjs.com/package/node-lief) to properly extract the embedded JavaScript, patch it, and repack the binary - the same approach used by [tweakcc](https://github.com/Piebald-AI/tweakcc).
- **Plain JS installs**: For npm installations, we patch the JavaScript file directly.
- **Backup location**: `<original-file>.depester.backup`
- **Hook timeout**: 30 seconds (configurable in settings.json)

## Contributing

If Claude Code updates and the patch stops working:

1. Check if the array still starts with `"Accomplishing"` and ends with `"Zigzagging"`
2. Update `lib/patcher.js` if the pattern changed
3. Submit a PR

## See Also

- [tweakcc](https://github.com/Piebald-AI/tweakcc) - Full Claude Code customization tool (themes, prompts, more)
- [aleks-apostle/claude-code-patches](https://github.com/aleks-apostle/claude-code-thinking-patch) - Thinking visibility patch

## Credits

Inspired by:
- [vemv's gist](https://gist.github.com/vemv/c6333d53ede16198a23eb95425051b7b)
- [aleks-apostle/claude-code-patches](https://github.com/aleks-apostle/claude-code-thinking-patch)
- [heromantf's bun extractor](https://gist.github.com/heromantf/7db88edcb7b1c0c35067244584a01afc)

## License

MIT
