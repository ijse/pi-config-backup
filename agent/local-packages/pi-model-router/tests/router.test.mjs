import test from 'node:test';
import assert from 'node:assert/strict';
import { createMock, models, IDS, SIMPLE, ROUTINE, COMPLEX, CRITICAL, state, entry, history, deferred, until, tick } from './mock-pi.mjs';

const checkModel = (h, tier, thinking) => {
  assert.equal(h.model.id, IDS[tier]);
  assert.equal(h.model.provider, 'github-copilot');
  if (thinking) assert.equal(h.thinking, thinking);
};
const assertNoChange = (h, before = models.terra) => {
  assert.deepEqual(h.model, before);
  assert.deepEqual(h.switches(), []);
  assert.equal(h.confirmations.length, 0);
};
async function fresh(options) { const h = createMock(options); await h.start(); return h; }

// Registration, eligibility, and first-request boundaries.
test('registers only /route, required events, and no LLM tools or prompt injection hooks', () => {
  const h = createMock();
  assert.deepEqual([...h.commands.keys()], ['route']);
  for (const name of ['input', 'session_start', 'session_tree', 'model_select', 'session_shutdown', 'thinking_level_select']) {
    assert.equal(h.handlers.get(name)?.length, 1, `${name} is registered once`);
  }
  for (const name of ['before_agent_start', 'context', 'before_provider_request']) assert.equal(h.handlers.has(name), false);
});

test('first independent simple request lowers default Terra to Luna/low', async () => {
  const h = await fresh();
  await h.input(SIMPLE);
  checkModel(h, 'luna', 'low');
  assert.deepEqual(h.switches(), [IDS.luna]);
  assert.deepEqual(h.persisted(), state({ seenRequest: true }));
  const setAt = h.calls.findIndex(([name]) => name === 'setModel');
  const thinkAt = h.calls.findIndex(([name]) => name === 'setThinkingLevel');
  assert.ok(thinkAt > setAt, 'thinking is applied after model change');
  assert.ok(h.calls.slice(thinkAt + 1).some(([name]) => name === 'getThinkingLevel'), 'read back actual thinking after setting');
});

test('continuations do not consume the first independent request', async () => {
  const h = await fresh();
  for (const text of ['继续', '好的', '2', 'ok']) await h.input(text);
  assertNoChange(h);
  await h.input(SIMPLE);
  checkModel(h, 'luna', 'low');
});

test('routine first request prevents a later simple request from lowering Terra', async () => {
  const h = await fresh();
  await h.input(ROUTINE); await h.input(SIMPLE); await h.input('继续');
  assertNoChange(h);
  assert.equal(h.persisted().seenRequest, true);
});

test('Luna keeps simple and continuation requests, returns to Terra on substantive coding, then stays there', async () => {
  const h = await fresh();
  await h.input(SIMPLE); await h.input('继续'); await h.input(SIMPLE);
  assert.deepEqual(h.switches(), [IDS.luna]);
  await h.input(ROUTINE); checkModel(h, 'terra', 'medium');
  await h.input(SIMPLE);
  assert.deepEqual(h.switches(), [IDS.luna, IDS.terra]);
  assert.equal(h.persisted().mode, 'auto', 'self model_select must not lock');
});

test('image-bearing simple request cannot lower Terra', async () => {
  const h = await fresh();
  await h.input(SIMPLE, { images: [{ type: 'image', data: 'synthetic', mimeType: 'image/png' }] });
  assertNoChange(h);
  await h.input(SIMPLE); assertNoChange(h);
});

for (const [label, options, extra] of [
  ['RPC even with UI', { mode: 'rpc', hasUI: true }, {}],
  ['print', { mode: 'print', hasUI: false }, {}],
  ['JSON', { mode: 'json', hasUI: false }, {}],
  ['TUI without UI', { hasUI: false }, {}],
  ['agent busy/retry/compaction', { idle: false }, {}],
  ['RPC input source', {}, { source: 'rpc' }],
  ['extension-injected input', {}, { source: 'extension' }],
  ['steering', {}, { streamingBehavior: 'steer' }],
  ['queued follow-up', {}, { streamingBehavior: 'followUp' }],
]) test(`ineligible ${label}: neither routing nor dialog nor consumed first request`, async () => {
  // Restore explicit auto permission so this tests input eligibility, not
  // whether a non-TUI startup should enable auto in the first place.
  const h = await fresh({ ...options, branch: [entry(state())] });
  await h.input(SIMPLE, extra); await h.input(CRITICAL, extra);
  assertNoChange(h);
  h.ctx.mode = 'tui'; h.ctx.hasUI = true; h.idle = true;
  await h.input(SIMPLE);
  checkModel(h, 'luna');
});
for (const text of ['/help', '/skill:security-audit', '  /template system design']) test(`slash input stays untouched: ${text}`, async () => {
  const h = await fresh(); await h.input(text); assertNoChange(h);
  await h.input(SIMPLE); checkModel(h, 'luna');
});

// Upgrade confirmation and stable model/task lifetime.
for (const [text, tier] of [[COMPLEX, 'sol'], [CRITICAL, 'astra']]) {
  test(`explicit true upgrades to ${tier}, includes disclosures and keeps upgraded tier`, async () => {
    const h = await fresh({ confirmResult: true });
    await h.input(text); checkModel(h, tier, 'medium');
    assert.equal(h.confirmations.length, 1);
    const call = h.confirmations[0];
    const prompt = `${call.title}\n${call.message}`;
    assert.match(prompt, /terra/i); assert.match(prompt, new RegExp(tier, 'i'));
    assert.match(prompt, /medium/i); assert.match(prompt, /用量|usage|cost/i);
    assert.match(prompt, /规则|原因|匹配|reason|rule/i);
    assert.equal(call.options?.timeout, 60000, 'Pi owns the 60-second timer; mock does not sleep');
    assert.equal(h.persisted().asked[tier], true);
    assert.match(h.output(), /\/route reset/);
    await h.input(SIMPLE); await h.input(ROUTINE); await h.input('继续'); await h.input(CRITICAL);
    checkModel(h, tier); assert.deepEqual(h.switches(), [IDS[tier]]);
    assert.equal(h.confirmations.length, 1, 'approved expensive tier stays until reset/manual change');
  });
}
for (const [label, result] of [['decline / timeout false', false], ['closed undefined', undefined], ['closed null', null], ['truthy non-boolean', 'yes']]) {
  test(`upgrade ${label} keeps original model and asks at most once`, async () => {
    const h = await fresh({ confirmImpl: async () => result });
    await h.input(COMPLEX); await h.input(COMPLEX); await h.input(SIMPLE);
    checkModel(h, 'terra'); assert.deepEqual(h.switches(), []);
    assert.equal(h.confirmations.length, 1); assert.equal(h.confirmations[0].options?.timeout, 60000);
    assert.equal(h.persisted().asked.sol, true);
  });
}
test('UI confirmation exception is safe; candidate is still marked asked', async () => {
  const h = await fresh({ confirmImpl: async () => { throw new Error('synthetic UI failure'); } });
  await h.input(COMPLEX); await h.input(COMPLEX);
  checkModel(h, 'terra'); assert.equal(h.confirmations.length, 1);
  assert.equal(h.persisted().asked.sol, true);
});
test('Sol refusal permits one distinct Astra suggestion; both flags reset only on new task', async () => {
  const h = await fresh();
  await h.input(COMPLEX); await h.input(CRITICAL); await h.input(COMPLEX); await h.input(CRITICAL);
  assert.equal(h.confirmations.length, 2);
  assert.deepEqual(h.persisted().asked, { sol: true, astra: true });
  await h.command('reset');
  assert.deepEqual(h.persisted(), state()); checkModel(h, 'terra', 'medium');
  await h.input(COMPLEX); assert.equal(h.confirmations.length, 3);
});
test('mixed risk and complexity suggests only Astra', async () => {
  const h = await fresh({ confirmResult: true });
  await h.input('简短摘要：系统设计与生产故障');
  checkModel(h, 'astra'); assert.equal(h.confirmations.length, 1);
  assert.deepEqual(h.persisted().asked, { sol: false, astra: true });
});
test('Luna can upgrade to explicitly confirmed Sol', async () => {
  const h = await fresh({ confirmResult: true });
  await h.input(SIMPLE); await h.input(COMPLEX);
  checkModel(h, 'sol'); assert.equal(h.confirmations.length, 1);
});

// Failure handling: no silent fallback and no false effective state.
for (const [label, options] of [
  ['target missing', { missing: [IDS.luna] }],
  ['configured authentication absent', { auth: false }],
  ['setModel false', { setResult: false }],
  ['setModel throws', { setError: new Error('synthetic switch failure') }],
]) test(`automatic Luna failure: ${label}`, async () => {
  const h = await fresh(options);
  await h.input(SIMPLE); checkModel(h, 'terra', 'medium');
  assert.ok(h.switches().every(id => id === IDS.luna), 'no fallback candidate');
  assert.equal(h.calls.filter(([name]) => name === 'setThinkingLevel').length, 0);
  assert.ok(h.notifications.length > 0, 'failure is disclosed');
  assert.equal(h.persisted().mode, 'auto');
});
for (const [label, options] of [
  ['missing', { missing: [IDS.sol] }], ['auth absent', { auth: false }],
  ['false', { setResult: false }], ['throws', { setError: new Error('synthetic') }],
]) test(`confirmed expensive switch failure ${label} never falls back`, async () => {
  const h = await fresh({ ...options, confirmResult: true });
  await h.input(COMPLEX); checkModel(h, 'terra');
  assert.ok(h.switches().every(id => id === IDS.sol));
  assert.ok(h.notifications.length > 0);
});
for (const [label, options, actual] of [
  ['clamped', { clamp: 'minimal' }, 'minimal'],
  ['setting throws', { thinkingError: new Error('synthetic thinking failure') }, 'medium'],
]) test(`partial switch ${label} reports actual model/thinking, not complete success`, async () => {
  const h = await fresh(options);
  await h.input(SIMPLE); checkModel(h, 'luna', actual);
  const warnings = h.notifications.filter(n => n.type === 'warning' || n.type === 'error').map(n => n.message).join('\n');
  assert.match(warnings, /luna/i); assert.match(warnings, new RegExp(actual, 'i'));
  await h.command('status'); assert.match(h.output(), new RegExp(actual, 'i'));
});

// Commands and external model/thinking changes.
for (const tier of ['luna', 'terra', 'sol', 'astra']) test(`/route ${tier} selects requested tier and locks`, async () => {
  const h = await fresh({ confirmResult: true });
  await h.command(tier); checkModel(h, tier, tier === 'luna' ? 'low' : 'medium');
  assert.equal(h.persisted().mode, 'locked');
  assert.equal(h.confirmations.length, ['sol', 'astra'].includes(tier) ? 1 : 0);
  const switches = [...h.switches()];
  await h.input(SIMPLE); await h.input(CRITICAL);
  assert.deepEqual(h.switches(), switches);
});
for (const tier of ['sol', 'astra']) test(`/route ${tier} always confirms, cancellation preserves state`, async () => {
  const h = await fresh({ branch: [entry(state({ seenRequest: true }))] });
  const before = h.persisted();
  await h.command(tier); await h.command(tier);
  assert.equal(h.confirmations.length, 2); assert.deepEqual(h.persisted(), before);
  assert.deepEqual(h.switches(), []);
});
for (const cmd of ['auto', 'reset']) test(`/route ${cmd} authorizes fresh Terra task from locked other provider`, async () => {
  const other = { ...models.sol, provider: 'other-provider', id: 'other-model' };
  const h = await fresh({ model: other, thinking: 'high' });
  await h.command(cmd); checkModel(h, 'terra', 'medium'); assert.deepEqual(h.persisted(), state());
  await h.input(SIMPLE); checkModel(h, 'luna');
});
for (const options of [{ setResult: false }, { missing: [IDS.terra] }, { auth: false }]) test(`/route auto failure does not authorize auto (${JSON.stringify(options)})`, async () => {
  const h = await fresh({ ...options, model: models.sol, branch: [entry(state({ mode: 'locked' }))] });
  await h.command('auto'); checkModel(h, 'sol'); assert.notEqual(h.persisted().mode, 'auto');
});
test('/route off does not change model; no later input is routed', async () => {
  const h = await fresh(); await h.input(SIMPLE);
  await h.command('off'); checkModel(h, 'luna', 'low'); assert.equal(h.persisted().mode, 'off');
  await h.input(CRITICAL); await h.input(ROUTINE);
  assert.deepEqual(h.switches(), [IDS.luna]); assert.equal(h.confirmations.length, 0);
});
for (const arg of ['', 'status']) test(`/route ${arg} reports actual model/thinking/mode/asked and help without switching`, async () => {
  const h = await fresh({ branch: [entry(state({ seenRequest: true, asked: { sol: true, astra: false } }))], thinking: 'high' });
  await h.command(arg);
  assertNoChange(h); const output = h.output();
  for (const re of [/auto/, /terra/i, /high/, /sol/i, /astra/i, /\/route/, /询问|asked/i]) assert.match(output, re);
});
test('invalid command only displays help, never changes model', async () => {
  const h = await fresh(); await h.command('not-a-tier'); assertNoChange(h); assert.match(h.output(), /route/i);
});
for (const cmd of ['auto', 'reset', 'luna', 'terra', 'sol', 'astra', 'off']) test(`busy /route ${cmd} is rejected, never deferred`, async () => {
  const h = await fresh({ idle: false, branch: [entry(state())] });
  const before = h.persisted(); await h.command(cmd);
  assertNoChange(h); assert.deepEqual(h.persisted(), before);
  h.idle = true; await tick(); assertNoChange(h);
});
for (const cmd of ['auto', 'reset', 'luna', 'terra', 'sol', 'astra']) test(`without UI /route ${cmd} is rejected`, async () => {
  const h = await fresh({ mode: 'print', hasUI: false, branch: [entry(state({ mode: 'off' }))] });
  await h.command(cmd); assertNoChange(h); assert.equal(h.persisted().mode, 'off');
});
test('without UI status/off remain available without model or confirmation calls', async () => {
  const h = await fresh({ mode: 'print', hasUI: false });
  await h.command('status'); await h.command('off'); assertNoChange(h); assert.equal(h.persisted().mode, 'off');
});
for (const source of ['set', 'cycle']) test(`external model_select ${source} locks and is never overridden`, async () => {
  const h = await fresh(); await h.select(models.luna, source);
  await h.input(ROUTINE); await h.input(CRITICAL);
  assertNoChange(h, models.luna); assert.equal(h.persisted().mode, 'locked');
});
test('restore model_select is not treated as manual model choice', async () => {
  const h = await fresh(); await h.select(models.terra, 'restore');
  await h.input(SIMPLE); checkModel(h, 'luna'); assert.equal(h.persisted().mode, 'auto');
});
test('manual thinking changes persist across messages, until next authorized switch', async () => {
  const h = await fresh(); await h.input(SIMPLE); await h.manualThinking('high');
  await h.input(SIMPLE); await h.input('继续'); checkModel(h, 'luna', 'high');
  await h.input(ROUTINE); checkModel(h, 'terra', 'medium');
});

// Stale async work and mutual exclusion. Deferred promises avoid real timers.
for (const action of ['off', 'manual-model', 'shutdown', 'tree', 'busy']) test(`old confirmation true is invalid after ${action}`, async () => {
  const wait = deferred(); const h = await fresh({ confirmImpl: () => wait.promise });
  const pending = h.input(COMPLEX); await until(() => h.confirmations.length === 1, 'confirmation started');
  if (action === 'off') await h.command('off');
  if (action === 'manual-model') await h.select(models.luna);
  if (action === 'shutdown') await h.emit('session_shutdown', { reason: 'reload' });
  if (action === 'tree') { h.branch = [history, entry(state({ mode: 'locked' }))]; await h.emit('session_tree', { newLeafId: 'other' }); }
  if (action === 'busy') h.idle = false;
  wait.resolve(true); await pending;
  assert.deepEqual(h.switches(), [], 'stale approval must not switch');
  checkModel(h, action === 'manual-model' ? 'luna' : 'terra');
});
test('concurrent inputs cannot create two confirmation flows or concurrent switches', async () => {
  const wait = deferred(); const h = await fresh({ confirmImpl: () => wait.promise });
  const first = h.input(COMPLEX); await until(() => h.confirmations.length === 1);
  const second = h.input(CRITICAL); await tick();
  assert.equal(h.confirmations.length, 1);
  wait.resolve(true); await Promise.all([first, second]);
  assert.equal(h.confirmations.length, 1);
  // A newer input may conservatively invalidate the first approval; the
  // contract requires mutual exclusion, not an obligatory stale switch.
  assert.ok(h.switches().length <= 1);
  assert.ok(h.switches().every(id => id === IDS.sol));
});
test('concurrent expensive command cannot overlap an automatic confirmation', async () => {
  const wait = deferred(); const h = await fresh({ confirmImpl: () => wait.promise });
  const first = h.input(COMPLEX); await until(() => h.confirmations.length === 1);
  const command = h.command('astra'); await tick(); assert.equal(h.confirmations.length, 1);
  wait.resolve(true); await Promise.all([first, command]);
  assert.ok(h.switches().length <= 1, 'one switch at most');
  assert.equal(h.confirmations.length, 1);
});
test('two simultaneous first simple inputs cannot race duplicate model switches', async () => {
  const wait = deferred(); const h = await fresh(); h.setHook = () => wait.promise;
  const one = h.input(SIMPLE); await until(() => h.switches().length === 1);
  const two = h.input(SIMPLE); await tick(); assert.equal(h.switches().length, 1);
  wait.resolve(); await Promise.all([one, two]);
  assert.deepEqual(h.switches(), [IDS.luna]);
});

// Persistence belongs to current branch, with no raw prompts or model overrides.
test('persisted entries contain only the versioned compact state, never raw user input', async () => {
  const h = await fresh(); const uniquePrompt = '执行安全审计 UNIQUE_PROMPT_DO_NOT_PERSIST_473';
  await h.input(uniquePrompt); await h.command('off');
  assert.ok(h.appended.length > 0);
  for (const e of h.appended) {
    assert.equal(e.customType, 'model-router:state');
    assert.deepEqual(Object.keys(e.data).sort(), ['asked', 'mode', 'seenRequest', 'version']);
    assert.deepEqual(Object.keys(e.data.asked).sort(), ['astra', 'sol']);
    assert.equal(e.data.version, 1); assert.equal(typeof e.data.seenRequest, 'boolean');
    assert.equal(typeof e.data.asked.sol, 'boolean'); assert.equal(typeof e.data.asked.astra, 'boolean');
  }
  assert.ok(!JSON.stringify(h.appended).includes(uniquePrompt));
});
for (const reason of ['startup', 'reload', 'resume', 'fork']) test(`restore ${reason} respects branch asked state and actual model`, async () => {
  const h = createMock({ branch: [history, entry(state({ seenRequest: true, asked: { sol: true, astra: false } }))] });
  await h.start(reason); assert.deepEqual(h.switches(), []);
  await h.input(COMPLEX); await h.input(SIMPLE); assertNoChange(h);
  await h.input(CRITICAL); assert.equal(h.confirmations.length, 1);
});
for (const mode of ['off', 'locked']) test(`restored ${mode} mode does not route`, async () => {
  const h = await fresh({ branch: [history, entry(state({ mode }))] });
  await h.input(SIMPLE); await h.input(CRITICAL); assertNoChange(h);
});
test('existing session without routing state is locked until explicit /route auto', async () => {
  const h = await fresh({ branch: [history] });
  await h.input(SIMPLE); await h.input(CRITICAL); assertNoChange(h);
  await h.command('auto'); await h.input(SIMPLE); checkModel(h, 'luna');
});
for (const model of [models.luna, models.sol, models.astra, { ...models.terra, provider: 'another-provider' }, { ...models.terra, id: 'unmanaged-id' }]) {
  test(`blank session with explicit ${model.provider}/${model.id} starts locked`, async () => {
    const h = await fresh({ model }); await h.input(SIMPLE); await h.input(CRITICAL); assertNoChange(h, model);
  });
}
test('blank Terra session with only metadata/model/thinking entries can auto-route', async () => {
  const h = await fresh({ branch: [
    { type: 'model_change', id: 'm', provider: 'github-copilot', modelId: IDS.terra },
    { type: 'thinking_level_change', id: 't', thinkingLevel: 'medium' },
    { type: 'session_info', id: 'i', name: 'blank synthetic session' },
  ] });
  await h.input(SIMPLE); checkModel(h, 'luna');
});
test('getBranch, never all branches, controls restored permission', async () => {
  const h = await fresh({ branch: [history, entry(state({ mode: 'off' }), 'active')], otherEntries: [entry(state(), 'other-auto')] });
  await h.input(SIMPLE); await h.input(CRITICAL); assertNoChange(h);
  assert.equal(h.calls.filter(([name]) => name === 'getEntries').length, 0, 'all-branch API must not authorize routing');
});
test('tree navigation restores selected branch instead of inheriting current permission', async () => {
  const h = await fresh(); await h.input(COMPLEX); assert.equal(h.confirmations.length, 1);
  const askedBranch = structuredClone(h.branch);
  h.branch = [history, entry(state({ mode: 'off' }))]; await h.emit('session_tree', { newLeafId: 'off-leaf' });
  await h.input(CRITICAL); assert.equal(h.confirmations.length, 1);
  h.branch = askedBranch; await h.emit('session_tree', { newLeafId: 'auto-leaf' });
  await h.input(COMPLEX); assert.equal(h.confirmations.length, 1);
  await h.input(CRITICAL); assert.equal(h.confirmations.length, 2);
  assert.deepEqual(h.switches(), [], 'tree restore must never forcibly set model');
});
for (const bad of [
  null, {}, { ...state(), version: 2 }, { ...state(), mode: 'invalid' },
  { ...state(), seenRequest: 'false' }, { ...state(), asked: null },
  { ...state(), asked: { sol: false } }, { ...state(), asked: { sol: 'true', astra: false } },
]) test(`invalid newest state conservatively locks: ${JSON.stringify(bad)}`, async () => {
  const h = await fresh({ branch: [entry(state(), 'older-valid'), entry(bad, 'newer-invalid')] });
  await h.input(SIMPLE); await h.input(CRITICAL); assertNoChange(h);
});
test('restored auto record cannot automatically move an unmanaged provider/model', async () => {
  const other = { ...models.terra, provider: 'another-provider' };
  const h = await fresh({ model: other, branch: [entry(state())] });
  await h.input(SIMPLE); await h.input(CRITICAL); assertNoChange(h, other);
});
