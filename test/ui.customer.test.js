/*
 * ui.customer.test.js — 客户商机页渲染层 UI 测试（jsdom 真实 DOM）
 *
 * 覆盖：统计卡片数字、默认「推进中」筛选与阶段筛选、金额展示口径（预估 vs 成交+增购）、
 *       详情展开（金额口径/金额流水/阶段停留/跟进时间线/关联事项）、
 *       以及两条核心交互链路：录跟进自动生成跟进待办、阶段改「赢单」强制落单确认。
 * 金额派生逻辑用 shared/customer.js（纯函数）独立算一遍做交叉验证，防止界面与计算脱节。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { setupUi, flush, FIXED_NOW, DAY } = require('./ui.helpers.js');
const CU = require('../shared/customer.js');

const HOUR = 3600e3;

function sampleData() {
  return {
    customers: [
      {
        id: 'k1', name: '甲方公司', stage: 'lead', contact: '张三', phone: '13800000000', owner: '小李', remark: '',
        amountHistory: [{ kind: 'estimate', amount: 50000, at: FIXED_NOW - 5 * DAY, note: '首次报价' }],
        stageHistory: [{ stage: 'lead', at: FIXED_NOW - 10 * DAY }],
        updatedAt: 1000, createdAt: FIXED_NOW - 10 * DAY,
      },
      {
        id: 'k2', name: '乙方集团', stage: 'won', contact: '李四', phone: '', owner: '小王', remark: '',
        amountHistory: [
          { kind: 'estimate', amount: 80000, at: FIXED_NOW - 20 * DAY },
          { kind: 'deal', amount: 60000, at: FIXED_NOW - 10 * DAY },
          { kind: 'upsell', amount: 20000, at: FIXED_NOW - 3 * DAY },
        ],
        stageHistory: [{ stage: 'lead', at: FIXED_NOW - 30 * DAY }, { stage: 'won', at: FIXED_NOW - 10 * DAY }],
        updatedAt: 3000, wonAt: FIXED_NOW - 10 * DAY,
      },
      {
        id: 'k3', name: '丙方小公司', stage: 'lost', contact: '', phone: '', owner: '', remark: '',
        amountHistory: [], stageHistory: [{ stage: 'lost', at: FIXED_NOW - DAY }], updatedAt: 2000,
      },
      // 第二个「推进中」客户：让 activeCount(2) / wonCount(1) / lostCount(1) 三个口径互不相等，
      // 否则界面上把漏斗口径写错（比如误用 wonCount）也测不出来
      {
        id: 'k4', name: '丁方贸易', stage: 'needs', contact: '王五', phone: '', owner: '小李', remark: '',
        amountHistory: [], stageHistory: [{ stage: 'needs', at: FIXED_NOW - 2 * DAY }], updatedAt: 500,
      },
    ],
    followups: [
      { id: 'f1', customerId: 'k1', at: FIXED_NOW - 2 * DAY, method: 'phone', content: '电话沟通需求', nextAt: FIXED_NOW + 2 * DAY, nextPlan: '发报价单' },
    ],
  };
}

async function openCustomer(extra) {
  const h = await setupUi({
    now: FIXED_NOW,
    data: Object.assign(sampleData(), extra || {}),
  });
  const root = h.renderView('customer');
  await flush();
  return { h: h, root: root };
}

function statCards(h, root) {
  return h.qsa('.stat-card', root).map(function (c) {
    return {
      label: c.querySelector('.stat-label').textContent.trim(),
      value: c.querySelector('.stat-value').textContent.trim(),
      sub: c.querySelector('.stat-sub').textContent.trim(),
    };
  });
}

function cardNames(h, root) {
  return h.qsa('.card', root).map(function (c) {
    const t = c.querySelector('.item-title');
    return t ? t.textContent.trim() : '';
  });
}

test('客户页 · 统计卡片与 CustomerUtil.summarize 口径一致', async function (t) {
  const { h, root } = await openCustomer();
  t.after(function () { h.close(); });

  // 先用纯函数算一遍（独立来源），再和界面对
  const sum = CU.summarize(h.Store.get().customers);
  assert.deepStrictEqual(sum, {
    byStage: sum.byStage,
    activeCount: 2, wonCount: 1, lostCount: 1,
    expectedTotal: 50000, wonTotal: 80000, upsellTotal: 20000,
  });

  assert.deepStrictEqual(statCards(h, root), [
    { label: '推进中商机', value: '2', sub: '未成交客户' },
    { label: '在谈预估', value: '¥5万', sub: '未成交预估合计' },
    { label: '已成交客户', value: '1', sub: '赢单数' },
    { label: '累计成交', value: '¥8万', sub: '含增购 ¥2万' },
    { label: '流失', value: '1', sub: '输单数' },
  ]);
});

test('客户页 · 默认「推进中」只列未成交客户，切「全部客户」按下次跟进时间排序', async function (t) {
  const { h, root } = await openCustomer();
  t.after(function () { h.close(); });

  const sel = h.qs('select', root);
  assert.strictEqual(sel.value, 'active');
  assert.deepStrictEqual(h.texts('option', sel), [
    '推进中（默认）', '全部客户', '发现商机', '需求沟通', '系统演示', '商务报价', '合同谈判', '赢单', '输单',
  ]);

  // 默认：赢单/输单不出现
  assert.deepStrictEqual(cardNames(h, root), ['甲方公司', '丁方贸易']);

  h.change(sel, 'all');
  await flush();
  // 推进中的排前面（有下次跟进时间的在前），终态的按 updatedAt 倒序（k2=3000 在 k3=2000 前）
  assert.deepStrictEqual(cardNames(h, root), ['甲方公司', '丁方贸易', '乙方集团', '丙方小公司']);
});

test('客户页 · 按阶段筛选 + 金额展示口径（未落单显示预估，已赢单显示成交+增购）', async function (t) {
  const { h, root } = await openCustomer();
  t.after(function () { h.close(); });

  const sel = h.qs('select', root);
  h.change(sel, 'won');
  await flush();

  const cards = h.qsa('.card', root);
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].querySelector('.item-title').textContent.trim(), '乙方集团');
  const metas = h.texts('.item-meta', cards[0]);
  assert.ok(metas.indexOf('成交 ¥8万（首单 ¥6万 + 增购 ¥2万）') >= 0, JSON.stringify(metas));
  assert.strictEqual(cards[0].querySelector('.badge').textContent.trim(), '赢单');

  h.change(h.qs('select', root), 'lost');
  await flush();
  const lostCards = h.qsa('.card', root);
  assert.strictEqual(lostCards.length, 1);
  const lostMetas = h.texts('.item-meta', lostCards[0]);
  assert.ok(lostMetas.indexOf('金额待确认') >= 0, JSON.stringify(lostMetas));
  assert.ok(lostMetas.indexOf('尚未安排下次跟进') >= 0, JSON.stringify(lostMetas));
});

test('客户页 · 下次跟进提示文案：N 天后跟进 / 已超期', async function (t) {
  const overdue = Object.assign(sampleData(), {
    followups: [{ id: 'f9', customerId: 'k1', at: FIXED_NOW - 5 * DAY, method: 'wechat', content: '发资料', nextAt: FIXED_NOW - 3 * DAY, nextPlan: '' }],
  });
  const h = await setupUi({ now: FIXED_NOW, data: overdue });
  t.after(function () { h.close(); });
  const root = h.renderView('customer');
  await flush();

  const metas = h.texts('.item-meta', h.qsa('.card', root)[0]);
  assert.ok(
    metas.indexOf('下次跟进：2026-03-07 14:30 · 已超期 3 天') >= 0,
    JSON.stringify(metas)
  );

  // 原始数据（nextAt = 两天后）应显示「2 天后跟进（2026-03-12）」
  const { h: h2, root: root2 } = await openCustomer();
  const metas2 = h2.texts('.item-meta', h2.qsa('.card', root2)[0]);
  assert.ok(metas2.indexOf('下次跟进：2026-03-12 14:30 · 2 天后跟进（2026-03-12）') >= 0, JSON.stringify(metas2));
  h2.close();
});

test('客户页 · 展开详情：金额四行、金额流水、阶段停留、跟进时间线、关联事项', async function (t) {
  const { h, root } = await openCustomer({
    todos: [{
      id: 'td1', title: '跟进：甲方公司（发现商机）', status: 'pending', priority: 'high',
      deadline: FIXED_NOW + 2 * DAY, customerId: 'k1', followupTag: true, scheduledEventId: 'ev1',
      categoryColor: '#4f8ef7',
    }],
    events: [{
      id: 'ev1', title: '跟进：甲方公司（发现商机）', status: 'pending',
      startTime: FIXED_NOW + 2 * DAY, endTime: FIXED_NOW + 2 * DAY + HOUR,
    }],
  });
  t.after(function () { h.close(); });

  const card = h.qsa('.card', root)[0];
  assert.deepStrictEqual(h.texts('.panel-header button', card), ['记录跟进', '详情']);

  h.clickText('button', '详情', card);
  await flush();

  const opened = h.qsa('.card', root)[0];
  // 卡片头部按钮变成「收起」；阶段操作与金额操作各自在详情区块里
  assert.deepStrictEqual(h.texts('.panel-header button', opened), ['记录跟进', '收起']);
  assert.deepStrictEqual(h.texts('.toolbar button', opened), ['编辑资料', '删除客户']);
  assert.deepStrictEqual(h.texts('.item-side button', opened).slice(0, 1), ['调整预估']);

  // 金额区块：口径与 CU.amountSummary 一致
  const sum = CU.amountSummary(h.Store.get().customers.find(function (c) { return c.id === 'k1'; }));
  assert.deepStrictEqual(sum.expected, 50000);
  assert.deepStrictEqual(h.texts('.item-meta', opened).filter(function (s) { return /^(当前预估|落单确认|增购累计|累计成交)：/.test(s); }), [
    '当前预估：¥5万', '落单确认：未落单', '增购累计：¥0', '累计成交：¥0',
  ]);

  // 金额流水（留痕）：时间 + 类型 + 金额（+备注）
  assert.deepStrictEqual(
    h.texts('.item-meta', opened).filter(function (s) { return s.indexOf(' · 预估 ') > 0; }),
    ['2026-03-05 14:30 · 预估 ¥5万（首次报价）']
  );

  // 区块标题
  assert.deepStrictEqual(h.texts('.day-section-title', opened), ['金额', '关联事项', '阶段进展', '跟进记录（1）']);

  // 阶段停留时长
  assert.ok(
    h.texts('.item-meta', opened).indexOf('发现商机：2026-02-28 起，停留约 10 天') >= 0,
    JSON.stringify(h.texts('.item-meta', opened))
  );

  // 关联事项：跟进待办 + 已排到日程的时间块（列表末尾那条是下面要断言的跟进时间线）
  const related = h.texts('.item-title', opened);
  assert.deepStrictEqual(related, ['甲方公司', '跟进：甲方公司（发现商机）', '📞 电话 · 2026-03-08 14:30']);
  assert.ok(h.texts('.item-meta', opened).indexOf('截止 2026-03-12 14:30 · 跟进动作 · 已排到日程') >= 0, JSON.stringify(h.texts('.item-meta', opened)));
  // 「已排到日程」那一行断言整行（含时间）。
  // 曾经 relatedSection 读的是 ev.start 而日程模型字段是 startTime，渲染成
  // 「· NaN-NaN-NaN NaN:NaN …」——只断言与时间无关的部分是抓不到这类字段写错的。
  const linkedLines = h.texts('.item-meta', opened).filter(function (s) { return s.indexOf('· ') === 0; });
  assert.deepStrictEqual(
    linkedLines,
    ['· 2026-03-12 14:30 跟进：甲方公司（发现商机）'],
    '已排到日程行应带正确时间（出现 NaN 说明读错了日程字段）'
  );
  assert.deepStrictEqual(h.texts('button', opened).filter(function (s) { return s === '去待办'; }), ['去待办']);

  // 跟进时间线
  assert.ok(h.texts('.item-title', opened).indexOf('📞 电话 · 2026-03-08 14:30') >= 0);
  assert.ok(h.texts('.item-meta', opened).indexOf('电话沟通需求') >= 0);
  assert.ok(h.texts('.item-meta', opened).indexOf('下次跟进：2026-03-12 14:30 · 发报价单') >= 0);

  // 再点一次收起
  h.clickText('button', '收起', h.qsa('.card', root)[0]);
  await flush();
  assert.strictEqual(h.qsa('.day-section-title', h.qsa('.card', root)[0]).length, 0, '收起后详情区块应消失');
});

test('客户页 · 记录跟进：保存后生成跟进待办并刷新详情', async function (t) {
  const { h, root } = await openCustomer();
  t.after(function () { h.close(); });

  assert.strictEqual(h.Store.get().todos.length, 0);

  h.clickText('button', '记录跟进', h.qsa('.card', root)[0]);
  const body = h.qs('#modal-root .modal-body', h.document);
  assert.ok(body, '应弹出「记录跟进」弹窗');
  assert.strictEqual(h.text('#modal-root .modal-title', h.document), '记录跟进');

  // 弹窗结构：跟进方式下拉 / 本次内容 / 下次跟进时间（默认 3 天后）/ 计划
  assert.strictEqual(h.qs('select', body).value, 'phone');
  assert.deepStrictEqual(h.texts('option', h.qs('select', body)).slice(0, 3), ['📞 电话', '💬 微信', '🤝 拜访']);
  const nextInputs = h.qsa('input', body);
  assert.deepStrictEqual(nextInputs.map(function (i) { return i.type; }), ['date', 'time']);
  assert.deepStrictEqual(nextInputs.map(function (i) { return i.value; }), ['2026-03-13', '14:30']);

  const textareas = h.qsa('textarea', body);
  textareas[0].value = '现场确认了预算';
  textareas[1].value = '把方案发给张总';
  h.change(h.qs('select', body), 'visit');
  h.clickText('button', '保存并安排下次提醒', h.document);
  await flush();

  // 落库：新增一条跟进 + 自动生成一条跟进待办（deadline = 下次跟进时间）
  const followups = h.Store.get().followups.filter(function (f) { return f.customerId === 'k1'; });
  assert.strictEqual(followups.length, 2);
  const added = followups.find(function (f) { return f.id !== 'f1'; });
  assert.strictEqual(added.method, 'visit');
  assert.strictEqual(added.content, '现场确认了预算');
  assert.strictEqual(added.nextPlan, '把方案发给张总');

  const todos = h.Store.get().todos;
  assert.strictEqual(todos.length, 1, 'recordFollowup 应自动生成一条待办');
  assert.strictEqual(todos[0].title, '跟进：甲方公司（发现商机）');
  assert.strictEqual(todos[0].priority, 'high');
  assert.strictEqual(todos[0].deadline, new Date(2026, 2, 13, 14, 30, 0, 0).getTime());
  assert.ok(h.toasts().some(function (s) { return s.indexOf('已记录，下次跟进 ') === 0; }), JSON.stringify(h.toasts()));

  // 列表刷新：卡片上的下次跟进提示换成新时间
  const metas = h.texts('.item-meta', h.qsa('.card', root)[0]);
  assert.ok(metas.indexOf('下次跟进：2026-03-13 14:30 · 3 天后跟进（2026-03-13）') >= 0, JSON.stringify(metas));
  // 详情里的「关联事项」出现新待办
  h.clickText('button', '详情', h.qsa('.card', root)[0]);
  await flush();
  const opened = h.qsa('.card', root)[0];
  assert.ok(h.texts('.item-title', opened).indexOf('跟进：甲方公司（发现商机）') >= 0, JSON.stringify(h.texts('.item-title', opened)));
});

test('客户页 · 阶段改「赢单」但未落单：强制弹落单确认，保存后金额与阶段一起更新', async function (t) {
  const { h, root } = await openCustomer();
  t.after(function () { h.close(); });

  const card = h.qsa('.card', root)[0];
  h.clickText('button', '详情', card);
  await flush();

  const opened = h.qsa('.card', root)[0];
  const stageSel = h.qs('select', opened);
  assert.strictEqual(stageSel.value, 'lead');

  h.change(stageSel, 'won');
  await flush();

  // 弹窗而不是直接改状态
  assert.strictEqual(h.text('#modal-root .modal-title', h.document), '落单确认', '未落单时改赢单应强制确认成交金额');
  assert.strictEqual(h.Store.get().customers.find(function (c) { return c.id === 'k1'; }).stage, 'lead', '弹窗期间不应改阶段');

  const amt = h.qs('#modal-root input[type=number]', h.document);
  assert.strictEqual(amt.value, '50000', '默认带出当前预估金额');
  amt.value = '66000';
  h.clickText('button', '保存', h.document);
  await flush();

  const c1 = h.Store.get().customers.find(function (c) { return c.id === 'k1'; });
  assert.strictEqual(c1.stage, 'won');
  const sum = CU.amountSummary(c1);
  assert.strictEqual(sum.deal, 66000);
  assert.strictEqual(sum.won, 66000);
  assert.strictEqual(h.qs('#modal-root .modal', h.document), null, '保存后弹窗应关闭');
  assert.ok(h.toasts().indexOf('已落单赢单，成交 ¥6.60万') >= 0, JSON.stringify(h.toasts()));

  // 赢单后客户已属终态：默认「推进中」筛选下它从列表消失（另一个推进中客户还在）
  assert.deepStrictEqual(cardNames(h, root), ['丁方贸易'], '赢单后不应再出现在「推进中」列表');

  // 切到「赢单」筛选再看：徽标与金额口径都已更新
  h.change(h.qs('select', root), 'won');
  await flush();
  const card2 = h.qsa('.card', root)[0];
  assert.ok(card2, '「赢单」筛选下应有该客户');
  assert.strictEqual(card2.querySelector('.badge').textContent.trim(), '赢单');
  assert.ok(h.texts('.item-meta', card2).indexOf('成交 ¥6.60万') >= 0, JSON.stringify(h.texts('.item-meta', card2)));
  // 详情里的金额口径也更新
  assert.ok(h.texts('.item-meta', card2).indexOf('落单确认：¥6.60万') >= 0, JSON.stringify(h.texts('.item-meta', card2)));
  assert.ok(h.texts('.item-meta', card2).indexOf('累计成交：¥6.60万') >= 0);
  // 赢单后出现「追加增购」按钮（canUpsell）
  assert.ok(h.texts('button', card2).indexOf('追加增购') >= 0, JSON.stringify(h.texts('button', card2)));
});

test('客户页 · 删除客户：软删除并连同未完成的跟进待办一起消失', async function (t) {
  const { h, root } = await openCustomer({
    todos: [{ id: 'td1', title: '跟进：甲方公司（发现商机）', status: 'pending', customerId: 'k1', followupTag: true, deadline: FIXED_NOW + DAY }],
  });
  t.after(function () { h.close(); });

  h.clickText('button', '详情', h.qsa('.card', root)[0]);
  await flush();
  h.clickText('button', '删除客户', h.qsa('.card', root)[0]);
  await flush();

  assert.strictEqual(h.Store.get().customers.some(function (c) { return c.id === 'k1'; }), false);
  assert.strictEqual(h.Store.getRaw().customers.find(function (c) { return c.id === 'k1'; }).deleted, true, '应为软删除（保留墓碑）');
  assert.strictEqual(h.Store.get().todos.length, 0, '该客户的未完成跟进待办应被一并清理');
  assert.deepStrictEqual(h.toasts(), ['已删除']);
  // 「推进中」列表里已经没有它了（丁方贸易还在）
  assert.deepStrictEqual(cardNames(h, root), ['丁方贸易']);
});

test('客户页 · 空数据时的占位文案', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  const root = h.renderView('customer');
  await flush();
  assert.deepStrictEqual(h.texts('.placeholder', root), ['暂无客户，点右上角「+ 新增客户」开始']);
  assert.deepStrictEqual(statCards(h, root).map(function (c) { return c.value; }), ['0', '¥0', '0', '¥0', '0']);
});
