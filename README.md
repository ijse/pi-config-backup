# Pi configuration backup

A private, sanitized backup of the local Pi configuration from `~/.pi/agent`.

## Included

- Global settings, keybindings, loadouts, and UI/search settings
- Custom extensions, skills, agent guidance, and local package source
- `agent/mcp.json.example`, with credential values replaced by placeholders

## Deliberately excluded

Authentication (`auth.json`), live MCP credentials, sessions, caches, package install caches, generated usage data, and dependency directories. These files are either sensitive, machine-specific, or reproducible.

## Restore

1. Back up your existing `~/.pi/agent` directory.
2. Copy selected files/directories from `agent/` into `~/.pi/agent/`.
3. Copy `agent/mcp.json.example` to `~/.pi/agent/mcp.json` only if needed, then supply local credentials without committing them.
4. Run `pi` and verify package-specific dependencies according to each package's README.

Do not commit credentials or session files to this repository.
