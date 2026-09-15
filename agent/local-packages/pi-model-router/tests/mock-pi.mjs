import assert from 'node:assert/strict';
import factory from '../src/index.ts';

export const IDS = { luna: 'gpt-5.6-luna', terra: 'gpt-5.6-terra', sol: 'gpt-5.6-sol', astra: 'gpt-6-astra' };
export const models = Object.fromEntries(Object.entries(IDS).map(([tier, id]) => [tier, {
  id, provider: 'github-copilot', name: id, reasoning: true, input: ['text', 'image'],
  api: 'openai-responses', contextWindow: 128000, maxTokens: 32000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}]));
export const SIMPLE = '翻译成英文：早上好。';
export const ROUTINE = '实现一个读取 CSV 的函数';
export const COMPLEX = '进行跨模块重构';
export const CRITICAL = '执行安全审计并排查生产故障';
export const state = (overrides = {}) => ({ version: 1, mode: 'auto', seenRequest: false, asked: { sol: false, astra: false }, ...overrides });
export const entry = (data, id = 'route-state') => ({ type: 'custom', id, parentId: null, timestamp: '2026-09-14T00:00:00.000Z', customType: 'model-router:state', data: structuredClone(data) });
export const history = { type: 'message', id: 'old-user', parentId: null, timestamp: '2026-09-14T00:00:00.000Z', message: { role: 'user', content: 'old synthetic message', timestamp: 1 } };
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function tick() { await new Promise(resolve => setImmediate(resolve)); }
export async function until(predicate, label = 'async checkpoint') {
  for (let n = 0; n < 20 && !predicate(); n++) await tick();
  assert.ok(predicate(), label);
}
export function createMock(options = {}) {
  const h = {
    handlers: new Map(), commands: new Map(), calls: [], confirmations: [], notifications: [], statuses: new Map(), appended: [],
    model: options.model ?? models.terra, thinking: options.thinking ?? 'medium',
    branch: structuredClone(options.branch ?? []), otherEntries: structuredClone(options.otherEntries ?? []),
    idle: options.idle ?? true, pendingMessages: false, auth: options.auth ?? true,
    available: Object.values(models), missing: new Set(options.missing ?? []),
    confirmResult: options.confirmResult ?? false, confirmImpl: options.confirmImpl,
    setResult: options.setResult ?? true, setError: options.setError, setHook: undefined,
    thinkingError: options.thinkingError, clamp: options.clamp,
  };
  const forbidden = name => () => { throw new Error(`Forbidden model/context/side-effect API: ${name}`); };
  h.emit = async (name, event = {}) => {
    let result;
    for (const handler of h.handlers.get(name) ?? []) result = await handler({ type: name, ...event }, h.ctx);
    return result;
  };
  h.ctx = {
    mode: options.mode ?? 'tui', hasUI: options.hasUI ?? true, cwd: '/synthetic/project',
    get model() { return h.model; }, get thinkingLevel() { return h.thinking; },
    isIdle: () => h.idle, hasPendingMessages: () => h.pendingMessages,
    waitForIdle: forbidden('waitForIdle'), getSystemPrompt: forbidden('getSystemPrompt'),
    sessionManager: {
      getBranch: () => structuredClone(h.branch),
      getEntries: () => { h.calls.push(['getEntries']); return structuredClone([...h.branch, ...h.otherEntries]); },
      getSessionId: () => 'synthetic-session', getSessionFile: () => undefined,
      getLeafId: () => h.branch.at(-1)?.id ?? null,
      getHeader: () => ({ type: 'session', version: 3, id: 'synthetic-session' }),
    },
    modelRegistry: {
      find: (provider, id) => h.available.find(m => m.provider === provider && m.id === id && !h.missing.has(id)),
      getAll: () => h.available.filter(m => !h.missing.has(m.id)),
      getAvailable: () => h.auth ? h.available.filter(m => !h.missing.has(m.id)) : [],
      hasConfiguredAuth: () => h.auth,
      getProviderAuth: forbidden('getProviderAuth'), complete: forbidden('complete'), stream: forbidden('stream'),
    },
    ui: {
      confirm: async (title, message, opts) => {
        const call = { title, message, options: opts };
        h.confirmations.push(call);
        return h.confirmImpl ? h.confirmImpl(call) : h.confirmResult;
      },
      notify: (message, type) => h.notifications.push({ message: String(message), type }),
      setStatus: (key, value) => h.statuses.set(key, value),
    },
  };
  h.pi = {
    on: (name, handler) => h.handlers.set(name, [...(h.handlers.get(name) ?? []), handler]),
    registerCommand: (name, cmd) => h.commands.set(name, cmd),
    registerTool: forbidden('registerTool'), sendMessage: forbidden('sendMessage'), sendUserMessage: forbidden('sendUserMessage'),
    exec: forbidden('exec'), setActiveTools: forbidden('setActiveTools'),
    appendEntry: (customType, data) => {
      const item = { ...entry(data, `append-${h.appended.length}`), customType };
      h.appended.push(item); h.branch.push(item);
    },
    getThinkingLevel: () => { h.calls.push(['getThinkingLevel']); return h.thinking; },
    setThinkingLevel: level => {
      h.calls.push(['setThinkingLevel', level]);
      if (h.thinkingError) throw h.thinkingError;
      const previousLevel = h.thinking;
      h.thinking = h.clamp ?? level;
      void h.emit('thinking_level_select', { level: h.thinking, previousLevel });
    },
    setModel: async model => {
      h.calls.push(['setModel', model.id]);
      if (h.setHook) await h.setHook(model);
      if (h.setError) throw h.setError;
      if (!h.auth || !h.setResult) return false;
      const previousModel = h.model;
      h.model = model;
      // Pi emits model_select asynchronously while setModel is in progress.
      await Promise.resolve();
      await h.emit('model_select', { model, previousModel, source: 'set' });
      return true;
    },
  };
  const returned = factory(h.pi);
  assert.equal(returned?.then, undefined, 'factory must be synchronous');
  h.start = (reason = 'new') => h.emit('session_start', { reason });
  h.input = async (text = SIMPLE, extra = {}) => {
    const event = { type: 'input', text, source: 'interactive', ...extra };
    const before = structuredClone(event);
    let result;
    for (const fn of h.handlers.get('input') ?? []) result = await fn(event, h.ctx);
    assert.deepEqual(event, before, 'input event must not be mutated');
    assert.ok(result === undefined || result?.action === 'continue', 'original request must continue');
    if (result) assert.equal(result.text, undefined, 'no prompt rewriting');
    return result;
  };
  h.command = (args = '') => h.commands.get('route').handler(args, h.ctx);
  h.select = async (model, source = 'set') => {
    const previousModel = h.model; h.model = model;
    await h.emit('model_select', { model, previousModel, source });
  };
  h.manualThinking = async level => {
    const previousLevel = h.thinking; h.thinking = level;
    await h.emit('thinking_level_select', { level, previousLevel });
  };
  h.persisted = () => structuredClone(h.branch.filter(e => e.type === 'custom' && e.customType === 'model-router:state').at(-1)?.data);
  h.switches = () => h.calls.filter(([name]) => name === 'setModel').map(([, id]) => id);
  h.output = () => [...h.notifications.map(n => n.message), ...h.statuses.values()].join('\n');
  return h;
}
