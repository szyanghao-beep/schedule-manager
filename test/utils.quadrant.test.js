/*
 * utils.quadrant.test.js — 四象限（艾森豪威尔矩阵）纯函数测试
 */
const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../shared/utils.js');

const H = 3600000;

test('calcQuadrant 重要 + 无截止时间 → Q2 重要不紧急', function () {
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: null }), 'q2');
});

test('calcQuadrant 重要 + 临近截止 → Q1 重要且紧急', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: now + 1 * H }, now, 24 * H), 'q1');
});

test('calcQuadrant 重要 + 远期截止 → Q2', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: now + 48 * H }, now, 24 * H), 'q2');
});

test('calcQuadrant 不重要 + 临近截止 → Q3', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ importance: 'not_important', deadline: now + 1 * H }, now, 24 * H), 'q3');
});

test('calcQuadrant 不重要 + 无截止 → Q4', function () {
  assert.strictEqual(Utils.calcQuadrant({ importance: 'not_important', deadline: null }), 'q4');
});

test('calcQuadrant 已逾期视为紧急', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: now - 1000 }, now, 24 * H), 'q1');
});

test('calcQuadrant 缺省重要性视为重要', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ deadline: null }, now, 24 * H), 'q2');
});

test('calcQuadrant 阈值边界：now == deadline - 阈值 算紧急', function () {
  const now = Date.now();
  const deadline = now + 24 * H;
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: deadline }, now, 24 * H), 'q1');
});

test('calcQuadrantStats 仅统计未完成待办并按象限计数', function () {
  const now = Date.now();
  const todos = [
    { id: 'a', status: 'pending', importance: 'important', deadline: now + 1 * H },    // q1
    { id: 'b', status: 'pending', importance: 'important', deadline: null },            // q2
    { id: 'c', status: 'pending', importance: 'not_important', deadline: now + 1 * H }, // q3
    { id: 'd', status: 'pending', importance: 'not_important', deadline: null },        // q4
    { id: 'e', status: 'done', importance: 'important', deadline: now + 1 * H },        // 已完成不统计
  ];
  const s = Utils.calcQuadrantStats(todos, now, 24 * H);
  assert.deepStrictEqual(s, { q1: 1, q2: 1, q3: 1, q4: 1, total: 4 });
});

test('calcQuadrantStats 空数组返回全 0', function () {
  assert.deepStrictEqual(Utils.calcQuadrantStats([], Date.now(), 24 * H), { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 });
});

test('calcQuadrant 自定义阈值：48 小时内视为紧急', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: now + 40 * H }, now, 48 * H), 'q1');
  assert.strictEqual(Utils.calcQuadrant({ importance: 'important', deadline: now + 40 * H }, now, 24 * H), 'q2');
});

test('calcQuadrant 不重要 + 已逾期 → Q3', function () {
  const now = Date.now();
  assert.strictEqual(Utils.calcQuadrant({ importance: 'not_important', deadline: now - 1000 }, now, 24 * H), 'q3');
});

test('calcQuadrantStats 只跳过 done，进行中/未开始计入', function () {
  const now = Date.now();
  const todos = [
    { id: 'a', status: 'doing', importance: 'important', deadline: now + 1 * H },
    { id: 'b', status: 'pending', importance: 'important', deadline: null },
    { id: 'c', status: 'done', importance: 'important', deadline: now + 1 * H },
  ];
  const s = Utils.calcQuadrantStats(todos, now, 24 * H);
  assert.strictEqual(s.total, 2);
  assert.strictEqual(s.q1, 1);
  assert.strictEqual(s.q2, 1);
});
