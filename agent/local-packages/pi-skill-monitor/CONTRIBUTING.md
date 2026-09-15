# Contributing

## Requirements

- Node.js **22.18+** (native TypeScript stripping is used in tests).
- pnpm **11.24.0**, matching `packageManager` in `package.json`.
- Git.

No API key, model subscription, or running Pi session is required for automated checks. The development dependencies pin Pi 0.85.1; broader compatibility is not assumed.

## Set up and check

```sh
git clone https://github.com/ijse/pi-skill-monitor.git
cd pi-skill-monitor
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

Dependencies stay inside the project. Installation needs registry access; the checks themselves make no model/network calls. Lifecycle scripts are intentionally skipped: the monitor and its test suite do not require dependency build scripts.

Individual checks:

```sh
pnpm run typecheck
pnpm test
pnpm run smoke
```

- **Typecheck:** validates the extension against the pinned Pi APIs.
- **Tests:** Node's built-in runner checks the reducer, adapter, and panel.
- **Smoke:** creates a temporary extension root, loads the package through the actual Pi discovery/jiti loader, and inspects native `SessionManager` replay. Temporary fixtures are removed afterward.

The GitHub Actions workflow uses the same commands on Linux. Local verification is not a claim that a remote workflow has already passed.

## Manual development installation

For an editable checkout, either register it as a local Pi package:

```sh
pi install /absolute/path/to/pi-skill-monitor
```

Or create an auto-discovery symlink (macOS/Linux), **only if the destination does not already exist**:

```sh
mkdir -p "$HOME/.pi/agent/extensions"
# Run from this repository's root. Refuse to overwrite any existing file/link.
if [ -e "$HOME/.pi/agent/extensions/skill-monitor" ] || [ -L "$HOME/.pi/agent/extensions/skill-monitor" ]; then
  printf '%s\n' 'skill-monitor is already present; inspect it before changing anything.'
else
  ln -s "$PWD" "$HOME/.pi/agent/extensions/skill-monitor"
fi
```

Run `/reload` inside Pi. Do not register both this checkout and the Git package, or use both local methods at once.

To remove a local package entry:

```sh
pi remove /absolute/path/to/pi-skill-monitor
```

To remove **only a manual symlink**, after verifying that it is a symlink:

```sh
test -L "$HOME/.pi/agent/extensions/skill-monitor" && unlink "$HOME/.pi/agent/extensions/skill-monitor"
```

Run `/reload` again. Both methods can leave your source checkout intact.

## Optional: reuse an existing Pi runtime

For development without downloading another runtime, start with an empty project `node_modules` and run:

```sh
node scripts/link-runtime.mjs /absolute/path/to/installed/pi-coding-agent
node --experimental-strip-types --test test/*.test.ts
node scripts/smoke.mjs
```

This helper creates local links and installs nothing; it expects Pi's package directory to contain the TUI and Node type packages. It is a convenience for compatible local layouts, not the reproducible CI setup. Type checking additionally needs an available TypeScript compiler. Use the pinned project install above if any dependency is missing. Do not mix the linked and package-manager-managed setups in the same `node_modules` directory.

## Making changes

1. Read [the behavior contract](docs/behavior.md) and [design notes](docs/design.md).
2. Add regression coverage for evidence and lifecycle changes, especially pre-persistence event timing.
3. Run all checks and update affected documentation.
4. Open a pull request with a concise description, test results, and any compatibility implications.

Keep the extension observational: no prompt injection, model calls, additional session messages, separate skill-body storage, or guesses about whether the model followed a skill. Changes to those boundaries require an explicit design discussion.

## Reporting issues

Include Pi/Node versions, installation method, UI mode, expected behavior, and a minimal reproduction. For footer issues, mention other footer extensions. Do not upload full session logs or credentials; use redacted synthetic messages whenever possible.

Contributions are provided under this repository's [MIT license](LICENSE).
