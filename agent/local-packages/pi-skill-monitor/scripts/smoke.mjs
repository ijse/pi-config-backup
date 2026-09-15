import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const piRoot = realpathSync(join(root, 'node_modules/@earendil-works/pi-coding-agent'));
const { discoverAndLoadExtensions } = await import(pathToFileURL(join(piRoot, 'dist/core/extensions/loader.js')).href);
const { SessionManager } = await import(pathToFileURL(join(piRoot, 'dist/core/session-manager.js')).href);
const temp = mkdtempSync(join(tmpdir(), 'skill-monitor-smoke-'));
try {
  const agentDir = join(temp, 'agent');
  const cwd = join(temp, 'workspace');
  mkdirSync(join(agentDir, 'extensions'), { recursive: true }); mkdirSync(cwd);
  symlinkSync(root, join(agentDir, 'extensions/skill-monitor'), 'dir');
  const loaded = await discoverAndLoadExtensions([], cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.ok(extension.commands.has('skill-monitor'));
  assert.equal(extension.tools.size, 0);
  assert.ok(extension.handlers.has('message_end'));
  loaded.runtime.getCommands = () => [];
  const sessionManager = SessionManager.inMemory(cwd);
  const time = Date.now();
  sessionManager.appendMessage({ role: 'user', content: 'test', timestamp: time });
  sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', name: 'read', id: 'smoke-read',
    arguments: { path: join(root, 'fixtures/SKILL.md') } }], timestamp: time });
  sessionManager.appendMessage({ role: 'toolResult', toolName: 'read', toolCallId: 'smoke-read', isError: false,
    content: [{ type: 'text', text: 'fixture' }], timestamp: time });
  const before = JSON.stringify(sessionManager.getBranch());
  const statuses = [], reports = [], warnings = [];
  const ctx = { cwd, hasUI: true, mode: 'rpc', sessionManager, isIdle: () => true,
    getSystemPrompt: () => '', getSystemPromptOptions: () => ({ cwd, skills: [] }),
    ui: { setStatus: (key, text) => statuses.push({ key, text }), notify: text => warnings.push(text),
      editor: async (_title, text) => { reports.push(text); return 'discarded'; } } };
  for (const handler of extension.handlers.get('session_start')) {
    assert.equal(await handler({ type: 'session_start', reason: 'resume' }, ctx), undefined);
  }
  await extension.commands.get('skill-monitor').handler('history', ctx);
  assert.deepEqual(warnings, []);
  assert.match(reports[0], /已读取 1 次/);
  assert.equal(JSON.stringify(sessionManager.getBranch()), before);
  assert.ok(statuses.some(({ text }) => text?.includes('fixtures')));
  console.log('PASS: actual Pi auto-discovery + jiti load + native SessionManager replay; no session mutations, tools, or model calls.');
} finally { rmSync(temp, { recursive: true, force: true }); }
