/*
 * bookkeeping.test.js — 收支记账纯函数测试（node --test）
 * 覆盖金额换算、流水流向、账户余额、区间汇总、分类构成、预算状态、转账构建。
 */
const test = require('node:test');
const assert = require('node:assert');
const BK = require('../shared/bookkeeping.js');

const DAY = 86400000;
const FROM = new Date('2026-08-01T00:00:00').getTime();
const TO = new Date('2026-09-01T00:00:00').getTime();

// ---------- formatCents / yuanToCents ----------
test('formatCents：分转元字符串，补零与负数', function () {
  assert.strictEqual(BK.formatCents(1234), '12.34');
  assert.strictEqual(BK.formatCents(5), '0.05');
  assert.strictEqual(BK.formatCents(100), '1.00');
  assert.strictEqual(BK.formatCents(-1234), '-12.34');
  assert.strictEqual(BK.formatCents(0), '0.00');
  assert.strictEqual(BK.formatCents(null), '0.00');
});

test('yuanToCents：元转分，四舍五入，非法返回 null', function () {
  assert.strictEqual(BK.yuanToCents('12.34'), 1234);
  assert.strictEqual(BK.yuanToCents(0.1), 10);
  assert.strictEqual(BK.yuanToCents('12.345'), 1235); // 四舍五入
  assert.strictEqual(BK.yuanToCents(''), null);
  assert.strictEqual(BK.yuanToCents('abc'), null);
  assert.strictEqual(BK.yuanToCents(null), null);
});

// ---------- txnFlow / accountBalance ----------
test('txnFlow：收入流入、支出流出、转账双向', function () {
  const income = { type: 'income', amount: 5000, accountId: 'a1' };
  const expense = { type: 'expense', amount: 2000, accountId: 'a1' };
  const transfer = { type: 'transfer', amount: 1000, accountId: 'a1', toAccountId: 'a2' };
  assert.strictEqual(BK.txnFlow(income, 'a1'), 5000);
  assert.strictEqual(BK.txnFlow(income, 'a2'), 0);
  assert.strictEqual(BK.txnFlow(expense, 'a1'), -2000);
  assert.strictEqual(BK.txnFlow(transfer, 'a1'), -1000); // 转出
  assert.strictEqual(BK.txnFlow(transfer, 'a2'), 1000);  // 转入
  assert.strictEqual(BK.txnFlow(transfer, 'a3'), 0);
  assert.strictEqual(BK.txnFlow({ type: 'income', amount: 100, accountId: 'a1', deleted: true }, 'a1'), 0);
});

test('accountBalance：初始余额 + 全部流水净额', function () {
  const account = { id: 'a1', initialBalance: 10000 };
  const txns = [
    { type: 'income', amount: 5000, accountId: 'a1' },
    { type: 'expense', amount: 3000, accountId: 'a1' },
    { type: 'transfer', amount: 1000, accountId: 'a2', toAccountId: 'a1' }, // 转入
  ];
  assert.strictEqual(BK.accountBalance(account, txns), 13000);
});

// ---------- monthlySummary ----------
test('monthlySummary：区间收支汇总，转账不计入', function () {
  const txns = [
    { type: 'income', amount: 10000, accountId: 'a1', date: FROM },
    { type: 'expense', amount: 4000, accountId: 'a1', date: FROM + 1 },
    { type: 'transfer', amount: 999, accountId: 'a1', toAccountId: 'a2', date: FROM + 2 },
    { type: 'expense', amount: 500, accountId: 'a1', date: TO }, // 边界：不含
  ];
  const s = BK.monthlySummary(txns, FROM, TO);
  assert.strictEqual(s.income, 10000);
  assert.strictEqual(s.expense, 4000);
  assert.strictEqual(s.net, 6000);
});

// ---------- categoryBreakdown ----------
test('categoryBreakdown：收入/支出分开聚合，金额降序并补色', function () {
  const categories = [
    { id: 'c1', name: '餐饮', color: '#e05b5b', type: 'expense' },
    { id: 'c2', name: '交通', color: '#4f8ef7', type: 'expense' },
    { id: 'c3', name: '工资', color: '#4caf7d', type: 'income' },
  ];
  const txns = [
    { type: 'expense', amount: 3000, categoryId: 'c1', date: FROM },
    { type: 'expense', amount: 1000, categoryId: 'c2', date: FROM },
    { type: 'expense', amount: 500, categoryId: 'c1', date: FROM },
    { type: 'expense', amount: 888, categoryId: null, date: FROM }, // 未分类不计入
    { type: 'income', amount: 9999, categoryId: 'c3', date: FROM },
  ];
  const breakdown = BK.categoryBreakdown(txns, categories, FROM, TO);
  assert.strictEqual(breakdown.length, 3);
  // 金额降序：9999(工资) -> 3500(餐饮) -> 1000(交通)
  assert.strictEqual(breakdown[0].categoryId, 'c3');
  assert.strictEqual(breakdown[0].type, 'income');
  assert.strictEqual(breakdown[0].amount, 9999);
  const c1 = breakdown.find(function (b) { return b.categoryId === 'c1'; });
  assert.strictEqual(c1.amount, 3500);
  assert.strictEqual(c1.type, 'expense');
  assert.strictEqual(c1.name, '餐饮');
  const c2 = breakdown.find(function (b) { return b.categoryId === 'c2'; });
  assert.strictEqual(c2.amount, 1000);
});

test('categoryBreakdown：同一分类的收入与支出分开统计', function () {
  const categories = [{ id: 'c1', name: '餐', color: '#e05b5b', type: 'expense' }];
  const txns = [
    { type: 'expense', amount: 2000, categoryId: 'c1', date: FROM },
    { type: 'income', amount: 500, categoryId: 'c1', date: FROM },
  ];
  const breakdown = BK.categoryBreakdown(txns, categories, FROM, TO);
  assert.strictEqual(breakdown.length, 2);
  const expense = breakdown.find(function (b) { return b.type === 'expense'; });
  const income = breakdown.find(function (b) { return b.type === 'income'; });
  assert.strictEqual(expense.amount, 2000);
  assert.strictEqual(income.amount, 500);
});

// ---------- budgetStatus ----------
test('budgetStatus：总预算与分类预算，超支判定', function () {
  const budgets = [
    { id: 'b1', categoryId: null, period: 'monthly', amount: 5000 },      // 总预算
    { id: 'b2', categoryId: 'c1', period: 'monthly', amount: 2000 },      // 分类预算
  ];
  const txns = [
    { type: 'expense', amount: 1500, categoryId: 'c1', date: FROM },
    { type: 'expense', amount: 1000, categoryId: 'c2', date: FROM },
    { type: 'income', amount: 9999, date: FROM },
  ];
  const statuses = BK.budgetStatus(budgets, txns, FROM, TO);
  const total = statuses.find(function (s) { return s.budget.id === 'b1'; });
  const cat = statuses.find(function (s) { return s.budget.id === 'b2'; });
  assert.strictEqual(total.spent, 2500);   // 全部支出
  assert.strictEqual(total.remaining, 2500);
  assert.strictEqual(total.over, false);
  assert.strictEqual(cat.spent, 1500);     // 仅 c1 支出
  assert.strictEqual(cat.remaining, 500);
  assert.strictEqual(cat.over, false);
});

test('budgetStatus：支出超过限额 -> over 为 true 且 remaining 为负', function () {
  const budgets = [{ id: 'b1', categoryId: null, amount: 100 }];
  const txns = [{ type: 'expense', amount: 300, categoryId: 'c1', date: FROM }];
  const s = BK.budgetStatus(budgets, txns, FROM, TO)[0];
  assert.strictEqual(s.over, true);
  assert.ok(s.remaining < 0);
  assert.ok(s.ratio > 1);
});

test('budgetStatus：未分类支出计入总预算', function () {
  const budgets = [{ id: 'b1', categoryId: null, amount: 1000 }];
  const txns = [
    { type: 'expense', amount: 300, categoryId: null, date: FROM }, // 未分类支出
    { type: 'expense', amount: 500, categoryId: 'c1', date: FROM },
  ];
  const s = BK.budgetStatus(budgets, txns, FROM, TO)[0];
  assert.strictEqual(s.spent, 800);      // 未分类 300 + 分类 500
  assert.strictEqual(s.remaining, 200);
  assert.strictEqual(s.over, false);
});

// ---------- buildTransfer ----------
test('buildTransfer：构建转账流水（信用卡还款）', function () {
  const t = BK.buildTransfer('bank', 'credit', 5000, FROM, '还信用卡');
  assert.strictEqual(t.type, 'transfer');
  assert.strictEqual(t.accountId, 'bank');
  assert.strictEqual(t.toAccountId, 'credit');
  assert.strictEqual(t.amount, 5000);
  assert.strictEqual(t.categoryId, null);
  assert.strictEqual(t.note, '还信用卡');
});
