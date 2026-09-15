import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/policy.ts';

// Expected categories come from the approved design, not production regexes.
const cases = {
  continue: ['', '   ', '继续', '好的', '2', '继续。', 'ok', 'Continue', 'yes'],
  simple: [
    '翻译成英文：早上好。', 'Translate to Chinese: Good morning.',
    '润色这句话：期待你的回复。', 'Polish this sentence: I look forward to your reply.',
    '解释术语：光合作用', 'Explain the term photosynthesis.',
    '简短摘要：今天晴天，我们去公园散步。', 'Summarize briefly: The meeting starts at noon.',
  ],
  routine: [
    '实现一个读取 CSV 的函数', 'Implement a CSV parser.',
    '帮我看看这个问题', 'Can you help me with this task?',
    '修复按钮的一个小问题', 'Fix a small bug in the button.',
  ],
  complex: [
    '进行跨模块重构', 'Refactor across multiple modules.',
    '为这个服务做系统设计', 'Create a system design for the service.',
    '排查难以复现的问题', 'Debug an intermittent hard-to-reproduce issue.',
  ],
  critical: [
    '执行安全审计', 'Perform a security audit.',
    '排查生产故障', 'Investigate a production outage.',
    '深度排查并发和数据一致性问题', 'Investigate race conditions and data consistency.',
    '系统设计与安全审计', 'System design and security audit.',
  ],
};
for (const [expected, texts] of Object.entries(cases)) {
  for (const text of texts) test(`classify ${expected}: ${JSON.stringify(text)}`, () => {
    const result = classify(text);
    assert.equal(result.kind, expected);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.trim().length > 0, 'local-rule reason must be present');
    assert.deepEqual(classify(text), result, 'classification is deterministic');
  });
}

const neverSimple = [
  ['Translate this code:\n```js\nconst n = 1;\n```', false],
  ['翻译：```js\nconst n = 1;\n```', false],
  ['Summarize @src/index.ts', false],
  ['简短摘要：./src/index.ts', false],
  ['Explain the attached picture.', true],
  ['翻译成英文：早上好。', true],
  ['Explain how to modify the parser.', false],
  ['解释这个调试问题', false],
  ['Summarize the architecture.', false],
  ['解释安全机制', false],
  ['Translate: ' + 'This is a long passage. '.repeat(120), false],
];
for (const [text, images] of neverSimple) test(`risk/attachment/length blocks Luna: ${text.slice(0, 65)}`, () => {
  assert.notEqual(classify(text, images).kind, 'simple');
});
for (const text of ['简短摘要：生产故障与系统设计', 'Translate: production outage and system design.']) {
  test(`critical wins over simple and complex: ${text}`, () => {
    assert.equal(classify(text).kind, 'critical');
    assert.equal(classify(text, true).kind, 'critical');
  });
}
