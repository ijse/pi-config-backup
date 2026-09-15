import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import install from "../index.ts";

// Small host boundary doubles; production code still typechecks against Pi's actual API.
type Handler = (event: any, ctx: any) => unknown;
function host() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, any>();
  const branch: unknown[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const notices: string[] = [];
  const editors: string[] = [];
  const filePath = "/skills/alpha/SKILL.md";
  const sourceInfo = { path: filePath, source: "user", scope: "user", origin: "top-level" };
  const skill = { name: "alpha", filePath, baseDir: "/skills/alpha", description: "alpha skill", sourceInfo, disableModelInvocation: false };
  const skills = [skill];
  let systemPrompt = `<available_skills><skill><name>alpha</name><description>alpha skill</description><location>${filePath}</location></skill></available_skills>`;
  const ctx = {
    cwd: "/project", hasUI: true, mode: "rpc", isIdle: () => true,
    getSystemPrompt: () => systemPrompt,
    getSystemPromptOptions: () => ({ cwd: "/project", skills }),
    sessionManager: { getBranch: () => [...branch] },
    ui: {
      setStatus: (key: string, text: string | undefined) => { statuses.push([key, text]); },
      notify: (message: string) => { notices.push(message); },
      editor: async (_title: string, text: string) => { editors.push(text); return "THIS MUST NOT BE SUBMITTED"; },
    },
  };
  const pi = {
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    registerCommand(name: string, command: unknown) { commands.set(name, command); },
    getCommands: () => skills.map(s => ({ name: `skill:${s.name}`, source: "skill", sourceInfo: s.sourceInfo })),
    // Deliberately no sendMessage/appendEntry/setActiveTools/registerTool methods.
  };
  install(pi as unknown as ExtensionAPI);
  const emit = (name: string, event: unknown = {}) => {
    const returned = handlers.get(name)?.(event, ctx);
    assert.equal(returned, undefined, `${name} must not patch the prompt, messages or tool results`);
  };
  const message = (value: unknown) => {
    emit("message_end", { message: value }); // Emit BEFORE persistence, like Pi.
    branch.push({ type: "message", message: value });
  };
  const user = (content = "work") => message({ role: "user", content, timestamp: 1000 });
  const read = (id = "read1", error = false) => {
    message({ role: "assistant", content: [{ type: "toolCall", name: "read", id, arguments: { path: filePath } }] });
    message({ role: "toolResult", toolCallId: id, toolName: "read", isError: error, timestamp: 2000,
      content: [{ type: "text", text: "instructions" }] });
  };
  const command = async (args = "") => commands.get("skill-monitor").handler(args, ctx);
  return { ctx, branch, statuses, notices, editors, emit, user, read, command, skills, filePath,
    setPrompt: (value: string) => { systemPrompt = value; } };
}

test("event adapter updates status live and commands don't write messages or call models", async () => {
  const h = host();
  h.emit("session_start"); h.user(); h.read();
  assert.match(h.statuses.at(-1)![1]!, /读取 alpha/);
  const before = JSON.stringify(h.branch);
  await h.command();
  assert.match(h.editors.at(-1)!, /已读取 1 次/);
  assert.equal(JSON.stringify(h.branch), before);
  await h.command();
  assert.match(h.editors.at(-1)!, /已读取 1 次/); // Rebuild did not double count.
  assert.ok(h.statuses.every(([key]) => key === "skill-monitor"));
});

test("explicit user expansion works live and after resume without input-intent false positives", async () => {
  const h = host(); h.emit("session_start");
  h.user(`<skill name="alpha" location="${h.filePath}">\nbody\n</skill>`);
  assert.match(h.statuses.at(-1)![1]!, /显式 alpha/);
  h.emit("session_start", { reason: "resume" });
  await h.command("history");
  assert.match(h.editors.at(-1)!, /显式加载 1 次/);
});

test("new round, fork/tree, new session and compaction all rebuild from native branch", async () => {
  const h = host(); h.emit("session_start"); h.user(); h.read();
  h.branch.push({ type: "compaction", retainedTail: [], summary: "read alpha" });
  h.emit("session_compact");
  await h.command("history");
  assert.match(h.editors.at(-1)!, /已读取 1 次/);
  assert.match(h.editors.at(-1)!, /1 次压缩/);
  h.user("next"); assert.match(h.statuses.at(-1)![1]!, /暂无记录/);
  h.branch.splice(1); h.emit("session_tree");
  await h.command("history"); assert.doesNotMatch(h.editors.at(-1)!, /已读取 1 次/);
  h.branch.length = 0; h.emit("session_start", { reason: "new" });
  await h.command(); assert.match(h.editors.at(-1)!, /用户轮次 0/);
});

test("discovery updates after resource loading and prompt visibility after other hooks", async () => {
  const h = host(); h.emit("session_start");
  h.emit("before_agent_start", { systemPromptOptions: { skills: h.skills } });
  h.setPrompt("No skill advertising after loadout filtering.");
  h.emit("agent_start");
  await h.command("available");
  assert.match(h.editors.at(-1)!, /\[仅发现\] alpha/);
  assert.match(h.editors.at(-1)!, /提示词中列出 0 项/);
});

test("footer toggling, failure exclusion and shutdown use only this extension's key", async () => {
  const h = host(); h.emit("session_start"); h.user(); h.read("failure", true);
  assert.match(h.statuses.at(-1)![1]!, /暂无记录/);
  await h.command("status off"); h.read("success");
  assert.equal(h.statuses.at(-1)![1], undefined);
  await h.command("status on"); assert.match(h.statuses.at(-1)![1]!, /alpha/);
  h.emit("session_shutdown"); assert.equal(h.statuses.at(-1)![1], undefined);
  await h.command("invalid"); assert.match(h.notices.at(-1)!, /用法/);
});

test("observer errors are non-blocking, warn once and don't expose exception content", () => {
  const h = host();
  h.ctx.getSystemPrompt = () => { throw new Error("private info"); };
  h.emit("session_start"); h.emit("session_tree");
  assert.equal(h.notices.length, 1);
  assert.doesNotMatch(h.notices[0]!, /private info/);
});

test("opening details while message_end is awaiting persistence preserves pending reads", async () => {
  const h = host(); h.emit("session_start"); h.user();
  h.ctx.isIdle = () => false;
  const assistant = { role: "assistant", content: [{ type: "toolCall", name: "read", id: "race",
    arguments: { path: h.filePath } }] };
  h.emit("message_end", { message: assistant });
  // A later asynchronous handler is still pending. The branch doesn't have this message.
  await h.command("history");
  h.branch.push({ type: "message", message: assistant });
  const result = { role: "toolResult", toolCallId: "race", toolName: "read", isError: false,
    content: [{ type: "text", text: "skill" }], timestamp: 2000 };
  h.emit("message_end", { message: result });
  assert.match(h.statuses.at(-1)![1]!, /读取 alpha/);
  await h.command("history"); // Also preserve a result not yet persisted.
  assert.match(h.editors.at(-1)!, /已读取 1 次/);
  h.branch.push({ type: "message", message: result });
  h.ctx.isIdle = () => true;
  h.emit("agent_settled");
  await h.command("history");
  assert.match(h.editors.at(-1)!, /已读取 1 次/);
});

test("headless modes do not attempt UI or print to the protocol stream", async () => {
  const h = host(); h.ctx.hasUI = false; h.ctx.mode = "json";
  h.emit("session_start"); h.user(); h.read();
  await h.command();
  assert.equal(h.editors.length, 0); assert.equal(h.statuses.length, 0);
});
