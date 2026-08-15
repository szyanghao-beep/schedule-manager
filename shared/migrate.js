/*
 * migrate.js — 数据 schema 版本化与迁移框架。
 * data.json 顶层带 version 字段；无 version 的历史数据视为 v1。
 * MIGRATIONS[v] 为「把 version v 升级到 v+1」的迁移函数；migrateData 依次执行直到当前版本。
 * 纯函数（就地修改入参，返回同一对象）、无副作用，主进程与单元测试共用。
 */

'use strict';

// 当前数据 schema 版本。数据形状发生不兼容变更时递增，并在 MIGRATIONS 中补迁移函数。
const DATA_VERSION = 2;

// v1 -> v2：正式化早期「settings 深合并」修复 —— 旧数据缺字段时补齐默认值，
// 并防御性确保顶层数组字段存在（损坏/手改过的文件不至于在渲染层崩溃）。
function migrateV1toV2(data) {
  const defaults = { defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    data.settings = Object.assign({}, defaults);
  } else {
    data.settings = Object.assign({}, defaults, data.settings);
  }
  ['categories', 'events', 'todos', 'statsHistory'].forEach(function (key) {
    if (!Array.isArray(data[key])) data[key] = [];
  });
  return data;
}

const MIGRATIONS = {
  1: migrateV1toV2,
};

// 把任意版本的数据原地迁移到当前版本；返回同一对象。非对象输入原样返回。
function migrateData(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let v = Number.isInteger(raw.version) ? raw.version : 1;
  while (v < DATA_VERSION && typeof MIGRATIONS[v] === 'function') {
    MIGRATIONS[v](raw);
    v += 1;
  }
  raw.version = DATA_VERSION;
  return raw;
}

module.exports = { DATA_VERSION: DATA_VERSION, MIGRATIONS: MIGRATIONS, migrateData: migrateData };
