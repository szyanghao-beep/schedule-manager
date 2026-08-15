/*
 * stats.drill.test.js — 统计页穿透（下钻明细）纯函数测试。
 * 覆盖：今日/本周/本月、逾期、累计已完成、四象限 q1~q4 共 9 类明细，
 *       口径与 calcStats / calcQuadrantStats 严格一致，并验证排序与时间窗边界。
 */
const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../src/renderer/js/utils.js');
const { generateStressData } = require('./stress-data.js');

const H = 3600000;
const DAY = 86400000;

function doneCount(items) {
  return items.filter(function (x) { return x.item.status === 'done'; }).length;
}

// 用固定 now 生成 2 年数据，保证边界确定性
function fixture() {
  const now = Date.now();
  const data = generateStressData({ now: now });
  return { now: now, data: data };
}

test('穿透：今日/本周/本月 明细口径与 calcStats 完全一致（2 年数据）', function () {
  const { now, data } = fixture();
  const s = Utils.calcStats(data.events, data.todos, now);

  [['today', s.today], ['week', s.week], ['month', s.month]].forEach(function (pair) {
    const type = pair[0], bucket = pair[1];
    const items = Utils.calcDrillItems(data.events, data.todos, type, now, 24 * H);
    assert.strictEqual(items.length, bucket.total, type + ' 明细总数应等于卡片 total');
    assert.strictEqual(doneCount(items), bucket.done, type + ' 明细中已完成数应等于卡片 done');
  });
});

test('穿透：逾期 / 累计已完成 与 calcStats 完全一致（2 年数据）', function () {
  const { now, data } = fixture();
  const s = Utils.calcStats(data.events, data.todos, now);

  const overdue = Utils.calcDrillItems(data.events, data.todos, 'overdue', now, 24 * H);
  assert.strictEqual(overdue.length, s.overdue, '逾期明细数应等于卡片逾期数');
  overdue.forEach(function (x) {
    assert.strictEqual(Utils.displayStatus(x.item, now), 'overdue', '逾期明细每一项都应为逾期状态');
  });

  const done = Utils.calcDrillItems(data.events, data.todos, 'completed', now, 24 * H);
  assert.strictEqual(done.length, s.completedTotal, '已完成明细数应等于累计已完成');
  done.forEach(function (x) {
    assert.strictEqual(x.item.status, 'done', '已完成明细每一项 status 都应为 done');
  });
});

test('穿透：四象限明细与 calcQuadrantStats 完全一致（2 年数据）', function () {
  const { now, data } = fixture();
  const threshold = 24 * H;
  const q = Utils.calcQuadrantStats(data.todos, now, threshold);

  let sum = 0;
  ['q1', 'q2', 'q3', 'q4'].forEach(function (key) {
    const items = Utils.calcDrillItems(data.events, data.todos, key, now, threshold);
    assert.strictEqual(items.length, q[key], key + ' 明细数应等于象限计数');
    items.forEach(function (x) {
      assert.strictEqual(x.kind, 'todo', key + ' 明细只应含待办');
      assert.strictEqual(Utils.calcQuadrant(x.item, now, threshold), key, key + ' 明细每项象限应匹配');
      assert.notStrictEqual(x.item.status, 'done', key + ' 明细不应含已完成待办');
    });
    sum += items.length;
  });
  assert.strictEqual(sum, q.total, '四象限明细总和应等于 total');
});

test('穿透：九类明细在空数据下均返回空数组', function () {
  const now = Date.now();
  ['today', 'week', 'month', 'overdue', 'completed', 'q1', 'q2', 'q3', 'q4'].forEach(function (type) {
    const items = Utils.calcDrillItems([], [], type, now, 24 * H);
    assert.deepStrictEqual(items, [], type + ' 空数据应返回空数组');
  });
});

test('穿透：today 时间窗边界正确（[今日0点, 明日0点)，无截止不含）', function () {
  const now = Date.now();
  const todayStart = Utils.startOfDay(now);
  const tomorrowStart = Utils.addDays(todayStart, 1);
  const todos = [
    { id: 'a', status: 'pending', deadline: todayStart - 1 },        // 昨天，不含
    { id: 'b', status: 'pending', deadline: todayStart },            // 今天 0 点，含
    { id: 'c', status: 'pending', deadline: tomorrowStart - 1 },     // 今天 23:59:59，含
    { id: 'd', status: 'pending', deadline: tomorrowStart },         // 明天 0 点，不含
    { id: 'e', status: 'pending', deadline: null },                  // 无截止，不含
  ];
  const items = Utils.calcDrillItems([], todos, 'today', now, 24 * H);
  const ids = items.map(function (x) { return x.item.id; }).sort();
  assert.deepStrictEqual(ids, ['b', 'c'], 'today 应只含 [todayStart, tomorrowStart) 区间的待办');
});

test('穿透：排序——逾期/已完成按时间倒序，今日明细未完成在前', function () {
  const now = Date.now();

  const overdueTodos = [
    { id: 'a', status: 'pending', deadline: now - 2 * DAY },
    { id: 'b', status: 'pending', deadline: now - 1 * DAY },
  ];
  const overdue = Utils.calcDrillItems([], overdueTodos, 'overdue', now, 24 * H);
  assert.strictEqual(overdue[0].item.id, 'b', '逾期应按时间倒序（最近的在前）');

  const todayStart = Utils.startOfDay(now);
  const todayTodos = [
    { id: 'd1', status: 'done', deadline: todayStart + 1 * H },
    { id: 'p1', status: 'pending', deadline: todayStart + 2 * H },
    { id: 'p2', status: 'pending', deadline: todayStart + 3 * H },
  ];
  const today = Utils.calcDrillItems([], todayTodos, 'today', now, 24 * H);
  assert.deepStrictEqual(today.map(function (x) { return x.item.id; }), ['p1', 'p2', 'd1'], '今日明细未完成应排在前、已完成排在后');
});

test('穿透：completed 同时涵盖日程与待办（kind 区分）', function () {
  const now = Date.now();
  const events = [{ id: 'ev', status: 'done', startTime: now, endTime: now + H }];
  const todos = [{ id: 'td', status: 'done', deadline: now + H }];
  const items = Utils.calcDrillItems(events, todos, 'completed', now, 24 * H);
  assert.strictEqual(items.length, 2);
  assert.ok(items.some(function (x) { return x.kind === 'event' && x.item.id === 'ev'; }), '应含已完成的日程');
  assert.ok(items.some(function (x) { return x.kind === 'todo' && x.item.id === 'td'; }), '应含已完成的待办');
});
