# Changelog

All notable changes to claude-depester will be documented in this file.

## [1.3.6] - 2026-01-28

### Added
- **Remote development support**: VS Code Remote SSH (`~/.vscode-server`), VS Code Insiders Remote (`~/.vscode-server-insiders`), and Cursor Remote SSH (`~/.cursor-server`)
- New keywords in package.json for better discoverability: `vscode-remote`, `cursor`, `ssh`

### Thanks
- [@gyohng](https://github.com/gyohng) for suggesting remote server support

## [1.3.5] - 2026-01-22

**Tested with:** Claude Code 2.1.15

### Fixed
- **VS Code extension binary patching**: Fixed completion verbs not being patched in VS Code native binaries
- **Bytecode patching**: Adapted to new array structure in bytecode sections where completion verbs are stored differently than in plain JS
- **Detection logic**: Fixed `hasSillyWords()` to properly detect completion verbs using count-based matching instead of literal array pattern matching

### Changed
- Refactored `patchBinaryContent()` into smaller helper functions (`findArrayBoundaries`, `replaceArrayInBuffer`) for better maintainability
- Binary patching now handles both spinner words (anchor: "Flibbertigibbeting") and completion verbs (anchor: "Cogitated") separately

## [1.3.4] - 2026-01-18

### Changed
- Recommend shell wrapper over SessionStart hook for more reliable auto-patching after updates

## [1.3.3] - 2026-01-17

### Added
- `--debug` flag for detailed troubleshooting information
- `--log` flag to write results to `~/.claude/depester.log`

### Fixed
- Improved troubleshooting capabilities (Fixes #3)

## [1.3.2] - 2026-01-15

### Fixed
- macOS npm install detection issue (Fixes #2)

## [1.3.1] - 2026-01-14

### Fixed
- README image paths for npm package display

## [1.3.0] - 2026-01-14

### Added
- Completion verbs patching: replaces past-tense verbs like "Baked", "Brewed", "Churned" with "Thought"
- Support for patching both spinner words and completion verbs in a single pass

## [1.2.1] - 2026-01-13

### Fixed
- Hook now uses `--all` flag for complete patching of all installations

## [1.2.0] - 2026-01-12

### Added
- VS Code extension webview patching support
- Windows PE binary support
- macOS Mach-O binary support

### Fixed
- VS Code webview patching for complete coverage

## [1.1.0] - 2026-01-10

### Added
- VS Code extension binary patching via LIEF-based Bun binary extraction
- `--all` flag to patch all found installations
- `--list` flag to show all installations and their status
- SessionStart hook for automatic patching after updates

## [1.0.0] - 2026-01-08

### Added
- Initial release
- Patches Claude Code CLI to replace whimsical spinner words with "Thinking"
- Backup and restore functionality
- Dry-run mode for previewing changes
