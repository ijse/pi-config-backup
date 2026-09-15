import test from 'node:test';
import assert from 'node:assert/strict';
import { createMock, IDS, SIMPLE, COMPLEX, CRITICAL, ROUTINE, models } from './mock-pi.mjs';

for (const [label, failAt, request, expectedSwitches, expectedModel] of [
  ['first substantive state save', 1, SIMPLE, [], models.terra],
  ['upgrade asked-flag save', 2, COMPLEX, [], models.terra],
  ['post-switch state save', 2, SIMPLE, [IDS.luna], models.luna],
]) test(`appendEntry failure locks automation: ${label}`, async () => {
  const h = createMock({ confirmResult: true });
  let attempts = 0;
  const append = h.pi.appendEntry;
  h.pi.appendEntry = (...args) => {
    if (++attempts === failAt) throw new Error('SYNTHETIC_DISK_FAILURE_NOT_FOR_DISPLAY');
    return append(...args);
  };
  await h.start();
  await h.input(request);
  assert.deepEqual(h.switches(), expectedSwitches);
  assert.deepEqual(h.model, expectedModel);
  assert.equal(h.confirmations.length, 0, 'unsaved consent must not be requested');
  assert.ok(h.notifications.some(n => n.type === 'warning' && /状态.*保存失败/.test(n.message)));
  await h.command('status');
  assert.match(h.notifications.at(-1).message, /locked/);
  assert.doesNotMatch(h.output(), /SYNTHETIC_DISK_FAILURE_NOT_FOR_DISPLAY/);
  const writesAtLock = attempts;
  await h.input(CRITICAL); await h.input(ROUTINE); await h.input(SIMPLE);
  assert.deepEqual(h.switches(), expectedSwitches, 'locked automation must never switch again');
  assert.equal(h.confirmations.length, 0);
  assert.equal(attempts, writesAtLock, 'no repeated persistence attempts from later ordinary input');
  await h.command('reset');
  assert.equal(h.model.id, IDS.terra);
  assert.equal(h.thinking, 'medium');
  assert.equal(h.persisted().mode, 'auto', 'explicit reset can reauthorize after storage recovers');
});

for (const boundary of ['provider switch', 'thinking setter', 'confirmation UI']) {
  test(`${boundary} exceptions never expose raw message/stack to notifications, logs or persisted state`, async t => {
    // Entirely synthetic canary, never an actual credential.
    const marker = 'SYNTHETIC_EXCEPTION_CANARY_98371';
    const error = new Error(marker);
    error.stack = `SYNTHETIC_STACK_${marker}`;
    const logs = [];
    for (const name of ['log', 'error', 'warn', 'info', 'debug']) t.mock.method(console, name, (...args) => logs.push(args));
    const options = boundary === 'provider switch' ? { setError: error } :
      boundary === 'thinking setter' ? { thinkingError: error } :
      { confirmImpl: async () => { throw error; } };
    const h = createMock(options);
    await h.start();
    await h.input(boundary === 'confirmation UI' ? COMPLEX : SIMPLE);
    assert.ok(h.notifications.some(n => n.type === 'warning'), 'safe generic failure still disclosed');
    assert.ok(!JSON.stringify([h.output(), h.appended, h.confirmations, logs]).includes(marker), 'raw exception text must not escape');
    assert.equal(h.model.id, boundary === 'thinking setter' ? IDS.luna : IDS.terra);
  });
}
