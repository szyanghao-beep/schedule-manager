/*
 * gtd.test.js — GTD + 时间块排程纯函数单元测试（node --test）
 * 覆盖：estimatedMinutes 校验、blockFromTodo、autoSchedule 排程、calcWeeklyReview 周回顾。
 */
const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../shared/utils.js');

const DAY_START = new Date('2026-08-20T00:00:00').getTime();
const HOUR = 3600 * 1000;

// ---- estimatedMinutes 校验 ----
test('validateTodo：预估耗时必须为 1~1440 整数分钟', function () {
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: 30 }).ok, true);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: null }).ok, true);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: undefined }).ok, true);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: 0 }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: -5 }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: 45.5 }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: 1441 }).ok, false);
  assert.strictEqual(Utils.validateTodo({ title: 'x', estimatedMinutes: 1440 }).ok, true);
});

// ---- blockFromTodo ----
test('blockFromTodo：按预估耗时生成时间块，缺省回退默认时长', function () {
  const b = Utils.blockFromTodo({ estimatedMinutes: 90 }, DAY_START);
  assert.strictEqual(b.start, DAY_START);
  assert.strictEqual(b.end, DAY_START + 90 * 60000);
  assert.strictEqual(b.minutes, 90);

  const fallback = Utils.blockFromTodo({}, DAY_START, 45);
  assert.strictEqual(fallback.end, DAY_START + 45 * 60000);
  assert.strictEqual(fallback.minutes, 45);
});

// ---- autoSchedule ----
test('autoSchedule：按截止时间/象限顺序贪心填入工作时段', function () {
  const now = DAY_START + 8 * HOUR; // 08:00，早于工作开始
  const todos = [
    { id: 't2', status: 'pending', estimatedMinutes: 30, deadline: null },
    { id: 't1', status: 'pending', estimatedMinutes: 60, deadline: DAY_START + 12 * HOUR },
  ];
  const r = Utils.autoSchedule(todos, [], {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 0,
  });
  assert.strictEqual(r.blocks.length, 2);
  assert.strictEqual(r.unscheduled.length, 0);
  assert.strictEqual(r.blocks[0].todoId, 't1'); // 有截止时间者优先
  assert.strictEqual(r.blocks[0].start, DAY_START + 9 * HOUR);
  assert.strictEqual(r.blocks[0].end, DAY_START + 10 * HOUR);
  assert.strictEqual(r.blocks[1].todoId, 't2');
  assert.strictEqual(r.blocks[1].start, DAY_START + 10 * HOUR);
});

test('autoSchedule：跳过已占用的日程时段，不重叠', function () {
  const now = DAY_START + 8 * HOUR;
  const events = [{ allDay: false, startTime: DAY_START + 9 * HOUR, endTime: DAY_START + 10 * HOUR }];
  const todos = [{ id: 't1', status: 'pending', estimatedMinutes: 60 }];
  const r = Utils.autoSchedule(todos, events, {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 0,
  });
  assert.strictEqual(r.blocks.length, 1);
  assert.strictEqual(r.blocks[0].start, DAY_START + 10 * HOUR); // 跳过 9:00–10:00
  assert.strictEqual(r.blocks[0].end, DAY_START + 11 * HOUR);
});

test('autoSchedule：全天事件占满整天，待办全部未排入', function () {
  const now = DAY_START + 8 * HOUR;
  const events = [{ allDay: true, startTime: DAY_START, endTime: DAY_START + 24 * HOUR }];
  const todos = [{ id: 't1', status: 'pending', estimatedMinutes: 60 }];
  const r = Utils.autoSchedule(todos, events, {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 0,
  });
  assert.strictEqual(r.blocks.length, 0);
  assert.deepStrictEqual(r.unscheduled, ['t1']);
});

test('autoSchedule：超过工作时段容量的待办未排入', function () {
  const now = DAY_START + 8 * HOUR;
  const todos = [{ id: 'big', status: 'pending', estimatedMinutes: 600 }]; // 600 分钟 > 9 小时
  const r = Utils.autoSchedule(todos, [], {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 0,
  });
  assert.strictEqual(r.blocks.length, 0);
  assert.deepStrictEqual(r.unscheduled, ['big']);
});

test('autoSchedule：now 晚于工作结束时全部未排入', function () {
  const now = DAY_START + 19 * HOUR; // 19:00
  const todos = [{ id: 't1', status: 'pending', estimatedMinutes: 30 }];
  const r = Utils.autoSchedule(todos, [], {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 0,
  });
  assert.strictEqual(r.blocks.length, 0);
  assert.deepStrictEqual(r.unscheduled, ['t1']);
});

test('autoSchedule：块间缓冲按槽位粒度推进', function () {
  const now = DAY_START + 8 * HOUR;
  const todos = [
    { id: 't1', status: 'pending', estimatedMinutes: 30 },
    { id: 't2', status: 'pending', estimatedMinutes: 30 },
  ];
  const r = Utils.autoSchedule(todos, [], {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 5,
  });
  assert.strictEqual(r.blocks.length, 2);
  assert.strictEqual(r.blocks[0].start, DAY_START + 9 * HOUR);
  assert.strictEqual(r.blocks[1].start, DAY_START + 10 * HOUR); // 9:30 结束 + 5 缓冲 → 取整到 10:00
});

test('autoSchedule：已完成待办不参与排程', function () {
  const now = DAY_START + 8 * HOUR;
  const todos = [
    { id: 'done', status: 'done', estimatedMinutes: 60 },
    { id: 'noEstimate', status: 'pending', estimatedMinutes: 0 },
    { id: 'ok', status: 'pending', estimatedMinutes: 30 },
  ];
  const r = Utils.autoSchedule(todos, [], {
    now, dayStart: DAY_START, workStartHour: 9, workEndHour: 18, slotMinutes: 30, bufferMinutes: 0,
  });
  assert.strictEqual(r.blocks.length, 1);
  assert.strictEqual(r.blocks[0].todoId, 'ok');
});

// ---- calcWeeklyReview ----
test('calcWeeklyReview：本周完成/新增/逾期/收件箱/缺预估/四象限', function () {
  const now = DAY_START + 12 * HOUR;
  const todos = [
    { id: 'a', status: 'done', createdAt: now, completedAt: now },
    { id: 'b', status: 'pending', deadline: now - 1000, createdAt: now },            // 逾期、缺预估、Q1
    { id: 'c', status: 'pending', deadline: null, estimatedMinutes: 30, createdAt: now }, // 收件箱、Q2
    { id: 'd', status: 'pending', deadline: now + 10000, estimatedMinutes: 30, importance: 'not_important', createdAt: now }, // Q3
  ];
  const s = Utils.calcWeeklyReview(todos, now);
  assert.strictEqual(s.createdWeek, 4);
  assert.strictEqual(s.doneWeek, 1);
  assert.strictEqual(s.overdue, 1);
  assert.strictEqual(s.inbox, 1);
  assert.strictEqual(s.noEstimate, 1);
  assert.deepStrictEqual(s.byQuadrant, { q1: 1, q2: 1, q3: 1, q4: 0, total: 3 });
});

test('calcWeeklyReview：空数据返回全 0', function () {
  const s = Utils.calcWeeklyReview([], DAY_START);
  assert.strictEqual(s.doneWeek, 0);
  assert.strictEqual(s.createdWeek, 0);
  assert.strictEqual(s.byQuadrant.total, 0);
});
