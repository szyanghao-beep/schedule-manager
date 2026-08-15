/*
 * utils.boundary.test.js — 边界用例与时间窗展开测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../src/renderer/js/utils.js');

const DAY = 86400000;

test('addRepeat 每月重复钳制 30 日到 2 月', function () {
  const base = new Date('2026-01-30T09:00:00').getTime();
  const occ = Utils.expandOccurrences(
    { id: 'a', startTime: base, endTime: base + 3600000, repeat: { type: 'monthly', interval: 1 } },
    { limit: 3 }
  );
  assert.strictEqual(Utils.toDateStr(occ[0].startTime), '2026-01-30');
  assert.strictEqual(Utils.toDateStr(occ[1].startTime), '2026-02-28'); // 2026 非闰年
  assert.strictEqual(Utils.toDateStr(occ[2].startTime), '2026-03-30');
});

test('addRepeat 每周重复', function () {
  const base = new Date('2026-08-03T09:00:00').getTime(); // 周一
  const occ = Utils.expandOccurrences(
    { id: 'a', startTime: base, endTime: base + 3600000, repeat: { type: 'weekly', interval: 1 } },
    { limit: 3 }
  );
  assert.strictEqual(Utils.toDateStr(occ[1].startTime), '2026-08-10');
  assert.strictEqual(Utils.toDateStr(occ[2].startTime), '2026-08-17');
});

test('expandOccurrences 时间窗 from/to：很久以前开始的每日重复仍能取到当前实例', function () {
  // 起点在 400 天前，若按 origin 展开并 limit，前 200 个都是历史，无法覆盖今天
  const today = new Date('2026-08-15T00:00:00').getTime();
  const base = today - 400 * DAY;
  const item = { id: 'a', startTime: base, endTime: base + 3600000, repeat: { type: 'daily', interval: 1 } };
  const occ = Utils.expandOccurrences(item, { from: today, to: today + DAY });
  assert.strictEqual(occ.length, 1);
  assert.strictEqual(Utils.toDateStr(occ[0].startTime), '2026-08-15');
});

test('expandOccurrences 时间窗 to 提前终止', function () {
  const base = new Date('2026-08-01T09:00:00').getTime();
  const item = { id: 'a', startTime: base, endTime: base + 3600000, repeat: { type: 'daily', interval: 1 } };
  const occ = Utils.expandOccurrences(item, {
    from: new Date('2026-08-03T00:00:00').getTime(),
    to: new Date('2026-08-05T00:00:00').getTime(),
  });
  assert.strictEqual(occ.map(function (o) { return Utils.toDateStr(o.startTime); }).join(','), '2026-08-03,2026-08-04');
});

test('expandOccurrences 时间窗 + exceptions 跳过', function () {
  const base = new Date('2026-08-01T09:00:00').getTime();
  const skip = base + 1 * DAY;
  const item = {
    id: 'a', startTime: base, endTime: base + 3600000,
    repeat: { type: 'daily', interval: 1 },
    exceptions: { ['a@' + skip]: true },
  };
  const occ = Utils.expandOccurrences(item, { from: base, to: base + 3 * DAY });
  assert.strictEqual(occ.length, 2);
  assert.strictEqual(Utils.toDateStr(occ[0].startTime), '2026-08-01');
  assert.strictEqual(Utils.toDateStr(occ[1].startTime), '2026-08-03');
});

test('validateEvent 重复结束时间早于开始时间', function () {
  const start = new Date('2026-08-10T00:00:00').getTime();
  const bad = {
    title: 'x', allDay: true, startTime: start, endTime: start + DAY,
    repeat: { type: 'daily', interval: 1, endDate: new Date('2026-08-05T00:00:00').getTime() },
  };
  assert.strictEqual(Utils.validateEvent(bad).ok, false);
});

test('validateTodo 空标题 / 允许无截止时间', function () {
  assert.strictEqual(Utils.validateTodo({ title: '  ', deadline: 1 }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'ok', deadline: null }).ok, true);
});

test('displayStatus 事件使用 endTime 派生过期', function () {
  const now = new Date('2026-08-15T12:00:00').getTime();
  assert.strictEqual(Utils.displayStatus({ status: 'pending', endTime: now - 1 }, now), 'overdue');
  assert.strictEqual(Utils.displayStatus({ status: 'doing', endTime: now + 1 }, now), 'doing');
});

test('calcStats 统计事件与无截止时间待办', function () {
  const now = new Date('2026-08-15T12:00:00').getTime();
  const events = [
    { id: 'e1', status: 'done', startTime: now },
    { id: 'e2', status: 'pending', startTime: now },
  ];
  const todos = [
    { id: 't1', status: 'pending', deadline: null }, // 无截止时间：不计入今日
    { id: 't2', status: 'done', deadline: now },
  ];
  const s = Utils.calcStats(events, todos, now);
  assert.strictEqual(s.today.total, 3); // e1, e2, t2
  assert.strictEqual(s.today.done, 2);   // e1, t2
  assert.strictEqual(s.completedTotal, 2);
});

test('日期工具：startOfMonth / addDays / isSameDay / parseDateTime', function () {
  const ts = new Date('2026-08-15T23:00:00').getTime();
  assert.strictEqual(Utils.toDateStr(Utils.startOfMonth(ts)), '2026-08-01');
  assert.strictEqual(Utils.toDateStr(Utils.addDays(ts, 1)), '2026-08-16');
  assert.strictEqual(Utils.isSameDay(ts, new Date('2026-08-15T01:00:00').getTime()), true);
  assert.strictEqual(Utils.parseDateTime('2026-08-15', '09:30'), new Date('2026-08-15T09:30:00').getTime());
});

test('expandOccurrences 无 from/to 时保持原行为（limit 截断）', function () {
  const base = new Date('2026-08-01T09:00:00').getTime();
  const item = { id: 'a', startTime: base, endTime: base + 3600000, repeat: { type: 'daily', interval: 1 } };
  const occ = Utils.expandOccurrences(item, { limit: 3 });
  assert.strictEqual(occ.length, 3);
  assert.strictEqual(Utils.toDateStr(occ[2].startTime), '2026-08-03');
});
