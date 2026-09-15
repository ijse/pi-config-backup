# Design notes

[Back to README](../README.md) · [Behavior contract](behavior.md)

## Goals

A read-only observer for Pi's main-agent skill evidence, with a status line and a detail command. Preserve the distinctions between discovery, advertised metadata, successful reads, and native explicit expansion. Do not infer model intent, modify prompts, intercept tool execution, or persist a second event log.

## Modules

| File | Responsibility |
| --- | --- |
| `core.ts` | Normalize path identity; consume native messages; correlate reads; parse skill metadata/expansion; aggregate evidence and format reports. |
| `index.ts` | Adapt Pi discovery/lifecycle APIs; register `/skill-monitor`; manage an independent status key; choose TUI or RPC display. |
| `panel.ts` | Read-only view switching, scrolling, line wrapping, width limits, and keyboard handling. |
| `test/` | Core evidence semantics, event ordering, replay, read-only boundaries, and terminal layout regression tests. |
| `scripts/smoke.mjs` | Load through the real Pi auto-discovery/jiti path and replay an in-memory native `SessionManager`. |

## Identity and evidence

Canonical filesystem paths are the identity key; display names are not unique. Preserve the requested `SKILL.md` identity when a file-level symlink resolves to a differently named file. For deleted files, fall back to normalized absolute paths.

Assistant `read` calls create pending records with their originating user turn. Successful results consume these pending records and add one event per tool call. A newer user message does not reassign an older pending read to the new turn. Explicit expansion is recorded from native top-level user blocks, not raw command intent.

Only metadata needed for reporting is retained in the tracker; skill bodies are not copied into an auxiliary store.

## Lifecycle and the persistence boundary

Pi emits `message_end` before appending that message to native session history. Later asynchronous handlers may delay persistence while an extension command is invoked. Therefore:

1. Consume live messages directly from the event.
2. Do not replace an active tracker with a branch snapshot while execution is running.
3. Rebuild at settled/session/branch/compaction boundaries, and for commands when idle.
4. Replay only original branch message entries, not summaries or checkpoint copies.

This makes replay idempotent without adding custom session entries. Compaction preserves historical meaning but does not imply context retention.

## Non-interference

Lifecycle handlers return no prompt, message, or tool patches. Commands inspect metadata and display reports without sending model messages. The status uses its own key; the panel does not edit session state; RPC editor responses are discarded. Errors degrade rather than propagate into tool execution.

## Verification

Regression coverage includes failed/duplicate/partial reads, metadata-only warnings, explicit expansion, paths and symlinks, same-name skills, user-turn boundaries, compaction replay, branch changes, in-flight command races, terminal sanitization, narrow layouts, and UI-less operation.

The smoke test confirms registration via Pi's real loader, verifies no tools are added, and checks that report generation leaves native session history unchanged. It does not make provider requests or validate a live model's behavior.
