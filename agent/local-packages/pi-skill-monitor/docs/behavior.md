# Behavior and limitations

[Back to README](../README.md)

## Evidence, not model intent

Skill Monitor does not claim that a skill is **being used**, obeyed, or **still in context**. Reading a skill for review or installation is still a file read. Discovery is not invocation. Historical evidence does not establish current prompt contents.

### Successful reads

- Tracks the main agent's standard `read` tool when the target is a Pi-discovered skill file (including custom root-level Markdown files) or a file named `SKILL.md`.
- Correlates assistant tool calls with tool results by `toolCallId`; counts each successful read once.
- Excludes failed, missing, empty, and zero-line results, and oversized-line warnings that contain no file text. A tool call without a successful result is not evidence.
- Marks range-limited and tool-truncated reads as partial evidence; it never claims complete loading.
- Uses canonical paths, including relative paths, `~/`, `@` prefixes, and symlinks. Same-name skills at different paths remain separate. An undiscovered `SKILL.md` falls back to its directory name.
- Does not inspect bash/cat output, MCP results, tools with other names, or separate child-agent logs.

### Explicit expansion

Recognizes Pi's native top-level user-message format:

```xml
<skill name="example" location="/path/to/example/SKILL.md">
Skill instructions...
</skill>
```

This indicates that the expanded text was observed, not that its instructions were followed. Plain skill mentions, unexpanded `/skill:name` text, and fenced examples are not counted. A manually forged message with the identical native format may be counted: this parser is not an authentication mechanism. Third-party private injection formats are outside the scope.

### Available skills

Uses discovery metadata provided by Pi rather than scanning arbitrary skill directories. Separates skills listed in the observable `<available_skills>` prompt section from discovered-only skills. The latter may still be explicitly invocable.

Other extensions may alter provider requests after this observer's hooks. The available view cannot guarantee visibility into those private final-request changes.

## Turns, history, and compaction

A turn is the latest actual `user` message plus subsequent model/tool activity, not each LLM response. Steering starts a new turn. Host notifications inserted with the `user` role also start turns; the extension does not guess their origin. After execution ends, the latest turn remains visible until the next user message.

History is **current-branch history**, not all branches or all sessions:

- Replays original message entries from `sessionManager.getBranch()`.
- Restores state on session load/reload and branch navigation; new sessions start empty.
- Does not count compaction summaries, branch summaries, or `retainedTail` copies as additional reads.
- Does not claim that pre-compaction instructions remain in model context.
- Cannot recover evidence from imports that contain only checkpoints and no original messages.

Removed historical `SKILL.md` files can still be recognized by path. A custom root-level Markdown file that is no longer discovered may no longer be identifiable as a skill. The extension cannot reconstruct the old filesystem identity of moved files or changed symlink targets.

## Live events and persistence

Live tracking consumes `message_end` because that message may not yet be persisted. Commands invoked during streaming retain the live tracker rather than overwriting it with an incomplete branch snapshot. When execution settles, state is rebuilt from native history. Results are shown when Pi delivers their final messages, not when a tool starts; parallel results follow Pi's final-message delivery order.

## UI modes

- **TUI:** independent `setStatus('skill-monitor', ...)` plus a read-only, scrollable panel. It does not replace the footer. Custom footers must render extension statuses for the indicator to appear.
- **RPC:** uses the host's `setStatus` and `editor` UI protocol. Clients may ignore statuses; the report requires editor support. All returned editor text is discarded, not saved or sent to the agent. Use command arguments to choose views.
- **JSON/print without UI:** does not print additional text to the protocol stream.

The status toggle is instance-local and resets on reload, restart, or session switch. Shutdown clears only this extension's status key.

## Privacy and failure behavior

No network/model calls, separate database, additional session entries, or extra skill-body copies. Native session messages are the source of truth. Display strings are sanitized for terminal control characters.

Observer failures degrade with a generic, one-time warning rather than blocking agent tools or returning prompt/message patches. The extension still executes with Pi's normal system privileges; “read-only” describes its implementation, not an operating-system sandbox.

When reporting bugs, redact skill names, paths, prompt text, tokens, and other sensitive data. Prefer a minimal synthetic message fixture over a full session log.
