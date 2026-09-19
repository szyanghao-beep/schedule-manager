/*
 * inbox.test.js — 手机收集 → 电脑收件箱 合并逻辑测试
 * 覆盖：条目规范化（无截止时间=收件箱语义）、幂等去重、边界与统计。
 */
const test = require('node:test');
const assert = require('node:assert');
const inbox = require('../shared/inbox.js');
const Utils = require('../shared/utils.js');

test('normalizeInboxItem：生成「无截止时间」的待办（正好落在收件箱）', function () {
  const rec = inbox.normalizeInboxItem({ id: 'm1', title: '给张总回电话', createdAt: 1000 }, 5000);
  assert.ok(rec);
  assert.strictEqual(rec.id, 'm1');
  assert.strictEqual(rec.title, '给张总回电话');
  assert.strictEqual(rec.deadline, null); // ★ 收件箱语义的关键
  assert.strictEqual(rec.status, 'pending');
  assert.strictEqual(rec.source, 'mobile-inbox');
  assert.strictEqual(rec.createdAt, 1000);
  assert.strictEqual(rec.updatedAt, 5000);
});

test('normalizeInboxItem：非法条目返回 null', function () {
  assert.strictEqual(inbox.normalizeInboxItem(null), null);
  assert.strictEqual(inbox.normalizeInboxItem(undefined), null);
  assert.strictEqual(inbox.normalizeInboxItem('x'), null);
  assert.strictEqual(inbox.normalizeInboxItem({ title: '缺 id' }), null);
  assert.strictEqual(inbox.normalizeInboxItem({ id: 'x', title: '   ' }), null);
  assert.strictEqual(inbox.normalizeInboxItem({ id: 'x' }), null);
});

test('normalizeInboxItem：标题截断 + createdAt 缺失时回退当前时间', function () {
  const rec = inbox.normalizeInboxItem({ id: 'm', title: 'x'.repeat(600) }, 8888);
  assert.strictEqual(rec.title.length, 500);
  assert.strictEqual(rec.createdAt, 8888);
});

test('mergeInboxItems：合并进现有待办且不修改入参', function () {
  const todos = [{ id: 't1', title: '已有待办', deadline: 123 }];
  const res = inbox.mergeInboxItems(todos, [{ id: 'm1', title: '手机收集' }], 1000);
  assert.strictEqual(res.accepted, 1);
  assert.strictEqual(res.todos.length, 2);
  assert.strictEqual(todos.length, 1, '入参数组不应被修改');
  assert.strictEqual(res.todos[1].deadline, null);
  assert.strictEqual(res.todos[0].title, '已有待办');
});

test('mergeInboxItems：按 id 幂等去重（重复点同步不重复导入）', function () {
  const first = inbox.mergeInboxItems([], [{ id: 'm1', title: 'A' }, { id: 'm2', title: 'B' }], 1000);
  assert.strictEqual(first.accepted, 2);
  const second = inbox.mergeInboxItems(first.todos, [{ id: 'm1', title: 'A' }, { id: 'm3', title: 'C' }], 2000);
  assert.strictEqual(second.accepted, 1);
  assert.strictEqual(second.duplicated, 1);
  assert.strictEqual(second.todos.length, 3);
});

test('mergeInboxItems：统计非法条目', function () {
  const res = inbox.mergeInboxItems([], [null, { id: '', title: '' }, { id: 'ok', title: '有效' }], 1000);
  assert.strictEqual(res.invalid, 2);
  assert.strictEqual(res.accepted, 1);
  assert.strictEqual(res.todos.length, 1);
});

test('mergeInboxItems：空/异常入参安全', function () {
  assert.deepStrictEqual(inbox.mergeInboxItems(null, null, 1000), {
    todos: [], accepted: 0, duplicated: 0, invalid: 0,
  });
  assert.strictEqual(inbox.mergeInboxItems(undefined, [], 1000).todos.length, 0);
});

test('收集条目语义：displayStatus 为 pending（未完成、无截止时间）', function () {
  const res = inbox.mergeInboxItems([], [{ id: 'm1', title: '手机来的一条' }], Date.now());
  const rec = res.todos[0];
  assert.strictEqual(Utils.displayStatus(rec, Date.now()), 'pending');
  assert.strictEqual(rec.deadline, null);
});

test('收集条目能参与四象限计算（不崩、有归属）', function () {
  const res = inbox.mergeInboxItems([], [{ id: 'm1', title: '想法' }], Date.now());
  const rec = res.todos[0];
  const q = Utils.calcQuadrant(rec, Date.now(), 24 * 3600000);
  assert.ok(['q1', 'q2', 'q3', 'q4'].indexOf(q) >= 0);
  // 无截止时间 → 不紧急；重要 → Q2
  assert.strictEqual(q, 'q2');
});
