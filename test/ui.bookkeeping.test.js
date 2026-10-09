/*
 * ui.bookkeeping.test.js — 记账页「明细」与「合计」必须一致（jsdom 真实 DOM）
 *
 * 起因（交付测试发现）：明细列表用 `t.date >= from && t.date < to` 过滤，
 * 而合计走 shared/bookkeeping.monthlySummary。界面写入的 date 是**数字时间戳**，
 * 但导入的旧数据 / 手改的 JSON 里 date 可能是 'YYYY-MM-DD' **字符串**。
 * 数字与字符串比较时 JS 会把字符串转成 NaN，比较恒为 false：
 *   - 合计那条 `t.date < from || t.date >= to` → 两个条件都 false → 这一条被算进合计；
 *   - 明细那条 `t.date >= from && t.date < to` → false → 这一条被过滤掉。
 * 结果就是用户看到的「本月合计里有钱，明细却是空的」，让人以为流水丢了。
 *
 * 所以这里钉两条硬约束：
 *   1. 日期是数字还是字符串，结论必须完全一致；
 *   2. 界面上列出的流水条数 == 纯函数算出来的条数（两条路径不许各说各话）。
 * 时间冻结在 2026-03-10，所以「本月」边界确定。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { setupUi, flush, FIXED_NOW } = require('./ui.helpers.js');
const BK = require('../shared/bookkeeping.js');

const ts = function (y, m, d, hh, mm) { return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime(); };

// 2026-03 当月边界（本地时区）：from = 2026-03-01 00:00，to = 2026-04-01 00:00
const FROM = ts(2026, 3, 1);
const TO = ts(2026, 4, 1);

function txn(id, opts) {
  return Object.assign({
    id: id, type: 'expense', amount: 1000, categoryId: 'cat-1', accountId: 'acc-1',
    date: ts(2026, 3, 5), note: id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  }, opts || {});
}

// 覆盖 4 种组合：数字/字符串 × 本月内/本月外
function sampleTxns() {
  return [
    txn('num-in', { date: ts(2026, 3, 5), amount: 1100 }),        // 数字 · 本月
    txn('str-in', { date: '2026-03-06', amount: 2200 }),          // 字符串 · 本月（导入的旧数据）
    txn('str-slash', { date: '2026/03/07', amount: 3300 }),       // 字符串斜杠 · 本月
    txn('num-prev', { date: ts(2026, 2, 28, 23, 59), amount: 4400 }), // 数字 · 上月
    txn('str-prev', { date: '2026-02-15', amount: 5500 }),        // 字符串 · 上月
    txn('str-next', { date: '2026-04-01', amount: 6600 }),        // 字符串 · 下月（to 不含）
    txn('num-next', { date: ts(2026, 4, 2), amount: 7700 }),      // 数字 · 下月
  ];
}

async function openBookkeeping(txns) {
  const h = await setupUi({
    now: FIXED_NOW,
    data: {
      bookkeepingCategories: [{ id: 'cat-1', name: '餐饮', type: 'expense', color: '#ff7a45' }],
      accounts: [{ id: 'acc-1', name: '招行', type: 'bank', initialBalance: 0, currency: 'CNY' }],
      transactions: txns,
      budgets: [],
    },
  });
  const root = h.renderView('bookkeeping');
  await flush();
  return { h: h, root: root };
}

const rows = function (h) {
  return h.qsa('#view-bookkeeping .item').map(function (r) {
    return {
      title: r.querySelector('.item-title').textContent.trim(),
      meta: r.querySelector('.item-meta').textContent.trim(),
      amount: r.querySelector('.item-amount').textContent.trim(),
    };
  });
};

test('明细：字符串日期（导入的旧数据）必须和数字日期一样显示出来', async function (t) {
  const txns = sampleTxns();
  const { h } = await openBookkeeping(txns);
  t.after(function () { h.close(); });

  const shown = rows(h);
  assert.strictEqual(shown.length, 3,
    '本月应有 3 条（数字 1 条 + 字符串 2 条），实际 ' + shown.length + '：' +
    JSON.stringify(shown.map(function (r) { return r.title; })));

  const titles = shown.map(function (r) { return r.title; }).join(' | ');
  assert.ok(titles.indexOf('num-in') >= 0, '数字日期那条要在：' + titles);
  assert.ok(titles.indexOf('str-in') >= 0, '字符串日期那条也要在（这正是丢过的数据）：' + titles);
  assert.ok(titles.indexOf('str-slash') >= 0, '斜杠格式的字符串日期也要在：' + titles);

  const text = h.view('bookkeeping').textContent;
  assert.ok(text.indexOf('本月暂无流水') < 0, '有本月流水时不该提示「本月暂无流水」');
});

test('明细：不在本月的流水不显示（含 to 不含的 4/1 那条）', async function (t) {
  const txns = sampleTxns();
  const { h } = await openBookkeeping(txns);
  t.after(function () { h.close(); });

  const titles = rows(h).map(function (r) { return r.title; }).join(' | ');
  ['num-prev', 'str-prev', 'str-next', 'num-next'].forEach(function (id) {
    assert.ok(titles.indexOf(id) < 0, id + ' 不该出现在本月明细里：' + titles);
  });
});

test('明细条数 == 纯函数算出的条数（两条路径不许各说各话）', async function (t) {
  const txns = sampleTxns();
  const { h } = await openBookkeeping(txns);
  t.after(function () { h.close(); });

  // 用共享纯函数独立算一遍（不依赖界面实现）
  const expected = txns.filter(function (x) { return BK.inRange(x.date, FROM, TO); });
  assert.strictEqual(expected.length, 3);

  const summary = BK.monthlySummary(txns, FROM, TO);
  assert.strictEqual(summary.expense, 1100 + 2200 + 3300, '合计口径');

  const shown = rows(h);
  assert.strictEqual(shown.length, expected.length,
    '界面上列出的条数必须等于纯函数算出的条数：界面 ' + shown.length + ' vs 纯函数 ' + expected.length);

  // 金额合计也要对得上（界面显示的是「分转元」字符串）
  const uiSum = shown.reduce(function (a, r) {
    return a + Math.round(parseFloat(r.amount.replace('-', '')) * 100);
  }, 0);
  assert.strictEqual(uiSum, summary.expense, '界面明细金额合计 == 纯函数合计');
});

test('inRange / txnTime：数字、字符串、斜杠、带时间、非法值都要正确', function () {
  // 数字
  assert.strictEqual(BK.inRange(ts(2026, 3, 5), FROM, TO), true);
  assert.strictEqual(BK.inRange(ts(2026, 2, 28), FROM, TO), false);
  // 字符串日期
  assert.strictEqual(BK.inRange('2026-03-05', FROM, TO), true);
  assert.strictEqual(BK.inRange('2026-03-05', '2026-03-01', '2026-04-01'), true);
  assert.strictEqual(BK.inRange('2026-04-01', FROM, TO), false, 'to 不含');
  assert.strictEqual(BK.inRange('2026-03-01', FROM, TO), true, 'from 含');
  // 斜杠 / 带时间 / ISO
  assert.strictEqual(BK.inRange('2026/03/05', FROM, TO), true);
  assert.strictEqual(BK.inRange('2026-03-05 23:59', FROM, TO), true);
  assert.strictEqual(BK.inRange('2026-03-05T10:00:00', FROM, TO), true);
  // 数字字符串按时间戳处理
  assert.strictEqual(BK.inRange(String(ts(2026, 3, 5)), FROM, TO), true);
  // 非法值：不参与区间判定，绝不能因此被算进合计
  assert.strictEqual(BK.inRange(null, FROM, TO), false);
  assert.strictEqual(BK.inRange('', FROM, TO), false);
  assert.strictEqual(BK.inRange('不是日期', FROM, TO), false);
  assert.strictEqual(BK.txnTime(null), null);
  assert.strictEqual(BK.txnTime('2026-03-05'), ts(2026, 3, 5));
  // 混合区间的 from/to（一个数字一个字符串）也要能比
  assert.strictEqual(BK.inRange('2026-03-05', FROM, '2026-04-01'), true);
  assert.strictEqual(BK.inRange(ts(2026, 3, 5), '2026-03-01', TO), true);
});

test('monthlySummary / categoryBreakdown / budgetStatus 三条路径口径一致', function () {
  const txns = sampleTxns();
  const cats = [{ id: 'cat-1', name: '餐饮', type: 'expense', color: '#ff7a45' }];
  const summary = BK.monthlySummary(txns, FROM, TO);
  assert.strictEqual(summary.expense, 6600);

  const breakdown = BK.categoryBreakdown(txns, cats, FROM, TO);
  assert.strictEqual(breakdown.length, 1);
  assert.strictEqual(breakdown[0].amount, 6600, '分类构成必须与合计一致（同样含字符串日期）');

  const budgets = [{ id: 'b1', amount: 5000, categoryId: 'cat-1' }];
  const bs = BK.budgetStatus(budgets, txns, FROM, TO);
  assert.strictEqual(bs[0].spent, 6600, '预算已花金额也必须一致');
});
