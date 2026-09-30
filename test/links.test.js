/*
 * links.test.js — 「收件箱 → 待办 → 日程」关联与流转的纯函数测试
 *
 * 这些用例对应的都是真实割裂感：
 *   - 待办「排到日程」后，待办里看不出已排、日程里看不出从哪来
 *   - 日程被删后待办仍显示「已排到日程」，点进去是空的（悬空关联）
 *   - 待办完成了，日程还挂在「未开始」
 *   - 手机收集来的条目在收件箱里看不出来源
 */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../shared/links.js');

function mkTodo(over) {
  return Object.assign({ id: 't1', title: '写方案', status: 'pending', deadline: null }, over || {});
}
function mkEvent(over) {
  return Object.assign({ id: 'e1', title: '写方案', status: 'pending', startTime: 1000, endTime: 2000 }, over || {});
}

test('linkedEvent：能取到关联日程；关联的日程被删除后返回 null', function () {
  const t = mkTodo({ scheduledEventId: 'e1' });
  assert.strictEqual(L.linkedEvent(t, [mkEvent()]).id, 'e1');
  assert.strictEqual(L.linkedEvent(t, [mkEvent({ deleted: true })]), null, '软删除的日程不算存在');
  assert.strictEqual(L.linkedEvent(t, []), null);
  assert.strictEqual(L.linkedEvent(mkTodo(), [mkEvent()]), null, '没排程的待办不该关联到任何日程');
});

test('eventToTodoIndex：日程侧能反查到来源待办', function () {
  const idx = L.eventToTodoIndex([
    mkTodo({ id: 't1', scheduledEventId: 'e1' }),
    mkTodo({ id: 't2' }),
    mkTodo({ id: 't3', scheduledEventId: 'e3', deleted: true }),
  ]);
  assert.strictEqual(idx.e1.id, 't1');
  assert.strictEqual(idx.e3, undefined, '已删除的待办不应建立反查');
  assert.strictEqual(Object.keys(idx).length, 1);
});

test('danglingTodos：找出指向已不存在日程的待办（否则界面一直显示「已排到日程」）', function () {
  const todos = [
    mkTodo({ id: 'ok', scheduledEventId: 'e1' }),
    mkTodo({ id: 'dangling', scheduledEventId: 'gone' }),
    mkTodo({ id: 'none' }),
  ];
  const ids = L.danglingTodos(todos, [mkEvent()]).map(function (t) { return t.id; });
  assert.deepStrictEqual(ids, ['dangling']);
});

test('statusSyncPatch：待办完成 → 关联日程也标记完成；取消完成则一起回退', function () {
  const t = mkTodo({ id: 't1', scheduledEventId: 'e1' });
  const done = L.statusSyncPatch(t, [mkEvent()], true);
  assert.strictEqual(done.eventId, 'e1');
  assert.strictEqual(done.patch.status, 'done');
  assert.ok(done.patch.completedAt > 0);

  const undone = L.statusSyncPatch(t, [mkEvent({ status: 'done', completedAt: 5 })], false);
  assert.strictEqual(undone.patch.status, 'pending');
  assert.strictEqual(undone.patch.completedAt, null);
});

test('statusSyncPatch：状态已一致时返回 null，避免无谓写库触发同步推送', function () {
  const t = mkTodo({ id: 't1', scheduledEventId: 'e1' });
  assert.strictEqual(L.statusSyncPatch(t, [mkEvent({ status: 'done' })], true), null);
  assert.strictEqual(L.statusSyncPatch(t, [mkEvent({ status: 'pending' })], false), null);
  assert.strictEqual(L.statusSyncPatch(mkTodo(), [mkEvent()], true), null, '没有关联日程时不同步');
});

test('sourceLabel：手机收集的条目带来源标签，桌面捕捉的不带', function () {
  assert.strictEqual(L.sourceLabel({ source: 'mobile-inbox' }), '手机收集');
  assert.strictEqual(L.sourceLabel({}), '');
  assert.strictEqual(L.sourceLabel(null), '');
});

test('isInboxItem/inboxTodos：收件箱 = 未完成且无截止时间（与 inbox.js 判定一致）', function () {
  const todos = [
    mkTodo({ id: 'a' }),                                      // 未整理
    mkTodo({ id: 'b', deadline: 1000 }),                      // 已定截止 → 不在收件箱
    mkTodo({ id: 'c', status: 'done' }),                      // 已完成 → 不在收件箱
    mkTodo({ id: 'd', deleted: true }),                       // 已删除 → 不在收件箱
  ];
  assert.deepStrictEqual(L.inboxTodos(todos).map(function (t) { return t.id; }), ['a']);
  // deadline 用 == null 判定：只有 null/undefined 才算「没设截止」。
  // deadline:0（1970 年）虽无意义，但确实是个已设置的值，不应留在收件箱。
  assert.strictEqual(L.isInboxItem(mkTodo({ deadline: 0 })), false);
  assert.strictEqual(L.isInboxItem(mkTodo({ deadline: null })), true);
  assert.strictEqual(L.isInboxItem(mkTodo({ deadline: undefined })), true);
});
