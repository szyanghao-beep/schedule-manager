/*
 * migrate.test.js — schema 版本化与迁移框架测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const { DATA_VERSION, migrateData } = require('../src/shared/migrate.js');

test('DATA_VERSION 为整数且 >= 1', function () {
  assert.ok(Number.isInteger(DATA_VERSION) && DATA_VERSION >= 1);
});

test('无 version 字段的旧数据视为 v1 并迁移到当前版本', function () {
  const old = { categories: [], events: [], todos: [], settings: {}, statsHistory: [] };
  migrateData(old);
  assert.strictEqual(old.version, DATA_VERSION);
  assert.strictEqual(old.settings.urgentThresholdHours, 24);
  assert.strictEqual(old.settings.defaultRemindBefore, 15);
  assert.strictEqual(old.settings.theme, 'system');
});

test('迁移保留用户已有的设置值，仅补缺失字段', function () {
  const old = { categories: [], events: [], todos: [], settings: { urgentThresholdHours: 48 }, statsHistory: [] };
  migrateData(old);
  assert.strictEqual(old.settings.urgentThresholdHours, 48);
  assert.strictEqual(old.settings.defaultRemindBefore, 15);
});

test('settings 完全缺失时补默认值', function () {
  const old = { categories: [], events: [], todos: [] };
  migrateData(old);
  assert.deepStrictEqual(old.settings, { defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system' });
});

test('顶层数组字段缺失时迁移补空数组（防御损坏文件）', function () {
  const old = { settings: { defaultRemindBefore: 5 } };
  migrateData(old);
  assert.ok(Array.isArray(old.events));
  assert.ok(Array.isArray(old.todos));
  assert.ok(Array.isArray(old.categories));
  assert.ok(Array.isArray(old.statsHistory));
});

test('当前版本数据迁移为幂等（不改变任何字段）', function () {
  const cur = {
    version: DATA_VERSION, categories: [], events: [], todos: [],
    settings: { defaultRemindBefore: 30, urgentThresholdHours: 12, theme: 'dark' }, statsHistory: [],
  };
  const snapshot = JSON.stringify(cur);
  migrateData(cur);
  assert.strictEqual(JSON.stringify(cur), snapshot);
});

test('非对象输入原样返回不抛错', function () {
  assert.strictEqual(migrateData(null), null);
  assert.strictEqual(migrateData(undefined), undefined);
  assert.strictEqual(migrateData('x'), 'x');
});

test('显式 version:1 的旧数据同样完成迁移', function () {
  const old = { version: 1, categories: [], events: [], todos: [], settings: {} };
  migrateData(old);
  assert.strictEqual(old.version, DATA_VERSION);
  assert.strictEqual(old.settings.urgentThresholdHours, 24);
});
