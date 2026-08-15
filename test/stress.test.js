/*
 * stress.test.js — 2 年数据抗压测试：正确性 + 性能。
 * 覆盖 expandOccurrences（久远起点的重复系列）、calcStats、calcQuadrantStats、提醒扫描。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../shared/utils.js');
const { generateStressData, DAY } = require('./stress-data.js');

const H = 3600000;

test('压测：2 年数据生成完整性与四象限统计一致性', function () {
  const data = generateStressData({});
  assert.ok(data.events.length >= 600, '事件数量应足够（实际 ' + data.events.length + '）');
  assert.ok(data.todos.length >= 400, '待办数量应足够（实际 ' + data.todos.length + '）');

  const q = Utils.calcQuadrantStats(data.todos, Date.now(), 24 * H);
  const nonDone = data.todos.filter(function (t) { return t.status !== 'done'; }).length;
  assert.strictEqual(q.total, nonDone, '四象限总数应等于未完成待办数');
  assert.strictEqual(q.q1 + q.q2 + q.q3 + q.q4, q.total, '各象限之和等于总数');
  assert.ok(q.q1 > 0 && q.q2 > 0 && q.q3 > 0 && q.q4 > 0, '四象限应均有分布');
});

test('压测：expandOccurrences 月视图窗口（42 天）正确性', function () {
  const now = Date.now();
  // 久远起点 daily 重复：从 400 天前开始，每天一次
  const e = { id: 'x', startTime: now - 400 * DAY, endTime: now - 400 * DAY + 3600000, repeat: { type: 'daily', interval: 1, endDate: null } };
  const from = now;
  const to = now + 7 * DAY;
  const occs = Utils.expandOccurrences(e, { from: from, to: to });
  assert.strictEqual(occs.length, 7, '一周内应正好 7 个 daily 实例');
  assert.ok(occs[0].startTime >= from, '首个实例应在窗口内');
  assert.ok(occs[occs.length - 1].startTime < to, '末个实例应在窗口内');
});

test('压测：expandOccurrences 月视图窗口性能', function () {
  const data = generateStressData({});
  const now = Date.now();
  const gridStart = Utils.startOfWeek(Utils.startOfMonth(now));
  const from = gridStart;
  const to = Utils.addDays(gridStart, 42);

  const t0 = process.hrtime.bigint();
  let total = 0;
  data.events.forEach(function (e) {
    total += Utils.expandOccurrences(e, { from: from, to: to }).length;
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('[stress] 月视图展开：' + data.events.length + ' 事件 → ' + total + ' 实例，耗时 ' + ms.toFixed(2) + 'ms');
  assert.ok(ms < 2000, '月视图展开应在 2s 内（实际 ' + ms.toFixed(2) + 'ms）');
});

test('压测：提醒扫描（checkReminders 同款逻辑）性能', function () {
  const data = generateStressData({});
  const now = Date.now();

  const t0 = process.hrtime.bigint();
  let hit = 0;
  data.events.forEach(function (e) {
    const remindBefore = e.remindBefore || 0;
    if (!remindBefore) return;
    Utils.expandOccurrences(e, { from: now, to: now + remindBefore * 60000 + 60000 }).forEach(function (occ) {
      const remindAt = occ.startTime - remindBefore * 60000;
      if (now >= remindAt && now < occ.startTime) hit++;
    });
  });
  data.todos.forEach(function (t) {
    if (t.status === 'done') return;
    const remindBefore = t.remindBefore || 0;
    if (!remindBefore || t.deadline == null) return;
    Utils.expandOccurrences({ id: t.id, startTime: t.deadline, endTime: t.deadline, repeat: t.repeat }, { from: now, to: now + remindBefore * 60000 + 60000 }).forEach(function (occ) {
      const remindAt = occ.startTime - remindBefore * 60000;
      if (now >= remindAt && now < occ.startTime) hit++;
    });
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('[stress] 提醒扫描：' + data.events.length + ' 事件 + ' + data.todos.length + ' 待办，命中 ' + hit + ' 条，耗时 ' + ms.toFixed(2) + 'ms');
  assert.ok(ms < 2000, '提醒扫描应在 2s 内（实际 ' + ms.toFixed(2) + 'ms）');
});

test('压测：calcStats + calcQuadrantStats 性能与一致性', function () {
  const data = generateStressData({});
  const now = Date.now();

  const t0 = process.hrtime.bigint();
  const s = Utils.calcStats(data.events, data.todos, now);
  const q = Utils.calcQuadrantStats(data.todos, now, 24 * H);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('[stress] calcStats + calcQuadrantStats：' + data.events.length + ' 事件 + ' + data.todos.length + ' 待办，耗时 ' + ms.toFixed(2) + 'ms');

  assert.strictEqual(typeof s.today.rate, 'number');
  assert.strictEqual(typeof s.completedTotal, 'number');
  assert.ok(q.total > 0);
  // 逾期统计应覆盖过去两年中的逾期项
  assert.ok(s.overdue > 0, '两年跨度应存在逾期项');
});

test('压测：JSON 序列化/反序列化规模', function () {
  const data = generateStressData({});
  const t0 = process.hrtime.bigint();
  const json = JSON.stringify(data);
  const roundtrip = JSON.parse(json);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('[stress] 序列化+反序列化：' + (json.length / 1024).toFixed(1) + ' KB，耗时 ' + ms.toFixed(2) + 'ms');
  assert.strictEqual(roundtrip.events.length, data.events.length);
  assert.strictEqual(roundtrip.todos.length, data.todos.length);
});
