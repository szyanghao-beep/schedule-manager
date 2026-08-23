/*
 * utils.test.js — 纯函数单元测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../shared/utils.js');

test('genId 生成唯一ID', function () {
  assert.notStrictEqual(Utils.genId(), Utils.genId());
});

test('日期格式化', function () {
  assert.strictEqual(Utils.toDateStr(new Date(2026, 0, 5).getTime()), '2026-01-05');
  assert.strictEqual(Utils.toTimeStr(new Date(2026, 0, 5, 9, 5).getTime()), '09:05');
});

test('startOfWeek 周一为一周开始', function () {
  // 2026-08-13 是周四，所在周周一为 2026-08-10
  const thursday = new Date('2026-08-13T12:00:00').getTime();
  assert.strictEqual(Utils.toDateStr(Utils.startOfWeek(thursday)), '2026-08-10');
});

test('displayStatus 派生状态', function () {
  const now = new Date('2026-08-13T12:00:00').getTime();
  assert.strictEqual(Utils.displayStatus({ status: 'done', deadline: now - 1000 }, now), 'done');
  assert.strictEqual(Utils.displayStatus({ status: 'pending', deadline: now - 1000 }, now), 'overdue');
  assert.strictEqual(Utils.displayStatus({ status: 'pending', deadline: now + 1000 }, now), 'pending');
  assert.strictEqual(Utils.displayStatus({ status: 'doing', endTime: now + 1000 }, now), 'doing');
});

test('validateEvent 空标题 / 时间倒置', function () {
  assert.strictEqual(Utils.validateEvent({ title: '', allDay: false, startTime: 1, endTime: 2 }).ok, false);
  assert.strictEqual(Utils.validateEvent({ title: 'x', allDay: false, startTime: 2, endTime: 1 }).ok, false);
  assert.strictEqual(Utils.validateEvent({ title: 'x', allDay: false, startTime: 1, endTime: 2 }).ok, true);
  assert.strictEqual(Utils.validateEvent({ title: 'x', allDay: true }).ok, true);
});

test('validateEvent 自定义周期需为正整数', function () {
  const bad = { title: 'x', allDay: true, repeat: { type: 'custom', interval: 0 } };
  assert.strictEqual(Utils.validateEvent(bad).ok, false);
});

test('expandOccurrences 不重复只生成一条', function () {
  const start = new Date('2026-08-01T09:00:00').getTime();
  const occ = Utils.expandOccurrences({ id: 'a', startTime: start, endTime: start + 3600000, repeat: { type: 'none' } });
  assert.strictEqual(occ.length, 1);
  assert.strictEqual(occ[0].key, 'a@' + start);
});

test('expandOccurrences 每日重复到结束日期', function () {
  const start = new Date('2026-08-01T09:00:00').getTime();
  const item = {
    id: 'a', startTime: start, endTime: start + 3600000,
    repeat: { type: 'daily', interval: 1, endDate: new Date('2026-08-03T00:00:00').getTime() },
  };
  const occ = Utils.expandOccurrences(item);
  assert.strictEqual(occ.length, 3); // 8/1, 8/2, 8/3
});

test('expandOccurrences 每月重复钳制月末', function () {
  const start = new Date('2026-01-31T09:00:00').getTime();
  const item = { id: 'a', startTime: start, endTime: start + 3600000, repeat: { type: 'monthly', interval: 1 } };
  const occ = Utils.expandOccurrences(item, { limit: 3 });
  // 1/31, 2/28, 3/31
  assert.strictEqual(Utils.toDateStr(occ[1].startTime), '2026-02-28');
  assert.strictEqual(Utils.toDateStr(occ[2].startTime), '2026-03-31');
});

test('expandOccurrences 自定义周期按天数', function () {
  const start = new Date('2026-08-01T09:00:00').getTime();
  const item = { id: 'a', startTime: start, endTime: start + 1, repeat: { type: 'custom', interval: 3 } };
  const occ = Utils.expandOccurrences(item, { limit: 3 });
  assert.strictEqual(Utils.toDateStr(occ[1].startTime), '2026-08-04');
  assert.strictEqual(Utils.toDateStr(occ[2].startTime), '2026-08-07');
});

test('expandOccurrences 跳过 exceptions 实例', function () {
  const start = new Date('2026-08-01T09:00:00').getTime();
  const skipKey = 'a@' + new Date('2026-08-02T09:00:00').getTime();
  const item = {
    id: 'a', startTime: start, endTime: start + 3600000,
    repeat: { type: 'daily', interval: 1 },
    exceptions: { [skipKey]: true },
  };
  const occ = Utils.expandOccurrences(item, { limit: 3 });
  assert.strictEqual(occ.length, 2); // 8/2 被跳过
  assert.strictEqual(Utils.toDateStr(occ[0].startTime), '2026-08-01');
  assert.strictEqual(Utils.toDateStr(occ[1].startTime), '2026-08-03');
});

test('calcStats 今日完成率', function () {
  const now = new Date('2026-08-13T12:00:00').getTime();
  const todos = [
    { id: 't1', status: 'done', deadline: now },
    { id: 't2', status: 'pending', deadline: now },
  ];
  const s = Utils.calcStats([], todos, now);
  assert.strictEqual(s.today.total, 2);
  assert.strictEqual(s.today.done, 1);
  assert.strictEqual(s.today.rate, 50);
});

test('calcStats 逾期与已完成统计', function () {
  const now = new Date('2026-08-13T12:00:00').getTime();
  const todos = [
    { id: 't1', status: 'done', deadline: now - 1000 },
    { id: 't2', status: 'pending', deadline: now - 2000 },
    { id: 't3', status: 'pending', deadline: now + 1000 },
  ];
  const s = Utils.calcStats([], todos, now);
  assert.strictEqual(s.overdue, 1);       // t2 已过期且未完成
  assert.strictEqual(s.completedTotal, 1); // t1 已完成
});

test('formatRemind 提前量文案（分钟/小时/天）', function () {
  assert.strictEqual(Utils.formatRemind(0), '不提醒');
  assert.strictEqual(Utils.formatRemind(-1), '不提醒');
  assert.strictEqual(Utils.formatRemind(5), '提前 5 分钟');
  assert.strictEqual(Utils.formatRemind(30), '提前 30 分钟');
  assert.strictEqual(Utils.formatRemind(60), '提前 1 小时');
  assert.strictEqual(Utils.formatRemind(120), '提前 2 小时');
  assert.strictEqual(Utils.formatRemind(720), '提前 12 小时');
  assert.strictEqual(Utils.formatRemind(1440), '提前 1 天');
  assert.strictEqual(Utils.formatRemind(2880), '提前 2 天');
});

test('remindAt 指定时间提醒校验', function () {
  const ts = Date.now();
  assert.strictEqual(Utils.validateTodo({ title: 'x', remindAt: ts }).ok, true);
  assert.strictEqual(Utils.validateTodo({ title: 'x', remindAt: 'abc' }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'x', remindAt: 0 }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'x', remindAt: null }).ok, true); // 未设置不校验
  assert.strictEqual(Utils.validateEvent({ title: 'x', allDay: true, remindAt: ts }).ok, true);
  assert.strictEqual(Utils.validateEvent({ title: 'x', allDay: true, remindAt: 'abc' }).ok, false);
});

test('effectiveReminds 优先 reminds 数组，回退 remindBefore，过滤非法值', function () {
  assert.deepStrictEqual(Utils.effectiveReminds({ reminds: [60, 15] }), [60, 15]);
  assert.deepStrictEqual(Utils.effectiveReminds({ reminds: [60, 0, -1, 'x', 15, 60] }), [60, 15]); // 去重 + 过滤
  assert.deepStrictEqual(Utils.effectiveReminds({ reminds: [] }), []); // 空数组回退 remindBefore
  assert.deepStrictEqual(Utils.effectiveReminds({ remindBefore: 30 }), [30]);
  assert.deepStrictEqual(Utils.effectiveReminds({ remindBefore: 0 }), []);
  assert.deepStrictEqual(Utils.effectiveReminds({}), []);
  assert.strictEqual(Utils.effectiveReminds(null).length, 0);
});
