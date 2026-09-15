import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENTRY = '/Users/liyi/.pi/agent/extensions/model-router/index.ts';
const LOADER = '/Users/liyi/n/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';

test('real Pi loader loads only thin entry offline: one /route, six handlers, zero tools/model actions', async t => {
  const violations = [];
  const blocked = kind => () => {
    violations.push(kind);
    throw new Error(`Offline validation blocked ${kind}`);
  };
  // Install before importing Pi. Even swallowed attempts must fail the final assertion.
  t.mock.method(globalThis, 'fetch', blocked('fetch/network'));
  t.mock.method(net.Socket.prototype, 'connect', blocked('socket/network'));
  t.mock.method(tls, 'connect', blocked('TLS/network'));
  for (const mod of [http, https]) for (const key of ['request', 'get']) {
    t.mock.method(mod, key, blocked('HTTP/network'));
  }
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    t.mock.method(childProcess, key, blocked('child process'));
  }
  const checkRead = value => {
    if (typeof value === 'number') return;
    const name = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
    const agent = '/Users/liyi/.pi/agent/';
    if (path.basename(name) === 'auth.json' || name.includes('/sessions/') ||
        (name.startsWith(agent) && name !== ENTRY && !name.startsWith(`${agent}local-packages/pi-model-router/`))) {
      blocked('private user-file read')();
    }
  };
  for (const [mod, keys] of [[fs, ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']], [fsp, ['readFile', 'open']]]) {
    for (const key of keys) {
      const original = mod[key];
      t.mock.method(mod, key, function (file, ...args) {
        checkRead(file);
        if ((key === 'open' || key === 'openSync') && args[0] !== 'r' && args[0] !== 0) blocked('writable open')();
        return original.call(this, file, ...args);
      });
    }
  }
  for (const [mod, keys] of [
    [fs, ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'unlink', 'unlinkSync', 'rename', 'renameSync', 'createWriteStream']],
    [fsp, ['writeFile', 'appendFile', 'mkdir', 'unlink', 'rename']],
  ]) for (const key of keys) t.mock.method(mod, key, blocked('filesystem write'));
  // jiti supports disabling disk compilation cache; no global/temp cache writes.
  const previous = process.env.JITI_FS_CACHE;
  process.env.JITI_FS_CACHE = 'false';
  syncBuiltinESMExports();
  t.after(() => {
    if (previous === undefined) delete process.env.JITI_FS_CACHE;
    else process.env.JITI_FS_CACHE = previous;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const { loadExtensions } = await import(LOADER);
  // Deliberately NOT discoverAndLoadExtensions, loadExtensionsCached, or createAgentSession.
  const result = await loadExtensions([ENTRY], '/synthetic/path');
  assert.deepEqual(result.errors, [], 'thin entry must load with the real installed Pi loader');
  assert.equal(result.extensions.length, 1);
  const extension = result.extensions[0];
  assert.equal(extension.path, ENTRY);
  assert.equal(extension.resolvedPath, ENTRY);
  assert.deepEqual([...extension.commands.keys()], ['route']);
  assert.equal(typeof extension.commands.get('route').handler, 'function');
  assert.deepEqual([...extension.handlers.keys()].sort(), [
    'input', 'model_select', 'session_shutdown', 'session_start', 'session_tree', 'thinking_level_select',
  ]);
  for (const handlers of extension.handlers.values()) {
    assert.equal(handlers.length, 1);
    assert.equal(typeof handlers[0], 'function');
  }
  for (const key of ['tools', 'flags', 'shortcuts', 'messageRenderers', 'entryRenderers']) assert.equal(extension[key].size, 0, key);
  assert.equal(extension.markdownTransformer, undefined);
  assert.deepEqual(result.runtime.pendingProviderRegistrations, []);
  assert.deepEqual(result.runtime.pendingNativeProviderRegistrations, []);

  // Exercise actual loaded callbacks using only synthetic context and runtime stubs.
  const actions = [];
  for (const name of ['setModel', 'setThinkingLevel', 'sendMessage', 'sendUserMessage', 'setActiveTools', 'appendEntry']) {
    result.runtime[name] = () => { actions.push(name); throw new Error(`Unexpected runtime action: ${name}`); };
  }
  result.runtime.getThinkingLevel = () => 'medium';
  const notices = [];
  const context = {
    mode: 'tui', hasUI: true, model: { provider: 'github-copilot', id: 'gpt-5.6-terra' },
    isIdle: () => true, sessionManager: { getBranch: () => [] },
    ui: { setStatus() {}, notify: text => notices.push(text), confirm: blocked('unexpected dialog') },
  };
  await extension.handlers.get('session_start')[0]({ type: 'session_start', reason: 'startup' }, context);
  await extension.commands.get('route').handler('status', context);
  assert.match(notices.join('\n'), /auto/);
  assert.match(notices.join('\n'), /gpt-5\.6-terra.*medium/);
  const input = { type: 'input', text: '继续', source: 'interactive' };
  const before = structuredClone(input);
  assert.deepEqual(await extension.handlers.get('input')[0](input, context), { action: 'continue' });
  assert.deepEqual(input, before);
  await extension.handlers.get('session_shutdown')[0]({ type: 'session_shutdown', reason: 'quit' }, context);
  assert.deepEqual(actions, [], 'no model switch/request, state writes, or tool changes in smoke flow');
  assert.deepEqual(violations, [], 'no network, process, filesystem write, auth, or user-session reads');
});
