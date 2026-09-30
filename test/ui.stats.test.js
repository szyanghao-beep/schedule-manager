/*
 * ui.stats.test.js — 统计页渲染层 UI 测试（jsdom 真实 DOM）
 *
 * 关键点：界面上的数字必须与 shared/utils.js 的 calcStats / calcQuadrantStats 完全一致，
 * 否则「统计页和计算逻辑」会各自漂移。这里同时做两件事：
 *   1. 断言手算好的字面量（67% / 2 / 4 …），把渲染管线钉死；
 *   2. 用 shared/utils.js（纯函数）独立算一遍，断言界面文本 == 纯函数结果。
 * 时间冻结在 2026-03-10 14:30（周二），所以「今日/本周/本月」的边界完全确定。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { setupUi, flush, FIXED_NOW } = require('./ui.helpers.js');
const Utils = require('../shared/utils.js');

const DAY = 86400000;
const HOUR = 3600e3;
const ts = function (y, m, d, hh, mm) { return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime(); };

// 覆盖 今日/本周/本月/更早/无截止 的一批数据（每一项的存在理由见行内注释）
function sampleData() {
  const events = [
    // 今日且已完成
    { id: 'e1', title: '晨会', status: 'done', startTime: ts(2026, 3, 10, 9), endTime: ts(2026, 3, 10, 10) },
  ];
  const todos = [
    { id: 'a1', title: '今日早间任务', status: 'done', deadline: ts(2026, 3, 10, 0, 0) + 1000, importance: 'important' },
    { id: 'b1', title: '今日遗留任务', status: 'pending', deadline: ts(2026, 3, 10, 0, 0) + 2000, importance: 'important' },
    { id: 'd1', title: '本周任务', status: 'pending', deadline: ts(2026, 3, 11, 10), importance: 'important' },
    { id: 'e2', title: '上周已完成', status: 'done', deadline: ts(2026, 3, 8, 10), importance: 'important' },
    { id: 'f1', title: '本月已完成', status: 'done', deadline: ts(2026, 3, 20, 10), importance: 'important' },
    { id: 'g1', title: '很久以前就逾期', status: 'pending', deadline: ts(2026, 2, 20, 10), importance: 'important' },
    { id: 'h1', title: '重要不紧急', status: 'pending', deadline: ts(2026, 3, 30, 10), importance: 'important' },
    { id: 'i1', title: '不重要但紧急', status: 'pending', deadline: ts(2026, 3, 1, 10), importance: 'not_important' },
    { id: 'j1', title: '不重要不紧急', status: 'pending', deadline: null, importance: 'not_important' },
  ];
  return { events: events, todos: todos };
}

function cardMap(h, root) {
  const out = {};
  h.qsa('.stat-card', root).forEach(function (c) {
    out[c.querySelector('.stat-label').textContent.trim()] = {
      value: c.querySelector('.stat-value').textContent.trim(),
      sub: c.querySelector('.stat-sub') ? c.querySelector('.stat-sub').textContent.trim() : '',
    };
  });
  return out;
}

async function openStats(extra) {
  const data = Object.assign(sampleData(), extra || {});
  const h = await setupUi({ now: FIXED_NOW, data: data });
  const root = h.renderView('stats');
  await flush();
  return { h: h, root: root, data: data };
}

test('统计页 · 顶部数字卡片：与 client 端 calcStats 完全一致', async function (t) {
  const { h, root, data } = await openStats();
  t.after(function () { h.close(); });

  // 纯函数独立算一遍（界面与计算逻辑一致性检查）
  const s = Utils.calcStats(data.events, data.todos, FIXED_NOW);
  assert.deepStrictEqual(s, {
    today: { total: 3, done: 2, rate: 67 },
    week: { total: 4, done: 2, rate: 50 },
    month: { total: 8, done: 4, rate: 50 },
    overdue: 3,
    completedTotal: 4,
  });

  // 手算的字面量（把渲染管线钉死：换错字段/换错卡片都会红）
  assert.deepStrictEqual(cardMap(h, root), {
    '今日完成率': { value: '67%', sub: '2 / 3' },
    '本周完成': { value: '2 / 4', sub: '完成率 50%' },
    '本月完成': { value: '4 / 8', sub: '完成率 50%' },
    '逾期任务': { value: '3', sub: '未处理' },
    '累计已完成': { value: '4', sub: '全部' },
  });
});

test('统计页 · 完成率对比条形图：宽度与数值来自同一份 rate', async function (t) {
  const { h, root, data } = await openStats();
  t.after(function () { h.close(); });

  const s = Utils.calcStats(data.events, data.todos, FIXED_NOW);
  const chart = h.cardByTitle('完成率对比', root);
  assert.deepStrictEqual(h.texts('.chart-label', chart), ['今日', '本周', '本月']);
  assert.deepStrictEqual(h.texts('.chart-val', chart), [
    s.today.rate + '%', s.week.rate + '%', s.month.rate + '%',
  ]);
  assert.deepStrictEqual(h.qsa('.chart-fill', chart).map(function (f) { return f.style.width; }), ['67%', '50%', '50%']);
});

test('统计页 · 四象限分布：计数与百分比来自 calcQuadrantStats（只算未完成）', async function (t) {
  const { h, root, data } = await openStats();
  t.after(function () { h.close(); });

  const q = Utils.calcQuadrantStats(data.todos, FIXED_NOW, 24 * HOUR);
  assert.deepStrictEqual(q, { q1: 3, q2: 1, q3: 1, q4: 1, total: 6 });

  const quadCard = h.cardByTitle('四象限分布（未完成待办 · 点击穿透）', root);
  assert.deepStrictEqual(h.texts('.quad-label', quadCard), ['重要且紧急', '重要不紧急', '不重要但紧急', '不重要不紧急']);
  assert.deepStrictEqual(h.texts('.quad-value', quadCard), ['3', '1', '1', '1']);
  assert.deepStrictEqual(h.texts('.quad-sub', quadCard), ['50%', '17%', '17%', '17%']);
  // 每个格子顶部有一条象限色
  assert.deepStrictEqual(
    h.qsa('.quad-cell', quadCard).map(function (c) { return c.style.borderTop; }),
    ['3px solid rgb(224, 91, 91)', '3px solid rgb(79, 142, 247)', '3px solid rgb(242, 165, 65)', '3px solid rgb(138, 143, 152)']
  );
});

test('统计页 · 穿透明细：点「逾期任务」卡片列出底层条目，点「收起」再收回', async function (t) {
  const { h, root, data } = await openStats();
  t.after(function () { h.close(); });

  const expected = Utils.calcDrillItems(data.events, data.todos, 'overdue', FIXED_NOW, 24 * HOUR);
  assert.strictEqual(expected.length, 3);

  h.clickText('.stat-card', '逾期任务3未处理', root);
  await flush();

  const panel = h.cardByTitle('逾期任务明细（3 项）', root);
  assert.ok(panel, '应展开穿透面板');
  assert.deepStrictEqual(h.texts('.item-title', panel), expected.map(function (x) { return x.item.title; }));
  // 每条都带派生状态徽标
  assert.deepStrictEqual(h.texts('.item-side .badge', panel), ['已过期', '已过期', '已过期']);

  h.clickText('button', '收起', panel);
  await flush();
  assert.strictEqual(h.allByText('button', '收起', root).length, 0, '收起后面板应消失');
});

test('统计页 · 穿透面板里勾选待办：状态落库且顶部数字立即刷新', async function (t) {
  const { h, root } = await openStats();
  t.after(function () { h.close(); });

  // 点「今日完成率」卡片展开今日明细
  h.clickText('.stat-card', '今日完成率67%2 / 3', root);
  await flush();
  const panel = h.cardByTitle('今日任务明细（3 项）', root);
  assert.deepStrictEqual(h.texts('.item-title', panel), ['今日遗留任务', '今日早间任务', '晨会']);

  // 勾掉那条未完成的待办
  const pendingRow = h.qsa('.item', panel).filter(function (r) { return r.className.indexOf('done') < 0; })[0];
  assert.strictEqual(pendingRow.querySelector('.item-title').textContent.trim(), '今日遗留任务');
  h.change(pendingRow.querySelector('input.item-check'), true);
  await flush();

  assert.strictEqual(h.Store.get().todos.find(function (x) { return x.id === 'b1'; }).status, 'done');
  const cards = cardMap(h, root);
  assert.deepStrictEqual(cards['今日完成率'], { value: '100%', sub: '3 / 3' });
  assert.deepStrictEqual(cards['逾期任务'], { value: '2', sub: '未处理' });
  assert.deepStrictEqual(cards['累计已完成'], { value: '5', sub: '全部' });
});

test('统计页 · 四象限格子穿透：只列出该象限的未完成待办', async function (t) {
  const { h, root, data } = await openStats();
  t.after(function () { h.close(); });

  const q1Items = Utils.calcDrillItems(data.events, data.todos, 'q1', FIXED_NOW, 24 * HOUR);
  assert.deepStrictEqual(q1Items.map(function (x) { return x.item.title; }), ['很久以前就逾期', '今日遗留任务', '本周任务']);

  const quadCard = h.cardByTitle('四象限分布（未完成待办 · 点击穿透）', root);
  h.click(h.qsa('.quad-cell', quadCard)[0]);
  await flush();

  const panel = h.cardByTitle('重要且紧急 · 待办（' + q1Items.length + ' 项）', root);
  assert.deepStrictEqual(h.texts('.item-title', panel), q1Items.map(function (x) { return x.item.title; }));
  assert.deepStrictEqual(h.texts('.item-side .badge', panel), ['已过期', '已过期', '未开始']);
});

test('统计页 · 近 30 天趋势：读取 getStatsHistory 并实时合并「今天」', async function (t) {
  const history = [
    { date: '2026-03-08', q1: 1, q2: 2, q3: 0, q4: 1, total: 4 },
    { date: '2026-03-09', q1: 2, q2: 1, q3: 1, q4: 0, total: 4 },
  ];
  const { h, root, data } = await openStats({});
  t.after(function () { h.close(); });

  // 上面的 openStats 已经渲染过一次（此时 history 为空），这里补上历史并点「刷新」
  h.api.__set('getStatsHistory', { statsHistory: history });
  h.clickText('button', '刷新', root);
  await flush();

  assert.ok(h.api.__count('getStatsHistory') >= 2, '刷新应重新读取历史快照');
  const trendCard = h.cardByTitle('四象限近 30 天趋势', root);

  // 合并「今天」这条实时数据，口径与顶部四象限卡片一致
  const live = Utils.calcQuadrantStats(data.todos, FIXED_NOW, 24 * HOUR);
  const merged = Utils.mergeTrend(history, {
    date: Utils.toDateStr(FIXED_NOW), q1: live.q1, q2: live.q2, q3: live.q3, q4: live.q4, total: live.total,
  });
  assert.deepStrictEqual(merged.map(function (d) { return d.date; }), ['2026-03-08', '2026-03-09', '2026-03-10']);
  assert.deepStrictEqual(merged[2], { date: '2026-03-10', q1: 3, q2: 1, q3: 1, q4: 1, total: 6 });

  // 图：SVG + 4 条堆叠面积（固定象限配色顺序）+ 图例
  const svg = h.qs('.trend-svg', trendCard);
  assert.ok(svg, '应渲染趋势图 SVG');
  assert.strictEqual(svg.getAttribute('viewBox'), '0 0 720 220');
  assert.strictEqual(svg.getAttribute('aria-label'), '四象限近 30 天趋势堆叠面积图');
  assert.deepStrictEqual(
    h.qsa('.trend-area', trendCard).map(function (p) { return p.getAttribute('fill'); }),
    ['#e05b5b', '#4f8ef7', '#f2a541', '#8a8f98']
  );
  assert.deepStrictEqual(h.texts('.trend-legend-item', trendCard), ['重要且紧急', '重要不紧急', '不重要但紧急', '不重要不紧急']);
  // x 轴刻度（稀疏）覆盖到最后一个日期
  assert.ok(h.texts('.trend-axis-label', trendCard).indexOf('03/10') >= 0, JSON.stringify(h.texts('.trend-axis-label', trendCard)));

  // 切到「列表」视图：行数 = 合并后的天数 + 表头，且最新日期排最前
  h.clickText('button', '列表', trendCard);
  await flush();
  const trendCard2 = h.cardByTitle('四象限近 30 天趋势', root);
  const rows = h.qsa('.trend-table-row', trendCard2);
  assert.strictEqual(rows.length, 4, '表头 1 行 + 数据 3 行');
  assert.deepStrictEqual(h.texts('.trend-table-date', rows[0]), ['日期']);
  assert.deepStrictEqual(h.texts('.trend-table-date', trendCard2).slice(1), ['03/10', '03/09', '03/08']);
  // 第一行数据 = 今天（实时合并），四象限与合计来自上面的 merged[2]
  assert.deepStrictEqual(h.texts('.trend-table-row:nth-child(2) .trend-table-cell', trendCard2), ['3', '1', '1', '1', '6']);
  assert.deepStrictEqual(h.texts('.trend-table-row:nth-child(3) .trend-table-cell', trendCard2), ['2', '1', '1', '0', '4']);
});

test('统计页 · 历史读取失败不卡死：数字照常渲染，趋势退化成只有「今天」', async function (t) {
  const h = await setupUi({
    now: FIXED_NOW,
    data: sampleData(),
    api: { getStatsHistory: function () { return Promise.reject(new Error('IPC 挂了')); } },
  });
  t.after(function () { h.close(); });

  const root = h.renderView('stats');
  await flush();

  // 数字卡片照常渲染（不受历史读取失败影响）
  assert.strictEqual(cardMap(h, root)['今日完成率'].value, '67%');
  // 趋势图退化成只有「今天」这一个实时点，而不是整块报错/卡死
  const trendCard = h.cardByTitle('四象限近 30 天趋势', root);
  assert.ok(h.qs('.trend-svg', trendCard), '应仍渲染趋势图（只有今天）');
  assert.deepStrictEqual(h.texts('.trend-axis-label', trendCard).filter(function (s) { return s.indexOf('/') > 0; }), ['03/10']);
  // 失败被吞进 console.error，界面不炸
  assert.ok(h.logs.some(function (l) { return l.message.indexOf('获取统计历史失败') >= 0; }), JSON.stringify(h.logs));
});

test('统计页 · 空数据时数字全 0 且不出现 NaN', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  const root = h.renderView('stats');
  await flush();

  assert.deepStrictEqual(cardMap(h, root), {
    '今日完成率': { value: '0%', sub: '0 / 0' },
    '本周完成': { value: '0 / 0', sub: '完成率 0%' },
    '本月完成': { value: '0 / 0', sub: '完成率 0%' },
    '逾期任务': { value: '0', sub: '未处理' },
    '累计已完成': { value: '0', sub: '全部' },
  });
  assert.deepStrictEqual(h.texts('.quad-value', root), ['0', '0', '0', '0']);
  assert.ok(root.textContent.indexOf('NaN') < 0, '空数据下不应出现 NaN');
  assert.ok(h.logs.length === 0, '不应有 console 报错：' + JSON.stringify(h.logs));
});
