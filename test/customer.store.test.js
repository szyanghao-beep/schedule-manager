/*
 * customer.store.test.js — 桌面端 store 的客户/跟进业务逻辑测试
 * 重点：记录跟进自动生成跟进待办（deadline = 下次跟进时间）、阶段留痕、金额约束、级联删除。
 */
const test = require('node:test');
const assert = require('node:assert');

// 渲染层 store 依赖 window 上的 Utils / CustomerUtil / API，这里提供最小 shim
global.window = {
  API: { saveData: function () {} },
  Utils: require('../shared/utils.js'),
  CustomerUtil: require('../shared/customer.js'),
};
require('../src/renderer/js/store.js');
const Store = global.window.Store;
const CU = global.window.CustomerUtil;

const DAY = 86400000;

function reset() {
  Store.set({ categories: [], events: [], todos: [], customers: [], followups: [], settings: {} });
}

test('addCustomer：默认阶段 lead 且写入初始阶段留痕', function () {
  reset();
  const c = Store.addCustomer({ id: 'c1', name: '某科技公司' });
  assert.strictEqual(c.stage, 'lead');
  assert.strictEqual(c.stageHistory.length, 1);
  assert.strictEqual(c.stageHistory[0].stage, 'lead');
  assert.ok(Array.isArray(c.amountHistory));
});

test('recordFollowup：自动生成跟进待办，deadline = 下次跟进时间（复用提醒）', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: '某科技公司' });
  const nextAt = Date.now() + 3 * DAY;
  const res = Store.recordFollowup('c1', { method: 'visit', content: '演示完成', nextAt: nextAt, nextPlan: '出报价' });

  assert.ok(res && res.followup && res.todo);
  assert.strictEqual(res.todo.deadline, nextAt, '★ 待办截止时间 = 下次跟进时间');
  assert.strictEqual(res.todo.customerId, 'c1');
  assert.strictEqual(res.todo.followupTag, true);
  assert.strictEqual(res.todo.status, 'pending');
  assert.ok(res.todo.title.indexOf('某科技公司') >= 0);
  assert.strictEqual(Store.get().todos.length, 1);
  assert.strictEqual(res.followup.todoId, res.todo.id, '跟进记录回填待办 id');
});

test('recordFollowup：再次跟进更新同一条未完成待办（不重复堆积）', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  const r1 = Store.recordFollowup('c1', { nextAt: Date.now() + DAY });
  const r2 = Store.recordFollowup('c1', { nextAt: Date.now() + 5 * DAY });

  assert.strictEqual(Store.get().todos.length, 1, '同一客户只保留一条未完成跟进待办');
  assert.strictEqual(Store.get().todos[0].id, r1.todo.id);
  assert.strictEqual(Store.get().todos[0].deadline, r2.followup.nextAt);
  assert.strictEqual(Store.get().followups.length, 2, '但跟进历史保留两条');
});

test('recordFollowup：不填下次跟进时间则不生成待办（但记录仍保存）', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  const res = Store.recordFollowup('c1', { content: '随便聊了聊', nextAt: null });
  assert.strictEqual(res.todo, null);
  assert.strictEqual(Store.get().todos.length, 0);
  assert.strictEqual(Store.get().followups.length, 1);
});

test('updateCustomer 改阶段：写入 stageHistory 留痕', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  Store.updateCustomer('c1', { stage: 'quote' });
  const c = Store.get().customers[0];
  assert.strictEqual(c.stage, 'quote');
  assert.deepStrictEqual(c.stageHistory.map(function (h) { return h.stage; }), ['lead', 'quote']);
});

test('addCustomerAmount：预估可多次调整；未赢单不能增购', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  assert.ok(Store.addCustomerAmount('c1', { kind: 'estimate', amount: 100000 }));
  assert.ok(Store.addCustomerAmount('c1', { kind: 'estimate', amount: 200000 }));
  assert.strictEqual(CU.amountSummary(Store.get().customers[0]).expected, 200000);

  const rejected = Store.addCustomerAmount('c1', { kind: 'upsell', amount: 50000 });
  assert.strictEqual(rejected, null, '未赢单不能增购');
});

test('addCustomerAmount：落单一次 + 赢单后增购累加', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  Store.addCustomerAmount('c1', { kind: 'deal', amount: 300000 });
  assert.strictEqual(Store.addCustomerAmount('c1', { kind: 'deal', amount: 999 }), null, '落单只允许一次');

  Store.updateCustomer('c1', { stage: 'won' });
  assert.ok(Store.addCustomerAmount('c1', { kind: 'upsell', amount: 50000 }));
  const sum = CU.amountSummary(Store.get().customers[0]);
  assert.strictEqual(sum.won, 350000, '累计成交 = 落单 + 增购');
});

test('deleteCustomer：级联软删除跟进记录与未完成的跟进待办', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  Store.recordFollowup('c1', { nextAt: Date.now() + DAY });
  assert.strictEqual(Store.get().todos.length, 1);

  Store.deleteCustomer('c1');
  assert.strictEqual(Store.get().customers.length, 0, '客户已软删除');
  assert.strictEqual(Store.get().followups.length, 0, '跟进记录级联删除');
  assert.strictEqual(Store.get().todos.length, 0, '未完成跟进待办级联删除');
  // 墓碑仍在（同步需要）
  assert.strictEqual(Store.getRaw().customers.filter(function (x) { return x.deleted; }).length, 1);
});

test('跟进待办为普通待办：能进四象限并被统计（能力复用验证）', function () {
  reset();
  Store.addCustomer({ id: 'c1', name: 'A公司' });
  const res = Store.recordFollowup('c1', { nextAt: Date.now() + 2 * 3600000 }); // 2 小时后
  const todo = Store.get().todos[0];
  const Utils = global.window.Utils;
  const q = Utils.calcQuadrant(todo, Date.now(), 24 * 3600000);
  assert.strictEqual(q, 'q1', '2 小时内到期的跟进待办 → 重要且紧急（Q1）');
  assert.strictEqual(Utils.displayStatus(todo, Date.now()), 'pending');
  assert.ok(res.followup.nextAt === todo.deadline);
});
