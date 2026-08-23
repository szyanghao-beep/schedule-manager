/*
 * ai.test.js — C1 混合解析（规则优先 + LLM 兜底）测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../ai/index.js');

const NOW = new Date('2026-08-17T12:00:00').getTime();
const AI = { enabled: true, provider: 'ollama', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b' };

// 构造一个记录调用次数的 mock LLM 调用
function spy(resolveWith) {
  const spyObj = { calls: 0 };
  spyObj.fn = async function () { spyObj.calls++; return resolveWith; };
  return spyObj;
}

test('AI 未启用：不调用 LLM，直接返回规则结果', async function () {
  const s = spy('不应被调用');
  const r = await ai.parseQuickCapture('明天下午3点开会', {
    ai: { enabled: false, endpoint: '', model: '' }, apiKey: '', categories: [], now: NOW, llmCall: s.fn,
  });
  assert.strictEqual(s.calls, 0);
  assert.strictEqual(r.kind, 'todo');
  assert.notStrictEqual(r.deadline, null);
});

test('规则已命中时间：即使 AI 启用也不调用 LLM', async function () {
  const s = spy('不应被调用');
  const r = await ai.parseQuickCapture('周五提交周报', {
    ai: AI, apiKey: '', categories: [], now: NOW, llmCall: s.fn,
  });
  assert.strictEqual(s.calls, 0);
  assert.notStrictEqual(r.deadline, null);
});

test('规则无时间 + AI 启用：调用 LLM 并合并结果', async function () {
  const s = spy(JSON.stringify({
    title: '和客户开会', kind: 'event',
    startTime: '2026-08-18T15:00:00', endTime: '2026-08-18T16:00:00',
    priority: 'high',
  }));
  const r = await ai.parseQuickCapture('和客户开个会', {
    ai: AI, apiKey: 'k', categories: [], now: NOW, llmCall: s.fn,
  });
  assert.strictEqual(s.calls, 1);
  assert.strictEqual(r.kind, 'event');
  assert.strictEqual(r.title, '和客户开会');
  assert.strictEqual(r.priority, 'high');
  assert.notStrictEqual(r.startTime, null);
  assert.notStrictEqual(r.endTime, null);
  assert.strictEqual(r.confidence, 0.9);
});

test('LLM 返回非法 JSON：回退规则结果', async function () {
  const s = spy('这不是 JSON，随便说点啥');
  const r = await ai.parseQuickCapture('买牛奶', {
    ai: AI, apiKey: 'k', categories: [], now: NOW, llmCall: s.fn,
  });
  assert.strictEqual(s.calls, 1);
  assert.strictEqual(r.kind, 'todo');
  assert.strictEqual(r.title, '买牛奶');
  assert.strictEqual(r.deadline, null);
});

test('LLM 调用抛异常：回退规则结果', async function () {
  const boom = { calls: 0, fn: async function () { boom.calls++; throw new Error('connection refused'); } };
  const r = await ai.parseQuickCapture('整理收件箱', {
    ai: AI, apiKey: 'k', categories: [], now: NOW, llmCall: boom.fn,
  });
  assert.strictEqual(boom.calls, 1);
  assert.strictEqual(r.title, '整理收件箱');
  assert.strictEqual(r.kind, 'todo');
  assert.strictEqual(r.deadline, null);
});

test('parseLlmJson：容忍 markdown 代码块包裹', function () {
  const r = ai.parseLlmJson('```json\n{"title":"写周报"}\n```');
  assert.deepStrictEqual(r, { title: '写周报' });
  assert.strictEqual(ai.parseLlmJson('没有花括号'), null);
  assert.strictEqual(ai.parseLlmJson(''), null);
});
