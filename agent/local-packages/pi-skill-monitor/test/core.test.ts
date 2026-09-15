import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listedSkills, Paths, plain, report, statusText, Tracker } from "../core.ts";

const cwd = "/project";
const path = "/skills/alpha/SKILL.md";
const skill = { name: "alpha", path, source: "user · top-level" };
const user = (content = "work", timestamp = 1000) => ({ role: "user", content, timestamp });
const call = (id: string, file = path, extra = {}) => ({ role: "assistant", content: [
  { type: "toolCall", name: "read", id, arguments: { path: file, ...extra } },
] });
const result = (id: string, isError = false, timestamp = 2000, extra = {}) => ({
  role: "toolResult", toolCallId: id, toolName: "read", isError, timestamp,
  content: [{ type: "text", text: "skill instructions" }], ...extra,
});
const entry = (message: unknown) => ({ type: "message", message });
const explicit = `<skill name="alpha" location="${path}">\nInstructions\n</skill>\n\nDo work`;

function read(tracker: Tracker, id: string, file = path, extra = {}) {
  tracker.consume(call(id, file, extra)); tracker.consume(result(id));
}

test("successful reads count; tool calls, ordinary mentions and ordinary files don't", () => {
  const tracker = new Tracker(cwd, [skill]);
  tracker.consume(user("please use alpha"));
  tracker.consume(call("1"));
  assert.equal(tracker.evidence.length, 0);
  tracker.consume(result("1"));
  read(tracker, "ordinary", "/project/README.md");
  tracker.consume({ role: "assistant", content: [{ type: "text", text: "Using alpha" }] });
  assert.equal(tracker.summaries("turn")[0]?.reads, 1);
  assert.equal(tracker.evidence.length, 1);
});

test("failed, missing, empty, cancelled and duplicate results are excluded", () => {
  const tracker = new Tracker(cwd);
  tracker.consume(user());
  tracker.consume(call("failure")); tracker.consume(result("failure", true));
  tracker.consume(call("empty")); tracker.consume(result("empty", false, 2, { content: [] }));
  tracker.consume(call("unknown")); tracker.consume(result("unknown", false, 2, { isError: undefined }));
  tracker.consume(call("cancel"));
  tracker.consume(result("unmatched"));
  read(tracker, "ok");
  tracker.consume(result("ok"));
  tracker.consume(call("ok")); tracker.consume(result("ok"));
  assert.equal(tracker.evidence.length, 1);
});

test("range-limited and truncated read evidence never claims full loading", () => {
  const tracker = new Tracker(cwd);
  read(tracker, "offset", path, { offset: 2 });
  read(tracker, "limit", path, { limit: 10 });
  tracker.consume(call("truncated"));
  tracker.consume(result("truncated", false, 2, { details: { truncation: { truncated: true } } }));
  assert.equal(tracker.summaries("turn")[0]?.partial, 3);
  assert.match(report(tracker, "turn").join("\n"), /范围限制\/截断读取 3 次/);
});

test("metadata-only oversized-line warnings and zero-line requests are not file reads", () => {
  const tracker = new Tracker(cwd);
  tracker.consume(call("huge"));
  tracker.consume(result("huge", false, 2, { content: [{ type: "text", text: "[Line exceeds limit. Use bash.]" }],
    details: { truncation: { firstLineExceedsLimit: true, outputBytes: 0, truncated: true } } }));
  read(tracker, "zero", path, { limit: 0 });
  assert.equal(tracker.evidence.length, 0);
});

test("configured root markdown files count; same name at distinct paths stays separate", () => {
  const root = "/skills/alpha.md";
  const tracker = new Tracker(cwd, [skill, { ...skill, path: root }]);
  read(tracker, "a"); read(tracker, "b", root);
  assert.equal(tracker.summaries("history").length, 2);
});

test("only native top-level expanded user skill blocks count as explicit", () => {
  const tracker = new Tracker(cwd, [skill]);
  tracker.consume(user(explicit));
  tracker.consume(user(`/skill:missing`));
  tracker.consume(user(`Example:\n${explicit}`));
  tracker.consume(user(`\`\`\`xml\n${explicit}\n\`\`\``));
  tracker.consume({ role: "assistant", content: explicit });
  tracker.consume(user([{ type: "text", text: explicit }] as unknown as string));
  assert.equal(tracker.evidence.length, 2);
  assert.equal(tracker.summaries("history")[0]?.explicit, 2);
  assert.equal(tracker.summaries("turn")[0]?.explicit, 1);
});

test("one user request spans tool loops; next delivered user/steering starts a new round", () => {
  const tracker = new Tracker(cwd);
  tracker.consume(user()); read(tracker, "one"); read(tracker, "two");
  tracker.consume({ role: "custom", content: "subagent message" });
  assert.equal(tracker.turn, 1);
  assert.equal(tracker.summaries("turn")[0]?.reads, 2);
  tracker.consume(user("steer"));
  assert.equal(tracker.summaries("turn").length, 0);
  assert.equal(tracker.summaries("history")[0]?.reads, 2);
});

test("read result belongs to its originating request if a user message interleaves", () => {
  const tracker = new Tracker(cwd);
  tracker.consume(user()); tracker.consume(call("a"));
  tracker.consume(user("next")); tracker.consume(result("a"));
  assert.equal(tracker.evidence[0]?.turn, 1);
  assert.equal(tracker.summaries("turn").length, 0);
});

test("replay is idempotent, ignores compaction retainedTail duplicates and branch summaries", () => {
  const tracker = new Tracker(cwd, [skill]);
  const branch = [entry(user(explicit)), entry(call("one")), entry(result("one")),
    { type: "compaction", summary: explicit, retainedTail: [user(explicit), call("one"), result("one")] },
    { type: "branch_summary", summary: explicit }];
  tracker.replay(branch);
  assert.equal(tracker.compactions, 1);
  const before = JSON.stringify(tracker.evidence);
  tracker.replay(branch);
  assert.equal(JSON.stringify(tracker.evidence), before);
  assert.equal(tracker.evidence.length, 2);
  assert.match(report(tracker, "history").join("\n"), /历史/);
  tracker.replay([entry(user())]); // A different branch must lose the abandoned activity.
  assert.equal(tracker.evidence.length, 0);
  tracker.replay([]); // /new
  assert.equal(tracker.turn, 0);
});

test("path identity supports relative, tilde, @, symlinks and removed files", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-monitor-paths-"));
  try {
    const real = join(root, "real"); mkdirSync(real);
    writeFileSync(join(real, "SKILL.md"), "instructions");
    symlinkSync(real, join(root, "alias"));
    const paths = new Paths(root, root);
    const canonical = paths.normalize("real/SKILL.md");
    assert.equal(paths.normalize("@~/alias/SKILL.md"), canonical);
    assert.equal(paths.normalize("./real/../alias/SKILL.md"), canonical);
    const tracker = new Tracker(root, [{ ...skill, path: canonical }], root);
    read(tracker, "a", "real/SKILL.md"); read(tracker, "b", "@~/alias/SKILL.md");
    assert.equal(tracker.summaries("history").length, 1);
    assert.equal(tracker.summaries("history")[0]?.reads, 2);
    assert.equal(paths.normalize("removed/SKILL.md"), join(root, "removed/SKILL.md"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("undiscovered file-level SKILL.md symlinks retain evidence and directory name", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-monitor-file-link-"));
  try {
    const pkg = join(root, "pkg"); mkdirSync(pkg);
    writeFileSync(join(pkg, "body.md"), "instructions");
    symlinkSync("body.md", join(pkg, "SKILL.md"));
    const tracker = new Tracker(root);
    read(tracker, "link", "pkg/SKILL.md");
    const row = tracker.summaries("history")[0];
    assert.equal(row?.reads, 1);
    assert.equal(row?.skill.name, "pkg");
    assert.equal(row?.skill.path, new Paths(root).normalize("pkg/body.md"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("visible prompt skills and discovered-only skills are distinguished", () => {
  const prompt = `<available_skills>\n<skill><name>A &amp; B</name><description>description &lt;x&gt;</description><location>/skills/a&amp;b/SKILL.md</location></skill>\n</available_skills>`;
  const visible = listedSkills(prompt);
  assert.deepEqual(visible, [{ name: "A & B", description: "description <x>", path: "/skills/a&b/SKILL.md", listed: true }]);
  assert.equal(listedSkills("Just mentioning <skill><name>foo</name></skill>").length, 0);
  const tracker = new Tracker(cwd, [skill, ...visible]);
  const output = report(tracker, "available").join("\n");
  assert.match(output, /\[仅发现\] alpha/);
  assert.match(output, /\[提示词列出\] A & B/);
  tracker.setCatalog([skill]);
  assert.equal([...tracker.catalog.values()].some(s => s.listed), false);
});

test("metadata sources survive prompt merge and terminal controls are sanitized", () => {
  const tracker = new Tracker(cwd, [skill, { name: "alpha", path, listed: true }]);
  assert.equal(tracker.catalog.get(path)?.source, skill.source);
  tracker.setCatalog([{ ...skill, name: "bad\x1b[31m\nname\u202e", source: "x\u009b" }]);
  read(tracker, "a");
  assert.equal(/[\x00-\x1f\x7f-\x9f\u202e]/.test(statusText(tracker)), false);
  assert.equal(plain("a\nb\x1b[31mc"), "a b [31mc");
});

test("status shows only current round and folds many/long skill names", () => {
  const tracker = new Tracker(cwd);
  assert.match(statusText(tracker), /暂无记录/);
  tracker.consume(user());
  for (let i = 0; i < 5; i++) read(tracker, `${i}`, `/skills/${"很长".repeat(30)}${i}/SKILL.md`);
  assert.match(statusText(tracker), /\+3$/);
  assert.ok(statusText(tracker).length < 180);
});

test("malformed/unrelated messages and subagent tool payloads don't create evidence", () => {
  const tracker = new Tracker(cwd);
  for (const message of [null, [], {}, { role: "assistant", content: [null, {}, { type: "toolCall", name: "read", id: 7 }] },
    { role: "toolResult", toolName: "subagent_spawn", content: explicit },
    { role: "bashExecution", command: `cat ${path}`, output: explicit },
  ]) assert.doesNotThrow(() => tracker.consume(message));
  assert.equal(tracker.evidence.length, 0);
});
