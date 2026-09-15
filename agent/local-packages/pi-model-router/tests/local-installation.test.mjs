import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const AGENT = '/Users/liyi/.pi/agent';
// Literal expectations transcribed from the approved specification, not src constants.
export const APPROVED_IDS = [
  'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra',
  'gpt-5.3-codex', 'gpt-5.4-mini', 'gemini-3.8-flash', 'gpt-5.5',
  'grok-4.6', 'gpt-5-mini', 'gpt-5.4', 'mai-code-1.1-flash',
  'gemini-3.7-flash', 'gemini-3.6-flash', 'grok-4.5',
];
const APPROVED_THINKING = {
  'github-copilot/gpt-5.6-terra': 'medium',
  'github-copilot/gpt-5.6-luna': 'low',
  'github-copilot/gpt-5.6-sol': 'medium',
  'github-copilot/gpt-6-astra': 'medium',
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));

test('real settings: only approved fields changed; unrelated settings and prior thinking keys preserved', () => {
  const before = json(`${AGENT}/backups/model-router-20260914/settings.before.json`);
  const actual = json(`${AGENT}/settings.json`);
  const expected = {
    ...before,
    defaultProvider: 'github-copilot',
    defaultModel: 'gpt-5.6-terra',
    defaultThinkingLevel: 'medium',
    enabledModels: APPROVED_IDS.map(id => `github-copilot/${id}`),
    modelThinkingLevels: { ...before.modelThinkingLevels, ...APPROVED_THINKING },
  };
  // Compare every top-level value deeply, without dumping unrelated user settings on failure.
  const changedOutsideContract = [...new Set([...Object.keys(actual), ...Object.keys(expected)])]
    .filter(key => !Object.hasOwn(actual, key) || !Object.hasOwn(expected, key) ||
      !isDeepStrictEqual(actual[key], expected[key]));
  assert.deepEqual(changedOutsideContract, [], 'settings differ from the exact approved transformation');
});

test('real settings: exact default, ordered 15-model scope, and four per-model thinking defaults', () => {
  const settings = json(`${AGENT}/settings.json`);
  assert.equal(settings.defaultProvider, 'github-copilot');
  assert.equal(settings.defaultModel, 'gpt-5.6-terra');
  assert.equal(settings.defaultThinkingLevel, 'medium');
  assert.deepEqual(settings.enabledModels, APPROVED_IDS.map(id => `github-copilot/${id}`));
  assert.equal(settings.enabledModels.length, 15);
  assert.equal(new Set(settings.enabledModels).size, 15);
  for (const [key, thinking] of Object.entries(APPROVED_THINKING)) {
    assert.equal(settings.modelThinkingLevels[key], thinking, key);
  }
});

test('real models-store metadata: every approved ID exists uniquely under GitHub Copilot', () => {
  const models = json(`${AGENT}/models-store.json`)['github-copilot'].models;
  assert.ok(Array.isArray(models));
  for (const id of APPROVED_IDS) {
    const matches = models.filter(model => model.id === id);
    assert.equal(matches.length, 1, `${id}: one Copilot catalog entry required`);
    assert.equal(matches[0].provider, 'github-copilot', id);
  }
});

test('real four-tier metadata supports target thinking without clamping (real Pi pure capability helpers)', async () => {
  // This module is a pure catalog/capability utility: no ModelRegistry/AuthStorage/session construction.
  const { getSupportedThinkingLevels, clampThinkingLevel } = await import(
    '/Users/liyi/n/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.js'
  );
  const models = json(`${AGENT}/models-store.json`)['github-copilot'].models;
  for (const [key, thinking] of Object.entries(APPROVED_THINKING)) {
    const id = key.slice('github-copilot/'.length);
    const model = models.find(model => model.id === id);
    assert.ok(model, id);
    assert.equal(model.reasoning, true, id);
    assert.notEqual(model.thinkingLevelMap?.[thinking], null, `${id}: target explicitly unsupported`);
    assert.ok(getSupportedThinkingLevels(model).includes(thinking), `${id}: target not supported by Pi`);
    assert.equal(clampThinkingLevel(model, thinking), thinking, `${id}: target would be clamped`);
    assert.equal(model.thinkingLevelMap[thinking], thinking, `${id}: exact provider effort mapping`);
  }
});
