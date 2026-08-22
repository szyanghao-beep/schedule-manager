/*
 * sync.gtd.test.js — 同步字段保真回归测试（node --test）
 *
 * 验证 v2.1.0 新增的待办字段 estimatedMinutes / scheduledEventId 在记录级增量同步
 * （toChange → mergeChanges → liveRecords）中完整保留，不被归一化或白名单丢弃。
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../shared/sync.js');

test('toChange：保留 estimatedMinutes / scheduledEventId 到 data 载荷', function () {
  const todo = {
    id: 't1', title: '写周报', status: 'pending', deadline: null,
    estimatedMinutes: 45, scheduledEventId: 'ev-123',
    updatedAt: 1000, localModifiedAt: 1000,
  };
  const ch = sync.toChange(todo, sync.ENTITY_TYPES.TODO);
  assert.strictEqual(ch.data.estimatedMinutes, 45);
  assert.strictEqual(ch.data.scheduledEventId, 'ev-123');
  // localModifiedAt 是客户端内部追踪字段，不应随 data 上传
  assert.strictEqual(ch.data.localModifiedAt, undefined);
});

test('mergeChanges：合并后字段完整保真（往返一致）', function () {
  const map = new Map();
  const changes = [{
    entityType: sync.ENTITY_TYPES.TODO,
    id: 't1',
    deleted: false,
    updatedAt: 2000,
    data: { id: 't1', title: '写周报', status: 'pending', estimatedMinutes: 90, scheduledEventId: 'ev-x', deadline: null },
  }];
  sync.mergeChanges(map, changes);
  const live = sync.liveRecords(map, sync.ENTITY_TYPES.TODO);
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].estimatedMinutes, 90);
  assert.strictEqual(live[0].scheduledEventId, 'ev-x');
});

test('extractLocalChanges：本地修改（含新字段）可被提取推送', function () {
  const todos = [
    { id: 't1', title: 'a', status: 'pending', estimatedMinutes: 30, scheduledEventId: 'ev1', updatedAt: 500, localModifiedAt: 3000 },
    { id: 't2', title: 'b', status: 'pending', estimatedMinutes: null, updatedAt: 500, localModifiedAt: 0 },
  ];
  const changes = sync.extractLocalChanges(todos, sync.ENTITY_TYPES.TODO, 2000);
  assert.strictEqual(changes.length, 1, '只有 localModifiedAt > since 的记录被推送');
  assert.strictEqual(changes[0].id, 't1');
  assert.strictEqual(changes[0].data.estimatedMinutes, 30);
  assert.strictEqual(changes[0].data.scheduledEventId, 'ev1');
});
