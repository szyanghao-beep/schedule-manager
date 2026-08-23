/*
 * migrate.test.js — schema 版本化与迁移框架测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const { DATA_VERSION, migrateData } = require('../shared/migrate.js');

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
  assert.strictEqual(old.settings.defaultRemindBefore, 15);
  assert.strictEqual(old.settings.urgentThresholdHours, 24);
  assert.strictEqual(old.settings.theme, 'system');
  // v4 补齐的日历/记账子对象
  assert.deepStrictEqual(old.settings.calendar, { showLunar: true, showSolarTerms: true, showHolidays: true, restDayAffectsPlanning: true });
  assert.deepStrictEqual(old.settings.bookkeeping, { defaultAccountId: '', defaultCurrency: 'CNY' });
  assert.deepStrictEqual(old.settings.holidayData, {});
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

test('v2 -> v3：remindBefore 迁成 reminds 数组（保留旧字段，幂等）', function () {
  const old = {
    version: 2, categories: [], statsHistory: [],
    events: [{ id: 'e1', title: '会议', startTime: 1, remindBefore: 30 }],
    todos: [{ id: 't1', title: '任务', remindBefore: 0 }, { id: 't2', title: '任务2', remindBefore: 60 }],
  };
  migrateData(old);
  assert.strictEqual(old.version, DATA_VERSION);
  assert.deepStrictEqual(old.events[0].reminds, [30]);
  assert.strictEqual(old.events[0].remindBefore, 30); // 保留旧字段供旧客户端读取
  assert.deepStrictEqual(old.todos[0].reminds, []);   // remindBefore=0 -> 空
  assert.deepStrictEqual(old.todos[1].reminds, [60]);
  // 幂等：再次迁移不改变
  const snap = JSON.stringify(old);
  migrateData(old);
  assert.strictEqual(JSON.stringify(old), snap);
});

test('v3 -> v4：补齐记账/纪念日数组与 settings 子对象（保留已有值）', function () {
  const old = {
    version: 3, categories: [], events: [], todos: [], statsHistory: [],
    settings: { calendar: { showLunar: false }, bookkeeping: {} },
  };
  migrateData(old);
  assert.strictEqual(old.version, DATA_VERSION);
  ['accounts', 'transactions', 'bookkeepingCategories', 'budgets', 'memorials'].forEach(function (k) {
    assert.ok(Array.isArray(old[k]), k + ' 应为数组');
  });
  // 已有值保留，缺省值补齐
  assert.strictEqual(old.settings.calendar.showLunar, false);
  assert.strictEqual(old.settings.calendar.showHolidays, true);
  assert.strictEqual(old.settings.bookkeeping.defaultCurrency, 'CNY');
  assert.deepStrictEqual(old.settings.holidayData, {});
});
