/*
 * sync.test.js — 同步纯函数测试（LWW 合并、软删除墓碑、增量变更）
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../shared/sync.js');
const model = require('../shared/model.js');

const { ENTITY_TYPES } = sync;

test('lww：updatedAt 新者胜', function () {
  const a = { id: 'x', updatedAt: 100, title: 'old' };
  const b = { id: 'x', updatedAt: 200, title: 'new' };
  assert.strictEqual(sync.lww(a, b), b);
});

test('lww：时间相等时墓碑(deleted)优先，防止已删记录复活', function () {
  const live = { id: 'x', updatedAt: 100, deleted: false };
  const tomb = { id: 'x', updatedAt: 100, deleted: true };
  assert.strictEqual(sync.lww(live, tomb), tomb);
  assert.strictEqual(sync.lww(tomb, live), tomb);
});

test('recordTime：兼容缺少 updatedAt 的旧记录回退 createdAt', function () {
  assert.strictEqual(sync.recordTime({ createdAt: 5 }), 5);
  assert.strictEqual(sync.recordTime({ updatedAt: 9, createdAt: 5 }), 9);
  assert.strictEqual(sync.recordTime(null), 0);
});

test('mergeChanges：合并新记录并规范化同步字段', function () {
  const map = sync.mergeChanges(null, [
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: false, updatedAt: 10, data: { title: 'a' } },
  ]);
  const rec = map.get('todo:t1');
  assert.ok(rec);
  assert.strictEqual(rec.entityType, 'todo');
  assert.strictEqual(rec.id, 't1');
  assert.strictEqual(rec.deleted, false);
  assert.strictEqual(rec.updatedAt, 10);
  assert.strictEqual(rec.title, 'a');
});

test('mergeChanges：同 id 冲突时 LWW 覆盖', function () {
  const map = sync.mergeChanges(null, [
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: false, updatedAt: 10, data: { title: 'old' } },
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: false, updatedAt: 20, data: { title: 'new' } },
  ]);
  assert.strictEqual(map.get('todo:t1').title, 'new');
});

test('mergeChanges：墓碑优先（旧更新删除 vs 新更新但未删）', function () {
  // 模拟：一台设备在 t=20 删除，另一台在 t=15 修改（时钟乱序），墓碑应胜出
  const map = sync.mergeChanges(null, [
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: true, updatedAt: 20, data: { title: 'x' } },
  ]);
  sync.mergeChanges(map, [
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: false, updatedAt: 15, data: { title: 'y' } },
  ]);
  assert.strictEqual(map.get('todo:t1').deleted, true);
});

test('extractChanges：只提取 since 之后的变更', function () {
  const records = [
    { id: 'a', updatedAt: 1 },
    { id: 'b', updatedAt: 5 },
    { id: 'c', updatedAt: 9 },
  ];
  const changes = sync.extractChanges(records, ENTITY_TYPES.EVENT, 5);
  assert.deepStrictEqual(changes.map(function (c) { return c.id; }), ['c']);
});

test('extractLocalChanges：只提取本地修改（有 localModifiedAt）的记录，忽略远程拉取的记录', function () {
  const records = [
    { id: 'a', updatedAt: 1000, localModifiedAt: 100 }, // 本地修改
    { id: 'b', updatedAt: 900, localModifiedAt: 50 },    // 本地修改（早于 since）
    { id: 'c', updatedAt: 9999 },                        // 远程拉取，无 localModifiedAt，不回推
  ];
  const changes = sync.extractLocalChanges(records, ENTITY_TYPES.TODO, 60);
  assert.deepStrictEqual(changes.map(function (c) { return c.id; }), ['a']);
});

test('liveRecords：排除墓碑，只返回存活记录', function () {
  const map = sync.mergeChanges(null, [
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: false, updatedAt: 1, data: {} },
    { entityType: ENTITY_TYPES.TODO, id: 't2', deleted: true, updatedAt: 2, data: {} },
    { entityType: ENTITY_TYPES.EVENT, id: 'e1', deleted: false, updatedAt: 3, data: {} },
  ]);
  const todos = sync.liveRecords(map, ENTITY_TYPES.TODO);
  assert.deepStrictEqual(todos.map(function (r) { return r.id; }), ['t1']);
});

test('recordsToMap + mergeChanges：本地记录与服务端 change 双向合并', function () {
  const local = [
    { id: 't1', updatedAt: 10, deleted: false, title: 'local' },
    { id: 't2', updatedAt: 10, deleted: false, title: 'local2' },
  ];
  const map = sync.recordsToMap(local, ENTITY_TYPES.TODO);
  // 服务端 t2 更新更晚、t3 为新增、t1 服务端已删除
  sync.mergeChanges(map, [
    { entityType: ENTITY_TYPES.TODO, id: 't2', deleted: false, updatedAt: 20, data: { title: 'server' } },
    { entityType: ENTITY_TYPES.TODO, id: 't3', deleted: false, updatedAt: 30, data: { title: 'new' } },
    { entityType: ENTITY_TYPES.TODO, id: 't1', deleted: true, updatedAt: 15, data: {} },
  ]);
  const todos = sync.liveRecords(map, ENTITY_TYPES.TODO);
  const byId = {};
  todos.forEach(function (r) { byId[r.id] = r; });
  assert.deepStrictEqual(Object.keys(byId).sort(), ['t2', 't3']);
  assert.strictEqual(byId.t2.title, 'server');
});

test('model.validateChanges：校验 change 合法性', function () {
  assert.strictEqual(model.validateChanges('x').ok, false);
  assert.strictEqual(model.validateChanges([{ id: 'a' }]).ok, false); // 缺 entityType
  assert.strictEqual(model.validateChanges([{ entityType: 'todo' }]).ok, false); // 缺 id
  assert.strictEqual(model.validateChanges([{ id: 'a', entityType: 'todo' }]).ok, true);
});

test('model.normalizeRecord：补齐同步字段', function () {
  const r = model.normalizeRecord({ id: 'x', createdAt: 7 }, ENTITY_TYPES.TODO);
  assert.strictEqual(r.entityType, 'todo');
  assert.strictEqual(r.deleted, false);
  assert.strictEqual(r.updatedAt, 7);
});
