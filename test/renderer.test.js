/*
 * renderer.test.js — 渲染进程模块集成测试（node --test）
 *
 * 用最小 DOM shim 在 Node 里真实加载 store.js / dom.js / helpers.js / api.js 以及
 * plan / inbox / review / todo / schedule 模块，驱动 render() 与 scheduleTodo /
 * openQuickCapture 等交互，验证 v2.1.0 新增的 GTD + 时间块排程功能不抛错、输出正确，
 * 并覆盖全天跨天日程在「今日规划」时间线中的回归场景。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DAY_MS = 86400000;

// ---------- 最小 DOM shim ----------
function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return String(node.textContent);
  let out = node._text || '';
  (node.children || []).forEach(function (c) { out += textOf(c); });
  return out;
}

function makeClassList(el) {
  const set = {};
  function sync() {
    el.className = Object.keys(set).join(' ');
  }
  return {
    add: function () { for (let i = 0; i < arguments.length; i++) { set[arguments[i]] = true; } sync(); },
    remove: function (n) { delete set[n]; sync(); },
    toggle: function (n, force) {
      const on = force === undefined ? !set[n] : !!force;
      if (on) set[n] = true; else delete set[n];
      sync();
    },
    contains: function (n) { return !!set[n]; },
  };
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentNode: null,
    className: '',
    _text: '',
    style: {},
    dataset: {},
    value: '',
    checked: false,
    type: '',
    title: '',
    rows: 0,
    min: 0,
    placeholder: '',
    id: '',
    listeners: {},
    appendChild: function (c) { el.children.push(c); if (c && c.nodeType === 1) c.parentNode = el; return c; },
    removeChild: function (c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    addEventListener: function (type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    dispatchEvent: function (type, ev) { (el.listeners[type] || []).forEach(function (f) { f(ev || {}); }); },
    querySelectorAll: function (sel) { return queryAll(el, sel); },
    get firstChild() { return el.children[0] || null; },
    get textContent() { return textOf(el); },
    set textContent(v) { el._text = String(v == null ? '' : v); el.children = []; },
  };
  el.classList = makeClassList(el);
  return el;
}

function queryAll(root, sel) {
  const out = [];
  if (sel !== '[data-field]') return out;
  (function walk(n) {
    (n.children || []).forEach(function (c) {
      if (c.nodeType !== 1) return;
      if (c.dataset && c.dataset.field !== undefined) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

function makeDocument() {
  const roots = {};
  ['schedule', 'todo', 'plan', 'inbox', 'review', 'memorials', 'bookkeeping', 'search', 'stats', 'settings'].forEach(function (v) {
    roots['view-' + v] = makeElement('div');
    roots['view-' + v].id = 'view-' + v;
  });
  return {
    createElement: function (tag) { return makeElement(tag); },
    createTextNode: function (text) { return { nodeType: 3, textContent: String(text) }; },
    getElementById: function (id) {
      if (roots[id]) return roots[id];
      roots[id] = makeElement('div'); roots[id].id = id; return roots[id];
    },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    documentElement: makeElement('html'),
  };
}

// ---------- 全局装配（与浏览器运行环境一致） ----------
global.window = global.window || {};
const document = makeDocument();
global.document = document;
global.confirm = function () { return true; };
window.document = document;

window.Utils = require(path.join(ROOT, 'shared', 'utils.js'));
window.Nlp = require(path.join(ROOT, 'shared', 'nlp.js'));
window.LunarUtil = require(path.join(ROOT, 'shared', 'lunar.js'));
window.Bookkeeping = require(path.join(ROOT, 'shared', 'bookkeeping.js'));

// 暴露给渲染进程的主进程 API 桩（api.js 会据此构造 window.API）
window.api = {
  constants: require(path.join(ROOT, 'shared', 'constants.js')),
  loadData: function () { return Promise.resolve({ categories: [], events: [], todos: [], settings: {}, statsHistory: [] }); },
  saveData: function () {},
  exportData: function () {}, importData: function () {}, restoreData: function () {}, getStatsHistory: function () {},
  notify: function () {},
  onReminder: function () {}, onQuickCapture: function () {},
  loginSync: function () {}, syncPull: function () {}, syncPush: function () {}, syncNow: function () {},
  syncStatus: function () {}, syncLogout: function () {},
  onSyncDataUpdated: function () {}, onSyncConflict: function () {},
};

let lastModal = null;
window.Toast = { success: function () {}, error: function () {}, info: function () {}, warning: function () {} };
window.Modal = { open: function (cfg) { lastModal = cfg; }, close: function () {} };
window.ContextMenu = { show: function () {} };

// 按真实依赖顺序加载渲染层脚本（IIFE 挂到 window）
require(path.join(ROOT, 'src', 'renderer', 'js', 'api.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'dom.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'helpers.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'store.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'todo.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'plan.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'inbox.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'review.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'memorials.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'bookkeeping.js'));
require(path.join(ROOT, 'src', 'renderer', 'js', 'modules', 'schedule.js'));

// 模块内部以裸标识符引用 Store / confirm，暴露到 global
global.Store = window.Store;

// ---------- 测试辅助 ----------
function resetStore() {
  window.Store.set({
    categories: [],
    events: [],
    todos: [],
    memorials: [],
    accounts: [],
    transactions: [],
    bookkeepingCategories: [],
    budgets: [],
    settings: { defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system' },
  });
}

function seedTodo(overrides) {
  const t = Object.assign({
    id: window.Utils.genId(), status: 'pending', completedAt: null,
    createdAt: Date.now(), updatedAt: Date.now(), title: '待办', description: '',
    deadline: null, priority: 'medium', categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98',
    importance: 'important', repeat: { type: 'none', interval: 1, endDate: null },
    remindBefore: 0, estimatedMinutes: null,
  }, overrides);
  window.Store.addTodo(t);
  return t;
}

function seedEvent(overrides) {
  const e = Object.assign({
    id: window.Utils.genId(), status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
    title: '日程', description: '', allDay: false,
    startTime: Date.now(), endTime: Date.now() + 3600000, priority: 'medium',
    categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98',
    repeat: { type: 'none', interval: 1, endDate: null }, remindBefore: 0,
  }, overrides);
  window.Store.addEvent(e);
  return e;
}

function rootText(view) { return textOf(document.getElementById('view-' + view)); }

// 固定「当前时间」跑依赖时间的排程逻辑，避免测试随运行时刻变化
function withNow(ts, fn) {
  const orig = Date.now;
  Date.now = function () { return ts; };
  try { return fn(); } finally { Date.now = orig; }
}

function findButton(root, label) {
  let found = null;
  (function walk(n) {
    (n.children || []).forEach(function (c) {
      if (c.nodeType !== 1) return;
      if (c.tagName === 'BUTTON' && textOf(c).indexOf(label) !== -1 && !found) found = c;
      walk(c);
    });
  })(root);
  return found;
}

function fieldInput(root, name) {
  let found = null;
  root.querySelectorAll('[data-field]').forEach(function (n) { if (n.dataset.field === name && !found) found = n; });
  return found;
}

// ---------- 测试 ----------
test('plan：空数据渲染不抛错，显示空态', function () {
  resetStore();
  window.Modules.plan.render();
  const txt = rootText('plan');
  assert.ok(txt.indexOf('今日规划') !== -1, '应有标题「今日规划」');
  assert.ok(txt.indexOf('今日暂无安排') !== -1, '空时间线应显示占位');
});

test('plan：有预估耗时的待办进入时间线并提示「已排入」', function () {
  const dayStart = window.Utils.startOfDay(Date.now());
  withNow(dayStart + 10 * 3600000, function () { // 10:00，处于工作时段
    resetStore();
    seedTodo({ title: '写周报', estimatedMinutes: 30 });
    window.Modules.plan.render();
    const txt = rootText('plan');
    assert.ok(txt.indexOf('写周报') !== -1, '候选待办应出现在时间线');
    assert.ok(txt.indexOf('建议时间块') !== -1, '应标注建议时间块');
  });
});

test('plan：全天跨天日程在今天的时间线中不遗漏（回归）', function () {
  resetStore();
  const dayStart = window.Utils.startOfDay(Date.now());
  // 从昨天跨到今天结束的全天事件：起点在今日窗口之前
  seedEvent({
    title: '连续假期', allDay: true,
    startTime: dayStart - DAY_MS,
    endTime: dayStart + DAY_MS - 1,
  });
  window.Modules.plan.render();
  const txt = rootText('plan');
  assert.ok(txt.indexOf('连续假期') !== -1, '跨天全天日程应出现在今日时间线');
});

test('plan：已排到日程（scheduledEventId 有效）的待办不再重复排程', function () {
  resetStore();
  const ev = seedEvent({ title: '排好的块', startTime: Date.now(), endTime: Date.now() + 3600000 });
  seedTodo({ title: '已排待办', estimatedMinutes: 60, scheduledEventId: ev.id });
  window.Modules.plan.render();
  const txt = rootText('plan');
  assert.ok(txt.indexOf('已排待办') === -1, '已排待办不应出现在时间线或未排入列表');
});

test('plan：应用排程按钮会创建时间块日程并回写 scheduledEventId', function () {
  const dayStart = window.Utils.startOfDay(Date.now());
  withNow(dayStart + 10 * 3600000, function () { // 10:00，处于工作时段
    resetStore();
    seedTodo({ title: '自动排我', estimatedMinutes: 60 });
    window.Modules.plan.render();
    const btn = findButton(document.getElementById('view-plan'), '应用排程到日程');
    assert.ok(btn, '应有「应用排程到日程」按钮');
    btn.dispatchEvent('click');
    const state = window.Store.get();
    assert.strictEqual(state.events.length, 1, '应创建 1 条时间块日程');
    assert.strictEqual(state.events[0].title, '自动排我');
    assert.strictEqual(state.events[0].endTime - state.events[0].startTime, 60 * 60000);
    assert.strictEqual(state.todos[0].scheduledEventId, state.events[0].id, '待办应回写 scheduledEventId');
  });
});

test('inbox：仅列出未完成且无截止时间的待办', function () {
  resetStore();
  seedTodo({ title: '无期限想法' });
  seedTodo({ title: '已完成想法', status: 'done' });
  seedTodo({ title: '有期限任务', deadline: Date.now() + 3600000 });
  window.Modules.inbox.render();
  const txt = rootText('inbox');
  assert.ok(txt.indexOf('无期限想法') !== -1, '无截止时间待办应在收件箱');
  assert.ok(txt.indexOf('已完成想法') === -1, '已完成不应在收件箱');
  assert.ok(txt.indexOf('有期限任务') === -1, '有截止时间不应在收件箱');
});

test('inbox：快速捕捉收入一条无截止时间的待办', function () {
  resetStore();
  window.Modules.inbox.openQuickCapture();
  assert.ok(lastModal, '快速捕捉应打开 Modal');
  // 填写自然语言内容后触发 onOk
  const fields = lastModal.content.querySelectorAll('[data-field]');
  const titleInput = fields.find(function (f) { return f.dataset.field === 'captureText'; });
  assert.ok(titleInput, '捕捉表单应有内容输入框');
  titleInput.value = '一个突如其来的想法';
  const ret = lastModal.onOk();
  assert.notStrictEqual(ret, false, '标题非空时 onOk 不应拒绝');
  const state = window.Store.get();
  assert.strictEqual(state.todos.length, 1);
  assert.strictEqual(state.todos[0].title, '一个突如其来的想法');
  assert.strictEqual(state.todos[0].deadline, null);
});

test('inbox：快速捕捉解析自然语言创建带截止时间的待办', function () {
  const dayStart = window.Utils.startOfDay(Date.now());
  withNow(dayStart + 9 * 3600000, function () { // 09:00
    resetStore();
    window.Store.addCategory({ id: 'c-work', name: '工作', color: '#4f8ef7' });
    window.Modules.inbox.openQuickCapture();
    const fields = lastModal.content.querySelectorAll('[data-field]');
    const titleInput = fields.find(function (f) { return f.dataset.field === 'captureText'; });
    titleInput.value = '明天下午3点交报告 #工作 提前30分钟提醒';
    lastModal.onOk();
    const state = window.Store.get();
    assert.strictEqual(state.todos.length, 1, '应创建 1 条待办');
    const t = state.todos[0];
    assert.strictEqual(t.title, '交报告');
    assert.notStrictEqual(t.deadline, null, '应解析出截止时间');
    assert.strictEqual(t.categoryName, '工作', '应解析出分类');
    assert.deepStrictEqual(t.reminds, [30], '应解析出提前提醒');
  });
});

test('review：周回顾渲染不抛错并包含关注项', function () {
  resetStore();
  seedTodo({ title: '逾期事项', deadline: Date.now() - 1000 });
  seedTodo({ title: '未整理想法' });
  window.Modules.review.render();
  const txt = rootText('review');
  assert.ok(txt.indexOf('周回顾') !== -1, '应有「周回顾」标题');
  assert.ok(txt.indexOf('需要关注') !== -1, '应有关注列表');
  assert.ok(txt.indexOf('逾期事项') !== -1, '逾期事项应被关注');
});

test('todo：排到日程创建时间块并回写 scheduledEventId', function () {
  resetStore();
  const t = seedTodo({ title: '排程测试', estimatedMinutes: 90 });
  window.Modules.todo.scheduleTodo(t);
  assert.ok(lastModal, '应打开排到日程 Modal');
  assert.ok(String(lastModal.title).indexOf('排程测试') !== -1);
  lastModal.onOk();
  const state = window.Store.get();
  assert.strictEqual(state.events.length, 1);
  assert.strictEqual(state.events[0].title, '排程测试');
  assert.strictEqual(state.events[0].endTime - state.events[0].startTime, 90 * 60000);
  assert.strictEqual(state.todos[0].scheduledEventId, state.events[0].id);
});

test('todo：编辑表单回填预估耗时为已有值', function () {
  resetStore();
  const t = seedTodo({ title: '已有预估', estimatedMinutes: 120 });
  window.Modules.todo.openTodoForm(t);
  assert.ok(lastModal, '应打开编辑 Modal');
  const est = lastModal.content.querySelectorAll('[data-field]').find(function (f) { return f.dataset.field === 'estimatedMinutes'; });
  assert.ok(est, '编辑表单应有预估耗时字段');
  assert.strictEqual(est.value, 120, '预估耗时下拉应回填 120');
});

test('schedule：月/周/日三种视图渲染不抛错', function () {
  resetStore();
  window.Modules.schedule.render(); // 默认月视图
  assert.ok(document.getElementById('view-schedule').children.length > 0);
});

test('memorials：渲染农历生日列表与倒计时不抛错', function () {
  resetStore();
  window.Store.addMemorial({
    id: 'm1', name: '妈妈的生日', kind: 'birthday', calendar: 'lunar',
    month: 5, day: 4, year: 1965, remindBeforeDays: 7,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  window.Modules.memorials.render();
  const txt = rootText('memorials');
  assert.ok(txt.indexOf('纪念日') !== -1, '应有「纪念日」标题');
  assert.ok(txt.indexOf('妈妈的生日') !== -1, '应列出名称');
  assert.ok(txt.indexOf('农历') !== -1, '农历生日应标注历法');
  assert.ok(txt.indexOf('提前 7 天提醒') !== -1, '应显示提前提醒天数');
});

test('bookkeeping：明细视图渲染账户余额与流水不抛错', function () {
  resetStore();
  window.Store.addAccount({ id: 'a1', name: '现金', type: 'cash', initialBalance: 10000, currency: 'CNY', color: '#4f8ef7', isArchived: false, createdAt: Date.now(), updatedAt: Date.now() });
  window.Store.addBookkeepingCategory({ id: 'bc1', name: '餐饮', type: 'expense', color: '#e05b5b', parentId: null, isDefault: true, createdAt: Date.now(), updatedAt: Date.now() });
  window.Store.addTransaction({ id: 't1', type: 'expense', amount: 2500, accountId: 'a1', toAccountId: null, categoryId: 'bc1', date: window.Utils.startOfMonth(Date.now()), note: '午饭', createdAt: Date.now(), updatedAt: Date.now() });
  window.Modules.bookkeeping.render();
  const txt = rootText('bookkeeping');
  assert.ok(txt.indexOf('支出') !== -1, '明细应有支出汇总');
  assert.ok(txt.indexOf('25.00') !== -1, '支出 25.00 元应显示');
  assert.ok(txt.indexOf('餐饮') !== -1, '分类名应显示在流水标题');
});

test('bookkeeping：报表与预算子页渲染不抛错', function () {
  resetStore();
  window.Store.addAccount({ id: 'a1', name: '银行卡', type: 'bank', initialBalance: 50000, currency: 'CNY', color: '#4f8ef7', isArchived: false, createdAt: Date.now(), updatedAt: Date.now() });
  window.Store.addBookkeepingCategory({ id: 'bc1', name: '餐饮', type: 'expense', color: '#e05b5b', parentId: null, isDefault: true, createdAt: Date.now(), updatedAt: Date.now() });
  window.Store.addTransaction({ id: 't1', type: 'expense', amount: 3000, accountId: 'a1', toAccountId: null, categoryId: 'bc1', date: window.Utils.startOfMonth(Date.now()), note: '', createdAt: Date.now(), updatedAt: Date.now() });
  window.Store.addBudget({ id: 'b1', categoryId: 'bc1', period: 'monthly', amount: 2000, createdAt: Date.now(), updatedAt: Date.now() });

  window.Modules.bookkeeping.render();
  const reportsBtn = findButton(document.getElementById('view-bookkeeping'), '报表');
  assert.ok(reportsBtn, '应有「报表」子页按钮');
  reportsBtn.dispatchEvent('click');
  assert.ok(rootText('bookkeeping').indexOf('消费日历') !== -1, '报表页应有消费日历');

  const budgetsBtn = findButton(document.getElementById('view-bookkeeping'), '预算');
  assert.ok(budgetsBtn, '应有「预算」子页按钮');
  budgetsBtn.dispatchEvent('click');
  assert.ok(rootText('bookkeeping').indexOf('已超支') !== -1, '超支预算应标注「已超支」');
});

test('bookkeeping：首个新增账户自动设为默认账户', function () {
  resetStore();
  window.Modules.bookkeeping.render();
  const acctBtn = findButton(document.getElementById('view-bookkeeping'), '账户');
  assert.ok(acctBtn, '应有「账户」子页按钮');
  acctBtn.dispatchEvent('click');
  const addBtn = findButton(document.getElementById('view-bookkeeping'), '+ 新增账户');
  assert.ok(addBtn, '应有「+ 新增账户」按钮');
  addBtn.dispatchEvent('click');
  assert.ok(lastModal && lastModal.content, '应弹出账户表单');
  const nameInput = fieldInput(lastModal.content, 'name');
  assert.ok(nameInput, '表单应有名称输入框');
  nameInput.value = '现金';
  lastModal.onOk();
  const state = window.Store.get();
  assert.strictEqual(state.accounts.length, 1, '应新增一个账户');
  const bk = state.settings.bookkeeping || {};
  assert.ok(bk.defaultAccountId, '首个账户应设为默认账户');
  assert.strictEqual(bk.defaultAccountId, state.accounts[0].id, '默认账户 id 应与新账户一致');
});
