/*
 * trend.realism.test.js — 统计趋势曲线真实性专项测试（node --test）
 * 针对 v1.2.1 两年数据场景，重点验证统计界面趋势曲线的真实性：
 *   1. 历史四象限快照与当日真实分布一致（逐日模拟主进程 snapshotStats 同口径）
 *   2. 当天快照「仅保留最新」语义（与 main.js snapshotStats 一致）
 *   3. 渲染层趋势合并 Utils.mergeTrend：30 天窗口 + 今天实时合并、不伪造缺失日期
 *   4. 曲线数据自洽：每点 q1+q2+q3+q4 == total（图表堆叠高度 == 真实未完成待办数）
 *   5. 口径一致性：趋势今天点 == 四象限卡片 == 穿透明细总和
 *   6. 两年数据性能：90 天逐日快照、月视图展开、统计计算
 * 注意：main.js 的 snapshotStats 依赖 electron 无法直接 require，
 * 这里用与源码逐行同口径的纯逻辑复刻（见 simulateDailyHistory）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../src/renderer/js/utils.js');
const { generateStressData, DAY } = require('./stress-data.js');

const H = 3600000;
const THRESHOLD = 24 * H;

// ---- 与 main.js snapshotStats 同口径的逐日快照模拟 ----
// 每天取当日 calcQuadrantStats 作为快照；返回按天递增的 { date, q1..q4, total } 数组
function simulateDailyHistory(todos, now, days, threshold) {
  const history = [];
  for (let i = 0; i < days; i++) {
    const dayTs = Utils.startOfDay(now) - (days - 1 - i) * DAY;
    const q = Utils.calcQuadrantStats(todos, dayTs, threshold);
    history.push({ date: Utils.toDateStr(dayTs), q1: q.q1, q2: q.q2, q3: q.q3, q4: q.q4, total: q.total });
  }
  return history;
}

// 复刻 stats.js 的「今天」实时条目构造
function todayEntry(todos, now, threshold) {
  const q = Utils.calcQuadrantStats(todos, now, threshold);
  return { date: Utils.toDateStr(now), q1: q.q1, q2: q.q2, q3: q.q3, q4: q.q4, total: q.total };
}

const NOW = new Date('2026-08-15T12:00:00').getTime();

test('两年数据：逐日快照与当日真实分布一致、日期单调递增', function () {
  const data = generateStressData({ now: NOW });
  const days = 60;
  const history = simulateDailyHistory(data.todos, NOW, days, THRESHOLD);
  assert.strictEqual(history.length, days);
  // 抽查若干天：快照 == 当天真实 calcQuadrantStats
  [0, 7, 29, 59].forEach(function (i) {
    const dayTs = Utils.startOfDay(NOW) - (days - 1 - i) * DAY;
    const q = Utils.calcQuadrantStats(data.todos, dayTs, THRESHOLD);
    assert.strictEqual(history[i].q1, q.q1, 'q1 不一致 @day ' + i);
    assert.strictEqual(history[i].q2, q.q2, 'q2 不一致 @day ' + i);
    assert.strictEqual(history[i].q3, q.q3, 'q3 不一致 @day ' + i);
    assert.strictEqual(history[i].q4, q.q4, 'q4 不一致 @day ' + i);
    assert.strictEqual(history[i].total, q.total, 'total 不一致 @day ' + i);
  });
  // 日期严格递增
  for (let i = 1; i < history.length; i++) {
    assert.ok(history[i].date > history[i - 1].date, '快照日期应严格递增 @' + i);
  }
  // 快照无重复日期
  assert.strictEqual(new Set(history.map(function (h) { return h.date; })).size, days);
});

test('当天快照仅保留最新（main.js snapshotStats 同语义：同一天更新而非新增）', function () {
  const data = generateStressData({ now: NOW });
  const dayTs = Utils.startOfDay(NOW);
  const dateStr = Utils.toDateStr(dayTs);

  // 先有「中午」快照
  const noon = Utils.calcQuadrantStats(data.todos, dayTs + 12 * H, THRESHOLD);
  const history = [{ date: dateStr, q1: noon.q1, q2: noon.q2, q3: noon.q3, q4: noon.q4, total: noon.total }];

  // main.js 逻辑：last.date === today → 更新为最新值（不 push 新条目）
  const evening = Utils.calcQuadrantStats(data.todos, dayTs + 18 * H, THRESHOLD);
  const last = history[history.length - 1];
  if (last && last.date === dateStr) {
    last.q1 = evening.q1; last.q2 = evening.q2; last.q3 = evening.q3; last.q4 = evening.q4; last.total = evening.total;
  } else {
    history.push({ date: dateStr, q1: evening.q1, q2: evening.q2, q3: evening.q3, q4: evening.q4, total: evening.total });
  }

  assert.strictEqual(history.length, 1, '同一天不应新增快照条目');
  assert.strictEqual(history[0].total, evening.total);
  assert.strictEqual(history[0].q1, evening.q1);
});

test('mergeTrend：90 天历史合并且仅保留最近 30 天 + 今天实时合并', function () {
  const data = generateStressData({ now: NOW });
  const history = simulateDailyHistory(data.todos, NOW, 90, THRESHOLD);
  const te = todayEntry(data.todos, NOW, THRESHOLD);
  const merged = Utils.mergeTrend(history, te);

  assert.strictEqual(merged.length, 30, '应恰为 30 个点');
  assert.strictEqual(merged[29].date, te.date, '最后一点应为今天');
  assert.deepStrictEqual(
    { q1: merged[29].q1, q2: merged[29].q2, q3: merged[29].q3, q4: merged[29].q4, total: merged[29].total },
    { q1: te.q1, q2: te.q2, q3: te.q3, q4: te.q4, total: te.total },
    '今天点应等于实时四象限分布'
  );
  // 前 29 条 == 历史倒数第 30..2 条（昨天往前），逐点一致
  for (let i = 0; i < 29; i++) {
    const h = history[history.length - 30 + i];
    assert.strictEqual(merged[i].date, h.date);
    assert.strictEqual(merged[i].q1, h.q1);
    assert.strictEqual(merged[i].total, h.total);
  }
});

test('mergeTrend：历史最后一条已是今天时，覆盖为实时值且不重复', function () {
  const data = generateStressData({ now: NOW });
  const history = simulateDailyHistory(data.todos, NOW, 30, THRESHOLD); // 最后一条是今天（快照）
  const te = todayEntry(data.todos, NOW, THRESHOLD);
  const merged = Utils.mergeTrend(history, te);
  assert.strictEqual(merged.length, 30);
  assert.strictEqual(merged[29].date, te.date);
  assert.strictEqual(merged[29].total, te.total, '历史今天的快照应被实时值覆盖');
});

test('mergeTrend：空/缺失历史只返回今天，不伪造日期', function () {
  const data = generateStressData({ now: NOW });
  const te = todayEntry(data.todos, NOW, THRESHOLD);

  assert.deepStrictEqual(Utils.mergeTrend([], te), [te]);
  assert.deepStrictEqual(Utils.mergeTrend(null, te), [te]);
  assert.deepStrictEqual(Utils.mergeTrend(undefined, undefined), []);

  // 历史中间缺一天（当天应用未运行）→ 不补空点、不伪造
  const history = simulateDailyHistory(data.todos, NOW, 30, THRESHOLD); // today-29 .. today
  const missingDay = Utils.toDateStr(Utils.startOfDay(NOW) - 15 * DAY);
  const withHole = history.filter(function (d) { return d.date !== missingDay; });
  assert.strictEqual(withHole.length, 29);
  const merged = Utils.mergeTrend(withHole, te);
  assert.strictEqual(merged.length, 29, '不应为缺失日伪造数据点');
  assert.ok(merged.every(function (d) { return d.date !== missingDay; }), '缺日不应出现在曲线中');
  assert.ok(merged.some(function (d) { return d.date === te.date; }), '今天应存在且为实时值');
});

test('曲线数据自洽：每点 q1+q2+q3+q4 == total，且图表堆叠高度基于象限和', function () {
  const data = generateStressData({ now: NOW });
  const history = simulateDailyHistory(data.todos, NOW, 90, THRESHOLD);
  const merged = Utils.mergeTrend(history, todayEntry(data.todos, NOW, THRESHOLD));
  merged.forEach(function (d) {
    assert.strictEqual(d.q1 + d.q2 + d.q3 + d.q4, d.total, '曲线点 ' + d.date + ' 象限和应等于 total');
    assert.ok(d.total >= 0);
  });
  // 图表 y 轴 = 所有点象限和的最大值 → 与真实未完成待办数上限一致
  const yMax = Math.max.apply(null, merged.map(function (d) { return d.q1 + d.q2 + d.q3 + d.q4; }).concat([1]));
  const live = Utils.calcQuadrantStats(data.todos, NOW, THRESHOLD);
  assert.ok(live.total <= yMax, '今天未完成待办数不应超过 y 轴上限');
});

test('口径一致性：趋势今天点 == 四象限卡片 == 穿透明细总和（2 年数据）', function () {
  const data = generateStressData({ now: NOW });
  const q = Utils.calcQuadrantStats(data.todos, NOW, THRESHOLD);
  const te = todayEntry(data.todos, NOW, THRESHOLD);
  assert.strictEqual(te.total, q.total);
  assert.strictEqual(te.q1, q.q1);
  let sum = 0;
  ['q1', 'q2', 'q3', 'q4'].forEach(function (key) {
    const items = Utils.calcDrillItems(data.events, data.todos, key, NOW, THRESHOLD);
    assert.strictEqual(items.length, q[key], key + ' 穿透明细数应等于象限计数');
    sum += items.length;
  });
  assert.strictEqual(sum, q.total, '穿透明细总和应等于未完成待办数');
});

test('两年数据性能：90 天逐日快照、统计计算、月视图展开', function () {
  const data = generateStressData({ now: NOW });

  const t0 = process.hrtime.bigint();
  simulateDailyHistory(data.todos, NOW, 90, THRESHOLD);
  const ms1 = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('[realism] 90 天逐日快照：' + ms1.toFixed(2) + 'ms');
  assert.ok(ms1 < 500, '90 天逐日快照应在 500ms 内（实际 ' + ms1.toFixed(2) + 'ms）');

  const t1 = process.hrtime.bigint();
  const s = Utils.calcStats(data.events, data.todos, NOW);
  const q = Utils.calcQuadrantStats(data.todos, NOW, THRESHOLD);
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log('[realism] calcStats + calcQuadrantStats：' + ms2.toFixed(2) + 'ms');
  assert.ok(ms2 < 200, '统计计算应在 200ms 内（实际 ' + ms2.toFixed(2) + 'ms）');
  assert.strictEqual(typeof s.today.rate, 'number');
  assert.ok(q.total > 0);

  const t2 = process.hrtime.bigint();
  const gridStart = Utils.startOfWeek(Utils.startOfMonth(NOW));
  let instances = 0;
  data.events.forEach(function (e) {
    instances += Utils.expandOccurrences(e, { from: gridStart, to: Utils.addDays(gridStart, 42) }).length;
  });
  const ms3 = Number(process.hrtime.bigint() - t2) / 1e6;
  console.log('[realism] 月视图展开：' + data.events.length + ' 事件 → ' + instances + ' 实例，' + ms3.toFixed(2) + 'ms');
  assert.ok(ms3 < 2000, '月视图展开应在 2s 内（实际 ' + ms3.toFixed(2) + 'ms）');
});
