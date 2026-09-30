/*
 * ui.todo.test.js — 待办页渲染层 UI 测试（jsdom 真实 DOM）
 *
 * 覆盖：列表条数与排序、标题/元信息文本、状态样式类、象限/优先级/状态徽标、
 *       筛选下拉的真实联动、勾选完成与批量操作的交互闭环、循环待办顺延、防抖持久化。
 * 时间被冻结成 FIXED_NOW（2026-03-10 14:30），所以象限、逾期、排序都可精确断言。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { setupUi, flush, FIXED_NOW, DAY } = require('./ui.helpers.js');

const HOUR = 3600e3;

// 6 条覆盖各种组合的待办：q1(逾期)/q1(临近)/q2/q3/q4/已完成
function sampleTodos() {
  return [
    { id: 't1', title: '写周报', priority: 'high', importance: 'important', deadline: FIXED_NOW + 2 * HOUR, status: 'pending', categoryId: 'c1', categoryName: '工作', categoryColor: '#4f8ef7' },
    { id: 't2', title: '整理客户资料', priority: 'medium', importance: 'important', deadline: FIXED_NOW + 5 * DAY, status: 'pending', categoryId: 'c2', categoryName: '生活', categoryColor: '#4caf7d' },
    { id: 't3', title: '回邮件', priority: 'low', importance: 'not_important', deadline: FIXED_NOW + HOUR, status: 'pending', categoryId: 'c1', categoryName: '工作', categoryColor: '#4f8ef7' },
    { id: 't4', title: '看闲书', priority: 'low', importance: 'not_important', deadline: null, status: 'pending', categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98' },
    { id: 't5', title: '已完成的事', priority: 'high', importance: 'important', deadline: FIXED_NOW - 3 * DAY, status: 'done', completedAt: FIXED_NOW - 2 * DAY },
    { id: 't6', title: '逾期未完成', priority: 'medium', deadline: FIXED_NOW - DAY, status: 'pending', categoryId: 'c1', categoryName: '工作', categoryColor: '#4f8ef7' },
  ];
}

const CATEGORIES = [
  { id: 'c1', name: '工作', color: '#4f8ef7', isDefault: true },
  { id: 'c2', name: '生活', color: '#4caf7d', isDefault: false },
];

async function openTodo() {
  const h = await setupUi({ now: FIXED_NOW, data: { todos: sampleTodos(), categories: CATEGORIES } });
  const root = h.renderView('todo');
  await flush();
  return { h: h, root: root, rows: h.qsa('.item', root) };
}

function titles(rows) { return rows.map(function (r) { return r.querySelector('.item-title').textContent.trim(); }); }
function badgeTexts(row) { return Array.prototype.map.call(row.querySelectorAll('.item-side .badge'), function (b) { return b.textContent.trim(); }); }
function badgeClasses(row) { return Array.prototype.map.call(row.querySelectorAll('.item-side .badge'), function (b) { return b.className; }); }

test('待办页 · 列表条数与排序：未完成在前，再按象限，再按截止时间升序', async function (t) {
  const { h, root, rows } = await openTodo();
  t.after(function () { h.close(); });

  assert.strictEqual(rows.length, 6, '应渲染 6 条待办');
  assert.deepStrictEqual(titles(rows), [
    '逾期未完成',   // q1，截止最早（昨天）
    '写周报',       // q1，今天 16:30
    '整理客户资料', // q2
    '回邮件',       // q3
    '看闲书',       // q4
    '已完成的事',   // 已完成永远排最后
  ]);

  // 状态样式类：逾期 / 完成各加一个类，其余是裸 .item
  assert.deepStrictEqual(rows.map(function (r) { return r.className; }), [
    'item overdue', 'item', 'item', 'item', 'item', 'item done',
  ]);

  // 头部 + 筛选栏
  assert.strictEqual(h.text('.panel-title', root), '待办任务');
  assert.deepStrictEqual(h.texts('.toolbar select', root).length, 4, '筛选栏应有 4 个下拉');
});

test('待办页 · 元信息与徽标：截止时间、象限/优先级/状态三类徽标文案与类名', async function (t) {
  const { h, rows } = await openTodo();
  t.after(function () { h.close(); });

  // 截止时间来自 Utils.toDateTimeStr
  assert.deepStrictEqual(rows.map(function (r) { return r.querySelector('.item-meta').textContent.trim(); }), [
    '截止 2026-03-09 14:30',
    '截止 2026-03-10 16:30',
    '截止 2026-03-15 14:30',
    '截止 2026-03-10 15:30',
    '',                 // 无截止时间 -> 空 meta
    '截止 2026-03-07 14:30',
  ]);

  // 每条 3 个徽标：四象限 / 优先级 / 状态
  assert.deepStrictEqual(badgeTexts(rows[0]), ['重要且紧急', '中', '已过期']);
  assert.deepStrictEqual(badgeClasses(rows[0]), ['badge', 'badge badge-medium', 'badge badge-overdue']);
  assert.deepStrictEqual(badgeTexts(rows[1]), ['重要且紧急', '高', '未开始']);
  assert.deepStrictEqual(badgeClasses(rows[1]), ['badge', 'badge badge-high', 'badge badge-pending']);
  assert.deepStrictEqual(badgeTexts(rows[2]), ['重要不紧急', '中', '未开始']);
  assert.deepStrictEqual(badgeTexts(rows[3]), ['不重要但紧急', '低', '未开始']);
  assert.deepStrictEqual(badgeTexts(rows[4]), ['不重要不紧急', '低', '未开始']);
  assert.deepStrictEqual(badgeTexts(rows[5]), ['重要且紧急', '高', '已完成']);
  assert.deepStrictEqual(badgeClasses(rows[5]), ['badge', 'badge badge-high', 'badge badge-done']);

  // 四象限徽标带颜色（来自 constants.QUADRANT_COLOR）
  assert.strictEqual(rows[0].querySelector('.item-side .badge').style.background, 'rgb(224, 91, 91)');
  // 分类圆点颜色来自待办自身的 categoryColor
  assert.strictEqual(rows[0].querySelector('.dot').style.background, 'rgb(79, 142, 247)');
  assert.strictEqual(rows[4].querySelector('.dot').style.background, 'rgb(138, 143, 152)');
});

test('待办页 · 完成勾选框状态与「排到日程」按钮', async function (t) {
  const { h, rows } = await openTodo();
  t.after(function () { h.close(); });

  const firstChecks = rows.map(function (r) { return r.querySelectorAll('input.item-check')[0].checked; });
  assert.deepStrictEqual(firstChecks, [false, false, false, false, false, true], '只有已完成那条应预勾选');

  const titles_ = rows.map(function (r) { return r.querySelectorAll('input.item-check')[0].title; });
  assert.deepStrictEqual(Array.from(new Set(titles_)), ['标记完成 / 取消完成']);

  assert.deepStrictEqual(h.texts('.item-side button', rows[1]), ['⏱ 排到日程']);
});

test('待办页 · 优先级筛选：只留高优先级', async function (t) {
  const { h, root } = await openTodo();
  t.after(function () { h.close(); });

  const prioSel = h.qsa('.toolbar select', root)[1];
  h.change(prioSel, 'high');
  await flush();

  assert.deepStrictEqual(titles(h.qsa('.item', root)), ['写周报', '已完成的事']);
  assert.strictEqual(prioSel.value, 'high', '重绘后筛选器应保持选中值');
});

test('待办页 · 状态筛选：过期 / 已完成各自只留一条', async function (t) {
  const { h, root } = await openTodo();
  t.after(function () { h.close(); });

  const statusSel = h.qsa('.toolbar select', root)[2];
  h.change(statusSel, 'overdue');
  await flush();
  assert.deepStrictEqual(titles(h.qsa('.item', root)), ['逾期未完成']);
  assert.strictEqual(h.qsa('.item', root)[0].className, 'item overdue');

  h.change(h.qsa('.toolbar select', root)[2], 'done');
  await flush();
  assert.deepStrictEqual(titles(h.qsa('.item', root)), ['已完成的事']);
  assert.strictEqual(h.qsa('.item', root)[0].className, 'item done');
});

test('待办页 · 象限筛选与分类筛选', async function (t) {
  const { h, root } = await openTodo();
  t.after(function () { h.close(); });

  // 象限：Q4 只有「看闲书」
  h.change(h.qsa('.toolbar select', root)[3], 'q4');
  await flush();
  assert.deepStrictEqual(titles(h.qsa('.item', root)), ['看闲书']);

  // 回到全部象限，再按分类「工作」筛
  h.change(h.qsa('.toolbar select', root)[3], 'all');
  await flush();
  h.change(h.qsa('.toolbar select', root)[0], 'c1');
  await flush();
  assert.deepStrictEqual(titles(h.qsa('.item', root)), ['逾期未完成', '写周报', '回邮件']);
});

test('待办页 · 点完成勾选框：状态落库、列表重绘、样式类跟着变', async function (t) {
  const { h, root } = await openTodo();
  t.after(function () { h.close(); });

  // 勾上「写周报」（第 2 行）
  h.change(h.qsa('.item', root)[1].querySelectorAll('input.item-check')[0], true);
  await flush();

  const t1 = h.Store.get().todos.find(function (x) { return x.id === 't1'; });
  assert.strictEqual(t1.status, 'done');
  assert.strictEqual(typeof t1.completedAt, 'number');

  // 重绘后：该条排到最后并带 done 类，勾选框保持选中
  const rows = h.qsa('.item', root);
  assert.strictEqual(rows[rows.length - 1].querySelector('.item-title').textContent.trim(), '写周报');
  assert.strictEqual(rows[rows.length - 1].className, 'item done');
  assert.deepStrictEqual(badgeTexts(rows[rows.length - 1]), ['重要且紧急', '高', '已完成']);
  assert.strictEqual(rows[rows.length - 1].querySelector('input.item-check').checked, true);

  // 再点一次取消完成
  h.change(h.qsa('.item', root)[h.qsa('.item', root).length - 1].querySelectorAll('input.item-check')[0], false);
  await flush();
  const t1b = h.Store.get().todos.find(function (x) { return x.id === 't1'; });
  assert.strictEqual(t1b.status, 'pending');
  assert.strictEqual(t1b.completedAt, null);
});

test('待办页 · 批量选择：出现批量操作条，点「标记完成」批量落库', async function (t) {
  const { h, root } = await openTodo();
  t.after(function () { h.close(); });

  const metas = function () { return h.texts('.item-meta', root); };

  // 第 2 个 checkbox 是「批量选择」用
  h.change(h.qsa('.item', root)[1].querySelectorAll('input.item-check')[1], true);
  await flush();

  assert.ok(metas().indexOf('已选 1 项') >= 0, '应出现批量操作条，实际：' + JSON.stringify(metas()));
  const batchBtns = h.texts('button', root);
  ['标记完成', '标记未完成', '批量删除'].forEach(function (label) {
    assert.ok(batchBtns.indexOf(label) >= 0, '批量操作条应有「' + label + '」');
  });

  h.clickText('button', '标记完成', root);
  await flush();

  assert.strictEqual(h.Store.get().todos.find(function (x) { return x.id === 't1'; }).status, 'done');
  assert.strictEqual(h.Store.get().todos.find(function (x) { return x.id === 't2'; }).status, 'pending');

  // 选中集已被清空。注意：实现里 `selected = {}` 发生在 Store 变更「之后」，
  // 而 Store 变更会立刻触发一次重绘，所以那一帧的批量条仍是旧的；
  // 这里显式再渲染一次，验证状态本身确实清干净了（该陈旧一帧的现象见测试报告）。
  h.Modules.todo.render();
  assert.strictEqual(metas().indexOf('已选 1 项'), -1, '选中集应为空，批量条不该再出现');
});

test('待办页 · 循环待办完成后自动顺延到下一次而不是标记完成', async function (t) {
  const deadline = FIXED_NOW - HOUR; // 一小时前（已逾期）
  const h = await setupUi({
    now: FIXED_NOW,
    data: {
      todos: [{
        id: 'r1', title: '每日站会', priority: 'medium', importance: 'important',
        deadline: deadline, status: 'pending', repeat: { type: 'daily', interval: 1, endDate: null },
      }],
    },
  });
  t.after(function () { h.close(); });

  const root = h.renderView('todo');
  await flush();
  assert.strictEqual(h.text('.item .item-meta', root), '截止 2026-03-10 13:30 · 每天');

  h.change(h.qs('input.item-check', root), true);
  await flush();

  const rec = h.Store.get().todos[0];
  assert.strictEqual(rec.status, 'pending', '循环待办不应变成已完成');
  assert.strictEqual(rec.deadline, deadline + DAY, '截止时间应顺延一天');
  assert.ok(h.toasts().indexOf('已完成，已生成下一次') >= 0, JSON.stringify(h.toasts()));
  assert.strictEqual(h.text('.item .item-meta', root), '截止 2026-03-11 13:30 · 每天');
});

test('待办页 · 变更后经防抖持久化：500ms 后调用 saveData 且带上待办', async function (t) {
  const { h, root } = await openTodo();
  t.after(function () { h.close(); });

  assert.strictEqual(h.api.__count('saveData'), 0);
  h.change(h.qsa('.item', root)[1].querySelectorAll('input.item-check')[0], true);
  assert.strictEqual(h.api.__count('saveData'), 0, '防抖期内不应立即落盘');

  await h.wait(650);
  assert.strictEqual(h.api.__count('saveData'), 1, '防抖到期后应调用一次 saveData');
  const payload = h.api.__lastArgs('saveData')[0];
  assert.strictEqual(payload.todos.length, 6);
  assert.strictEqual(payload.todos.find(function (x) { return x.id === 't1'; }).status, 'done');
});

test('待办页 · 空数据时显示占位文案', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  const root = h.renderView('todo');
  await flush();
  assert.strictEqual(h.qsa('.item', root).length, 0);
  assert.deepStrictEqual(h.texts('.placeholder', root), ['暂无待办']);
});
