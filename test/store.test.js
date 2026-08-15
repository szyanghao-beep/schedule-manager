/*
 * store.test.js — 数据层（store.js）单元测试：CRUD、分类同步、级联、防抖持久化。
 * store.js 依赖 window/API，这里提供最小 shim 后在 Node 中直接跑。
 */
const test = require('node:test');
const assert = require('node:assert');

let savedPayloads = [];
global.window = {
  API: { saveData: function (payload) { savedPayloads.push(payload); } },
};

require('../src/renderer/js/store.js');
const Store = global.window.Store;

test('addEvent / updateEvent / deleteEvent 基本 CRUD', function () {
  Store.set({ events: [], todos: [], categories: [], settings: {} });
  Store.addEvent({ id: 'e1', title: 'a' });
  assert.strictEqual(Store.get().events.length, 1);
  Store.updateEvent('e1', { title: 'b' });
  assert.strictEqual(Store.get().events[0].title, 'b');
  Store.deleteEvent('e1');
  assert.strictEqual(Store.get().events.length, 0);
});

test('updateCategory 同步分类名与颜色到关联条目', function () {
  Store.set({
    categories: [{ id: 'c1', name: '工作', color: '#111' }],
    events: [{ id: 'e1', categoryId: 'c1' }],
    todos: [{ id: 't1', categoryId: 'c1' }],
    settings: {},
  });
  Store.updateCategory('c1', { name: '生活', color: '#222' });
  assert.strictEqual(Store.get().events[0].categoryName, '生活');
  assert.strictEqual(Store.get().events[0].categoryColor, '#222');
  assert.strictEqual(Store.get().todos[0].categoryName, '生活');
});

test('deleteCategory 关联条目归为未分类', function () {
  Store.set({
    categories: [{ id: 'c1', name: '工作', color: '#111' }],
    events: [{ id: 'e1', categoryId: 'c1' }],
    todos: [{ id: 't1', categoryId: 'c1' }],
    settings: {},
  });
  Store.deleteCategory('c1');
  assert.strictEqual(Store.get().categories.length, 0);
  assert.strictEqual(Store.get().events[0].categoryId, '');
  assert.strictEqual(Store.get().events[0].categoryName, '未分类');
  assert.strictEqual(Store.get().todos[0].categoryId, '');
});

test('deleteTodos / updateTodos 批量操作', function () {
  Store.set({ events: [], todos: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], categories: [], settings: {} });
  Store.updateTodos(['t1', 't3'], { status: 'done' });
  assert.strictEqual(Store.get().todos[0].status, 'done');
  assert.strictEqual(Store.get().todos[1].status, undefined);
  assert.strictEqual(Store.get().todos[2].status, 'done');
  Store.deleteTodos(['t2']);
  assert.strictEqual(Store.get().todos.length, 2);
});

test('set 合并部分字段，不覆盖未提供的字段', function () {
  Store.set({ settings: { defaultRemindBefore: 30 } });
  Store.set({ categories: [{ id: 'x', name: 'y' }] });
  assert.strictEqual(Store.get().settings.defaultRemindBefore, 30);
  assert.strictEqual(Store.get().categories.length, 1);
});

test('防抖保存：连续变更只触发一次 saveData', async function () {
  await new Promise(function (r) { setTimeout(r, 600); }); // 冲刷前面用例遗留的定时器
  savedPayloads = [];
  Store.set({ events: [], todos: [], categories: [], settings: {} });
  Store.addEvent({ id: 'x', title: '1' });
  Store.addEvent({ id: 'y', title: '2' });
  Store.addEvent({ id: 'z', title: '3' });
  await new Promise(function (r) { setTimeout(r, 700); });
  assert.strictEqual(savedPayloads.length, 1);
  assert.strictEqual(savedPayloads[0].events.length, 3);
});
