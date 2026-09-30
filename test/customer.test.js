/*
 * customer.test.js — 客户商机跟进纯函数测试
 * 覆盖：金额流水派生（预估/落单/增购）、落单唯一性、阶段留痕、跟进待办生成、排序与统计。
 */
const test = require('node:test');
const assert = require('node:assert');
const cust = require('../shared/customer.js');

const DAY = 86400000;
// 固定「当前时间」，避免测试随真实时间漂移
const NOW = new Date('2026-03-10T10:00:00').getTime();

function mkCustomer(over) {
  return Object.assign({
    id: 'c1', name: '张三', contact: '张总', stage: 'lead',
    amountHistory: [], stageHistory: [{ stage: 'lead', at: 1000 }],
    createdAt: 1000, updatedAt: 1000,
  }, over || {});
}

test('amountSummary：无流水时全部为 0', function () {
  const s = cust.amountSummary(mkCustomer());
  assert.deepStrictEqual(
    { expected: s.expected, deal: s.deal, upsellTotal: s.upsellTotal, won: s.won, hasDeal: s.hasDeal },
    { expected: 0, deal: 0, upsellTotal: 0, won: 0, hasDeal: false }
  );
});

test('addAmount：预估可多次调整，取最新为当前预估', function () {
  let c = mkCustomer();
  c = cust.addAmount(c, { kind: 'estimate', amount: 500000, at: 1000 });
  c = cust.addAmount(c, { kind: 'estimate', amount: 800000, at: 2000, note: '追加范围' });
  const s = cust.amountSummary(c);
  assert.strictEqual(s.expected, 800000, '预估应取最新一条');
  assert.strictEqual(c.amountHistory.length, 2, '历史流水保留（可回溯）');
  assert.strictEqual(s.hasDeal, false);
});

test('addAmount：落单确认 + 增购累加 = 累计成交', function () {
  let c = mkCustomer({ stage: 'won' });
  c = cust.addAmount(c, { kind: 'estimate', amount: 800000, at: 1000 });
  c = cust.addAmount(c, { kind: 'deal', amount: 1000000, at: 2000 });
  c = cust.addAmount(c, { kind: 'upsell', amount: 200000, at: 3000, note: '增购模块' });
  const s = cust.amountSummary(c);
  assert.strictEqual(s.deal, 1000000);
  assert.strictEqual(s.upsellTotal, 200000);
  assert.strictEqual(s.won, 1200000, '累计成交 = 落单 + 增购');
  assert.strictEqual(s.hasDeal, true);
});

test('addAmount：落单只允许一次（后续必须走增购）', function () {
  let c = mkCustomer();
  c = cust.addAmount(c, { kind: 'deal', amount: 100, at: 1000 });
  const before = c.amountHistory.length;
  c = cust.addAmount(c, { kind: 'deal', amount: 999, at: 2000 }); // 应被拒绝
  assert.strictEqual(c.amountHistory.length, before);
  assert.strictEqual(cust.amountSummary(c).deal, 100);
});

test('addAmount：非法金额/类型被拒绝，且不修改入参', function () {
  const c = mkCustomer();
  assert.strictEqual(cust.addAmount(c, { kind: 'estimate', amount: -5 }).amountHistory.length, 0);
  assert.strictEqual(cust.addAmount(c, { kind: 'estimate', amount: 'abc' }).amountHistory.length, 0);
  assert.strictEqual(cust.addAmount(c, { kind: 'bogus', amount: 100 }).amountHistory.length, 0);
  assert.strictEqual(c.amountHistory.length, 0, '原对象不应被修改');
});

test('canUpsell：仅赢单后可增购', function () {
  assert.strictEqual(cust.canUpsell(mkCustomer({ stage: 'won' })), true);
  assert.strictEqual(cust.canUpsell(mkCustomer({ stage: 'negotiate' })), false);
  assert.strictEqual(cust.canUpsell(mkCustomer({ stage: 'lost' })), false);
});

test('changeStage：变更并留痕、记录终态时间', function () {
  let c = mkCustomer();
  c = cust.changeStage(c, 'needs', 2000);
  c = cust.changeStage(c, 'won', 5000);
  assert.strictEqual(c.stage, 'won');
  assert.strictEqual(c.stageHistory.length, 3);
  assert.deepStrictEqual(c.stageHistory.map(function (h) { return h.stage; }), ['lead', 'needs', 'won']);
  assert.strictEqual(c.wonAt, 5000);
});

test('changeStage：同阶段不变更、非法阶段被忽略', function () {
  const c = mkCustomer({ stage: 'needs', stageHistory: [{ stage: 'needs', at: 1 }] });
  assert.strictEqual(cust.changeStage(c, 'needs', 9).stageHistory.length, 1);
  assert.strictEqual(cust.changeStage(c, 'bogus', 9).stage, 'needs');
});

test('stageDurations：可算出每阶段停留天数', function () {
  const DAY = 86400000;
  const c = mkCustomer({ stageHistory: [{ stage: 'lead', at: 0 }, { stage: 'needs', at: 3 * DAY }] });
  const d = cust.stageDurations(c, 5 * DAY);
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].days, 3);
  assert.strictEqual(d[1].days, 2);
});

test('nextFollowupAt：取最新一条跟进记录的 nextAt', function () {
  const c = mkCustomer();
  const fus = [
    { id: 'f1', customerId: 'c1', at: 1000, nextAt: 5000 },
    { id: 'f2', customerId: 'c1', at: 3000, nextAt: 9000 },
    { id: 'fx', customerId: 'other', at: 9999, nextAt: 11111 },
  ];
  assert.strictEqual(cust.nextFollowupAt(c, fus), 9000);
  assert.strictEqual(cust.nextFollowupAt(c, []), null);
});

test('buildFollowupTodo：生成待办，deadline = 下次跟进时间（复用提醒）', function () {
  const c = mkCustomer({ stage: 'demo' });
  const todo = cust.buildFollowupTodo(c, { id: 'f1', nextAt: 1700000000000, nextPlan: '准备演示环境' }, { now: 1 });
  assert.strictEqual(todo.deadline, 1700000000000); // ★ 靠这个复用待办提醒
  assert.strictEqual(todo.status, 'pending');
  assert.strictEqual(todo.customerId, 'c1');
  assert.strictEqual(todo.followupTag, true);
  assert.ok(todo.title.indexOf('张三') >= 0);
  assert.ok(todo.title.indexOf('系统演示') >= 0);
  assert.strictEqual(todo.importance, 'important');
  assert.ok(todo.remindBefore > 0, '默认带提醒');
});

test('sortCustomers：推进中的在前，超期未跟进的排最前', function () {
  const now = 10000;
  const cs = [
    mkCustomer({ id: 'won1', name: 'A', stage: 'won' }),
    mkCustomer({ id: 'later', name: 'B', stage: 'needs' }),
    mkCustomer({ id: 'overdue', name: 'C', stage: 'quote' }),
  ];
  const fus = [
    { id: 'f1', customerId: 'later', at: 1, nextAt: now + 86400000 },
    { id: 'f2', customerId: 'overdue', at: 1, nextAt: now - 86400000 }, // 已超期
  ];
  const sorted = cust.sortCustomers(cs, fus, now);
  assert.strictEqual(sorted[0].id, 'overdue', '超期的排最前');
  assert.strictEqual(sorted[1].id, 'later');
  assert.strictEqual(sorted[2].id, 'won1', '已赢单排最后');
});

test('isOverdue / isClosed 判定', function () {
  assert.strictEqual(cust.isOverdue(999, 1000), true);
  assert.strictEqual(cust.isOverdue(1001, 1000), false);
  assert.strictEqual(cust.isOverdue(null, 1000), false);
  assert.strictEqual(cust.isClosed(mkCustomer({ stage: 'won' })), true);
  assert.strictEqual(cust.isClosed(mkCustomer({ stage: 'lost' })), true);
  assert.strictEqual(cust.isClosed(mkCustomer({ stage: 'demo' })), false);
});

test('summarize：漏斗口径（在谈预估）与业绩口径（实际成交）分开', function () {
  const cs = [
    mkCustomer({ id: 'a', stage: 'needs', amountHistory: [{ kind: 'estimate', amount: 100, at: 1 }] }),
    mkCustomer({ id: 'b', stage: 'quote', amountHistory: [{ kind: 'estimate', amount: 200, at: 1 }] }),
    mkCustomer({ id: 'c', stage: 'won', amountHistory: [
      { kind: 'deal', amount: 500, at: 1 }, { kind: 'upsell', amount: 50, at: 2 },
    ] }),
    mkCustomer({ id: 'd', stage: 'lost', amountHistory: [{ kind: 'estimate', amount: 999, at: 1 }] }),
  ];
  const s = cust.summarize(cs);
  assert.strictEqual(s.activeCount, 2);
  assert.strictEqual(s.wonCount, 1);
  assert.strictEqual(s.lostCount, 1);
  assert.strictEqual(s.expectedTotal, 300, '漏斗只看未成交的预估（不含丢单 999）');
  assert.strictEqual(s.wonTotal, 550);
  assert.strictEqual(s.upsellTotal, 50);
  assert.strictEqual(s.byStage.needs.count, 1);
  assert.strictEqual(s.byStage.won.won, 550);
});

test('groupByStage：按阶段分组，空阶段也在', function () {
  const g = cust.groupByStage([mkCustomer({ id: 'a', stage: 'demo' })]);
  assert.strictEqual(g.demo.length, 1);
  assert.strictEqual(g.won.length, 0);
  assert.ok(g.lead);
});

// ---------------- 团队视角（多人共用商机库） ----------------
// 场景：一个团队共用同一份商机库，必须能回答「谁负责哪些客户」「今天该跟谁」。

function teamCustomers() {
  return [
    mkCustomer({ id: 'a', name: '张三公司', contact: '张三', phone: '13800000001', owner: '李四', stage: 'lead' }),
    mkCustomer({ id: 'b', name: 'Beta科技', contact: 'Bob', phone: '13900000002', owner: '王五', stage: 'negotiating' }),
    mkCustomer({ id: 'c', name: 'Gamma', contact: 'C', phone: '13700000003', owner: '', stage: 'won',
      amountHistory: [{ kind: 'deal', amount: 80000, at: NOW }] }),
  ];
}

test('ownerList：去重、去空白、不含空负责人，供筛选下拉使用', function () {
  const cs = teamCustomers().concat([mkCustomer({ id: 'd', owner: '  李四  ' })]);
  assert.deepStrictEqual(cust.ownerList(cs), ['李四', '王五']);
  assert.deepStrictEqual(cust.ownerList([]), []);
});

test('filterByOwner：按负责人筛选，空串表示「未分配」', function () {
  const cs = teamCustomers();
  assert.deepStrictEqual(cust.filterByOwner(cs, '李四').map(function (c) { return c.id; }), ['a']);
  assert.deepStrictEqual(cust.filterByOwner(cs, '').map(function (c) { return c.id; }), ['c']);
  assert.deepStrictEqual(cust.filterByOwner(cs, '不存在的人'), []);
});

test('searchCustomers：名称/联系人/电话/负责人 均可命中，且忽略大小写', function () {
  const cs = teamCustomers();
  assert.deepStrictEqual(cust.searchCustomers(cs, '张三').map(function (c) { return c.id; }), ['a']);
  assert.deepStrictEqual(cust.searchCustomers(cs, 'BETA').map(function (c) { return c.id; }), ['b'], '应忽略大小写');
  assert.deepStrictEqual(cust.searchCustomers(cs, '13700000003').map(function (c) { return c.id; }), ['c'], '应支持按电话搜');
  assert.deepStrictEqual(cust.searchCustomers(cs, '王五').map(function (c) { return c.id; }), ['b'], '应支持按负责人搜');
  assert.strictEqual(cust.searchCustomers(cs, '  ').length, 3, '空关键词返回全部');
});

test('followupBuckets：分出逾期/今天/本周/未安排，且已成交客户不再催跟进', function () {
  const cs = teamCustomers();
  const fus = [
    { id: 'f1', customerId: 'a', at: NOW - 5 * DAY, nextAt: NOW - 2 * DAY },        // 逾期
    { id: 'f2', customerId: 'b', at: NOW - DAY, nextAt: NOW + 3 * 3600 * 1000 },   // 今天
  ];
  const b = cust.followupBuckets(cs, fus, NOW);
  assert.deepStrictEqual(b.overdue.map(function (c) { return c.id; }), ['a']);
  assert.deepStrictEqual(b.today.map(function (c) { return c.id; }), ['b']);
  assert.deepStrictEqual(b.none.map(function (c) { return c.id; }), [],
    'c 已赢单属终态，不应出现在「未安排跟进」里');
});

test('followupBuckets：本周内与本周之后分开，未安排单独成桶', function () {
  const cs = [
    mkCustomer({ id: 'w', owner: '李四' }),
    mkCustomer({ id: 'l', owner: '李四' }),
    mkCustomer({ id: 'n', owner: '李四' }),
  ];
  const fus = [
    { id: 'f1', customerId: 'w', at: NOW, nextAt: NOW + 3 * DAY },
    { id: 'f2', customerId: 'l', at: NOW, nextAt: NOW + 20 * DAY },
  ];
  const b = cust.followupBuckets(cs, fus, NOW);
  assert.deepStrictEqual(b.week.map(function (c) { return c.id; }), ['w']);
  assert.deepStrictEqual(b.later.map(function (c) { return c.id; }), ['l']);
  assert.deepStrictEqual(b.none.map(function (c) { return c.id; }), ['n']);
});

test('summarizeByOwner：按负责人给出在谈/成交/该跟进数量，含「未分配」一组', function () {
  const cs = teamCustomers();
  const fus = [
    { id: 'f1', customerId: 'a', at: NOW - 5 * DAY, nextAt: NOW - 2 * DAY },
    { id: 'f2', customerId: 'b', at: NOW - DAY, nextAt: NOW + 3 * 3600 * 1000 },
  ];
  const rows = cust.summarizeByOwner(cs, fus, NOW);
  const byOwner = {};
  rows.forEach(function (r) { byOwner[r.owner] = r; });

  assert.deepStrictEqual(Object.keys(byOwner).sort(), ['', '李四', '王五'], '应有「未分配」分组');
  assert.strictEqual(byOwner['李四'].activeCount, 1);
  assert.strictEqual(byOwner['李四'].overdueCount, 1, '李四名下 1 个逾期未跟进');
  assert.strictEqual(byOwner['王五'].dueTodayCount, 1, '王五名下 1 个今天该跟进');
  assert.strictEqual(byOwner[''].wonCount, 1);
  assert.strictEqual(byOwner[''].wonTotal, 80000, '未分配组的成交额也应统计到');
});

test('summarizeByOwner：无人分配时只返回「未分配」一组，不会凭空造出负责人', function () {
  const cs = [mkCustomer({ id: 'x', owner: '' })];
  const rows = cust.summarizeByOwner(cs, [], NOW);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].owner, '');
  assert.strictEqual(rows[0].total, 1);
});
