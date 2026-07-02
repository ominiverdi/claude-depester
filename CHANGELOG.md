# Changelog

All notable changes to claude-depester will be documented in this file.

## [1.6.0] - 2026-07-01

**Tested with:** Claude Code 2.1.4 - 2.1.198

### Added
- **VS Code auto-patch hook (`--install-vscode-hook`)**: VS Code auto-updates the Claude Code extension (often daily), installing a fresh unpatched copy that new windows load — silently reverting the patch. This flag sideloads a tiny companion extension (`ominiverdi.claude-depester-hook`, bundled as a VSIX, never from the marketplace) that re-runs the patcher on window startup and watches the extensions directory to patch new Claude Code versions the moment the background update installs them
- **`--remove-vscode-hook` flag**: Uninstalls the companion extension from all detected editors (VS Code, VS Code Insiders, VSCodium, Cursor)
- VS Code hook status shown in `--check`, `--hook-status`, and `--debug` output
- Tip after patching VS Code extension files when the VS Code hook is not installed
- Companion extension logs to the "Claude Depester" output channel and `~/.claude/depester.log`
- **Cross-process lock** (`~/.claude/depester.lock`): concurrent patch/restore runs now serialize instead of interleaving writes. With auto-patch hooks, concurrent runs are routine (every open window activates the companion extension) - two patchers racing on the same binary corrupted it during testing. Losers skip; the winner covers all installations. Stale locks from crashed runs are stolen automatically
- **Post-patch binary verification with auto-rollback**: after repacking a binary, the patcher runs it with `--version`; if it fails to parse (unsupported Bun format, interrupted write), the original is restored from backup immediately. A patch run can no longer leave behind a broken Claude Code binary

### Changed
- **Hook commands pin `@latest`**: The SessionStart hook and the companion extension invoke `npx -y claude-depester@latest` so npx re-resolves the dist-tag each run and published fixes flow through automatically (a bare package name reuses a stale npx cache indefinitely). Re-run `--install-hook` to upgrade an existing hook in place
- `--restore` now reminds you to run `--remove-vscode-hook` if the VS Code hook is installed (it would otherwise re-patch on the next window)

## [1.5.2] - 2026-03-27

**Tested with:** Claude Code 2.1.4 - 2.1.85

### Fixed
- **ELF binary extraction for Bun 1.2+**: Newer Claude Code versions (2.1.84+) embed Bun data in a `.bun` ELF section instead of an overlay. Both formats are now supported
- **ELF section repacking**: Uses raw file write (like MachO/PE) for section-based ELF binaries

### Changed
- **Default hook command includes `--no-animation`**: `--install-hook` now also disables spinner animation automatically

## [1.5.0] - 2026-03-22

**Tested with:** Claude Code 2.1.4 - 2.1.81

### Added
- **`--no-animation` flag**: Disables the animated spinner icon (cycling `·✢*✶✻✽` characters), replacing it with a static `·`. Works on both CLI binaries and VS Code webview
- **`--no-tips` flag**: Disables spinner tips ("Tip: ...") by setting `spinnerTipsEnabled: false` in Claude settings. No binary patching needed
- Animation status now shown in `--check` and `--debug` output for all installation types

### Fixed
- **`--restore` crash on locked files** ([PR #8](https://github.com/ominiverdi/claude-depester/pull/8)): Locked files (e.g. while VS Code is running) no longer prevent restoring remaining installations

### Thanks
- [@noobydp](https://github.com/noobydp) for the `--no-animation` webview implementation and the `--restore` crash fix

## [1.4.0] - 2026-02-10

**Tested with:** Claude Code 2.1.4 - 2.1.38

### Fixed
- **MachO binary bloat** ([#5](https://github.com/ominiverdi/claude-depester/issues/5)): Patched MachO binaries were ~1.6GB instead of ~183MB. Now uses raw file write instead of LIEF write() for MachO/PE, producing identical-size output
- **New Bun data format**: Support for both old (36-byte) and new (52-byte) module struct sizes used in Claude Code 2.1.37+
- **Status check after patching**: extractClaudeJs now correctly returns patched contents instead of falling through to unpatched bytecode

### Changed
- **All commands operate on all installations by default**: `--all` flag removed. Patch, check, and restore now target all found installations automatically (`--all` still accepted silently for backwards compatibility)
- **New `--path <file>` flag**: Target a specific file instead of auto-detecting
- Updated node-lief dependency from 0.1.8 to 1.0.0
- Detect `cli.js`/`cli.js.jsc` entrypoint names (Claude Code 2.0.69+)

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
