# Pi Skill Monitor

**See which skill files Pi has read — without pretending to know what the model is actually using.**

[中文说明](README.zh-CN.md) · [Behavior & limitations](docs/behavior.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

A read-only [Pi](https://pi.dev) extension with an independent status-line indicator and a `/skill-monitor` detail panel. It separates successful skill-file reads, explicit skill expansion, and skills advertised in the system prompt.

```text
Skills · 读取 brainstorming · 显式 frontend-design
```

*Illustrative status line, not a screenshot. The extension's current UI is in Chinese.*

## What it does

- Shows skill evidence for the latest user turn without replacing your footer.
- Provides **turn**, **branch history**, and **available skills** views, including counts, times, sources, and paths.
- Rebuilds records on resume, reload, and branch changes without double-counting.
- Distinguishes partial/truncated reads from unrestricted reads.
- Does not modify prompts, skill visibility, tool execution, or session messages.
- Makes no model or network calls and creates no separate monitoring database.

> **Read does not mean used.** Reviewing a skill during installation counts as reading. History does not prove instructions are still in the model's context. This is an evidence viewer, not a compliance or security audit tool.

## Install

Tested with **`@earendil-works/pi-coding-agent` 0.85.1**, using **Node.js 22.18+**. Compatibility with other Pi versions or forks has not been verified.

```sh
pi install git:github.com/ijse/pi-skill-monitor
```

In an existing Pi session, run:

```text
/reload
```

Pi handles package installation; no manual symlink or build step is required. The Git package is the distribution source; this project is not published to npm. Review extensions before installing: Pi extensions execute with your account's system access.

**Already using a manual/local installation?** Use only one installation method. Remove the old package entry or the `~/.pi/agent/extensions/skill-monitor` symlink before enabling the Git package. This repository does not migrate or delete local installations automatically.

## Use

| Command | View/action |
| --- | --- |
| `/skill-monitor` | Latest user turn |
| `/skill-monitor turn` | Latest user turn (explicit) |
| `/skill-monitor history` | Current branch history |
| `/skill-monitor available` | Discovered skills and prompt-advertised skills |
| `/skill-monitor status off` | Hide this extension's status line |
| `/skill-monitor status on` | Show this extension's status line |

**Panel keys:** `1` / `2` / `3`, `Tab`, or left/right to switch views; arrows or `j` / `k` to scroll; `PageUp` / `PageDown` or Space to page; `Home` / `End` to jump; `Esc` / `q` to close.

The toggle is local to the extension instance and resets on reload, restart, or session switch. A third-party footer must render extension statuses for the indicator to appear; the command remains available otherwise.

### Reading the labels

| UI label | Meaning |
| --- | --- |
| 已读取 | A successful `read` returned skill-file text; not evidence of adoption. |
| 范围限制/截断读取 | A range-limited or truncated read; not a claim that the whole file was loaded. |
| 显式加载 | A user message contained Pi's native top-level expanded skill block. |
| 提示词列出 | Listed in the observable system prompt's skill metadata. |
| 仅发现 | Discovered by Pi, but not listed in that observable prompt metadata. |

**Scope:** main-agent standard `read` messages and native user skill expansion only. Bash/cat, MCP, child-agent logs, and third-party private injection formats are not tracked. See [the full behavior contract](docs/behavior.md), including compaction, replay, RPC, and evidence limitations.

## Update or uninstall

```sh
pi update --extension git:github.com/ijse/pi-skill-monitor
# or:
pi remove git:github.com/ijse/pi-skill-monitor
```

Run `/reload` afterward. For manual installation and removal, see [Contributing](CONTRIBUTING.md#manual-development-installation).

## Develop

```sh
git clone https://github.com/ijse/pi-skill-monitor.git
cd pi-skill-monitor
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

Uses project-local dependencies. The check runs TypeScript validation, **25 tests**, and an integration smoke test using Pi's real extension loader and `SessionManager`; it makes no model calls. See [Contributing](CONTRIBUTING.md) for the development workflow and [design notes](docs/design.md) for implementation details.

## License

[MIT](LICENSE) © ijse.
