/*
 * migrate.js — 数据 schema 版本化与迁移框架。
 * data.json 顶层带 version 字段；无 version 的历史数据视为 v1。
 * MIGRATIONS[v] 为「把 version v 升级到 v+1」的迁移函数；migrateData 依次执行直到当前版本。
 * 纯函数（就地修改入参，返回同一对象）、无副作用，主进程与单元测试共用。
 */

'use strict';

// 当前数据 schema 版本。数据形状发生不兼容变更时递增，并在 MIGRATIONS 中补迁移函数。
const DATA_VERSION = 4;

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

// v2 -> v3：提醒字段升级 —— 单值 remindBefore 迁成 reminds 数组（支持一条多个提醒）。
// 保留 remindBefore 供旧客户端读取最早一次提醒；新客户端优先读 reminds。
function migrateV2toV3(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  ['events', 'todos'].forEach(function (key) {
    if (!Array.isArray(data[key])) return;
    data[key].forEach(function (rec) {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return;
      if (Array.isArray(rec.reminds)) return; // 已迁移，幂等
      const rb = Number(rec.remindBefore);
      rec.reminds = (isFinite(rb) && rb > 0) ? [rb] : [];
    });
  });
  return data;
}

// v3 -> v4：2.3.0 新增农历日历与收支记账。补齐 5 个顶层数组（记账账户/流水/分类/预算/纪念日），
// 以及 settings.calendar（农历/节气/节假日/休息日影响规划开关）与 settings.bookkeeping（默认账户/币种）子对象。
function migrateV3toV4(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  ['accounts', 'transactions', 'bookkeepingCategories', 'budgets', 'memorials'].forEach(function (key) {
    if (!Array.isArray(data[key])) data[key] = [];
  });
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    data.settings = {};
  }
  const CALENDAR_DEFAULTS = { showLunar: true, showSolarTerms: true, showHolidays: true, restDayAffectsPlanning: true };
  const BOOKKEEPING_DEFAULTS = { defaultAccountId: '', defaultCurrency: 'CNY' };
  data.settings.calendar = Object.assign(
    {}, CALENDAR_DEFAULTS,
    data.settings.calendar && typeof data.settings.calendar === 'object' ? data.settings.calendar : {}
  );
  data.settings.bookkeeping = Object.assign(
    {}, BOOKKEEPING_DEFAULTS,
    data.settings.bookkeeping && typeof data.settings.bookkeeping === 'object' ? data.settings.bookkeeping : {}
  );
  // 自定义节假日覆盖（A5 新年度导入），非对象则重置为空对象
  if (!data.settings.holidayData || typeof data.settings.holidayData !== 'object' || Array.isArray(data.settings.holidayData)) {
    data.settings.holidayData = {};
  }
  return data;
}

const MIGRATIONS = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
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
