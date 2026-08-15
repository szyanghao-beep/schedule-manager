/*
 * search.test.js — 搜索纯函数（utils.searchItems）测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const Utils = require('../src/renderer/js/utils.js');

const t0 = new Date('2026-08-15T09:00:00').getTime();
const t1 = new Date('2026-08-16T09:00:00').getTime();

function fixture() {
  return {
    events: [
      { id: 'e1', title: '周例会', description: '每周销售周例会', categoryName: '工作', startTime: t0, endTime: t0 + 3600000 },
      { id: 'e2', title: '健身', description: '晚 7 点去健身房', categoryName: '生活', startTime: t1, endTime: t1 + 3600000 },
    ],
    todos: [
      { id: 't1', title: '写季度报告', description: '给领导的季度汇报', categoryName: '工作', deadline: t1 },
      { id: 't2', title: '买牛奶', description: '', categoryName: '生活', deadline: null },
    ],
  };
}

test('空查询 / 空白查询返回空结果', function () {
  const d = fixture();
  assert.deepStrictEqual(Utils.searchItems('', d.events, d.todos), { events: [], todos: [] });
  assert.deepStrictEqual(Utils.searchItems('   ', d.events, d.todos), { events: [], todos: [] });
});

test('标题匹配', function () {
  const d = fixture();
  const res = Utils.searchItems('例会', d.events, d.todos);
  assert.deepStrictEqual(res.events.map(function (e) { return e.id; }), ['e1']);
  assert.strictEqual(res.todos.length, 0);
});

test('描述匹配', function () {
  const d = fixture();
  const res = Utils.searchItems('健身房', d.events, d.todos);
  assert.deepStrictEqual(res.events.map(function (e) { return e.id; }), ['e2']);
});

test('分类名匹配', function () {
  const d = fixture();
  const res = Utils.searchItems('工作', d.events, d.todos);
  assert.deepStrictEqual(res.events.map(function (e) { return e.id; }), ['e1']);
  assert.deepStrictEqual(res.todos.map(function (t) { return t.id; }), ['t1']);
});

test('大小写不敏感', function () {
  const d = fixture();
  d.events.push({ id: 'e3', title: 'Team Sync', description: '', categoryName: '工作', startTime: t1, endTime: t1 + 3600000 });
  const res = Utils.searchItems('team', d.events, d.todos);
  assert.deepStrictEqual(res.events.map(function (e) { return e.id; }), ['e3']);
});

test('多关键词 AND：需同时命中（标题+描述跨字段）', function () {
  const d = fixture();
  const res = Utils.searchItems('例会 销售', d.events, d.todos);
  assert.deepStrictEqual(res.events.map(function (e) { return e.id; }), ['e1']);
  const miss = Utils.searchItems('例会 健身', d.events, d.todos);
  assert.strictEqual(miss.events.length + miss.todos.length, 0);
});

test('事件按 startTime 升序、无时间排最后', function () {
  const events = [
    { id: 'later', title: 'xyz', description: '', categoryName: '', startTime: t1 },
    { id: 'early', title: 'xyz', description: '', categoryName: '', startTime: t0 },
    { id: 'none', title: 'xyz', description: '', categoryName: '', startTime: null },
  ];
  const r = Utils.searchItems('xyz', events, []);
  assert.deepStrictEqual(r.events.map(function (e) { return e.id; }), ['early', 'later', 'none']);
});

test('待办按 deadline 升序、无截止排最后', function () {
  const todos = [
    { id: 'later', title: 'xyz', description: '', categoryName: '', deadline: t1 },
    { id: 'none', title: 'xyz', description: '', categoryName: '', deadline: null },
    { id: 'early', title: 'xyz', description: '', categoryName: '', deadline: t0 },
  ];
  const r = Utils.searchItems('xyz', [], todos);
  assert.deepStrictEqual(r.todos.map(function (t) { return t.id; }), ['early', 'later', 'none']);
});

test('空数组安全，不修改入参', function () {
  const d = fixture();
  const eventsBefore = JSON.stringify(d.events);
  const todosBefore = JSON.stringify(d.todos);
  const res = Utils.searchItems('例会', d.events, d.todos);
  assert.strictEqual(JSON.stringify(d.events), eventsBefore);
  assert.strictEqual(JSON.stringify(d.todos), todosBefore);
  assert.deepStrictEqual(Utils.searchItems('x', [], []), { events: [], todos: [] });
  assert.deepStrictEqual(Utils.searchItems('x', null, null), { events: [], todos: [] });
});
