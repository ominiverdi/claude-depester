# Claude Depester Auto-Patch Hook

Companion extension for [claude-depester](https://github.com/ominiverdi/claude-depester).

VS Code auto-updates the Claude Code extension (often daily), which reverts the
claude-depester patch. This tiny extension re-applies the patch automatically:

- **On window startup**: checks installed `anthropic.claude-code-*` extensions
  and runs the patcher if any are unpatched.
- **While running**: watches the extensions directory and patches new Claude Code
  versions the moment the background auto-update installs them.

All patching logic lives in the `claude-depester` npm package, invoked via
`npx -y claude-depester@latest`, so patcher updates apply without reinstalling
this extension.

Install/remove via the CLI (not the marketplace):

```bash
npx claude-depester --install-vscode-hook
npx claude-depester --remove-vscode-hook
```

Activity is logged to the "Claude Depester" output channel
(View > Output) and to `~/.claude/depester.log`.
