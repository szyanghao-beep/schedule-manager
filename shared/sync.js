/*
 * sync.js — 多端同步纯函数（单一来源，desktop / server / mobile 三方共用）
 *
 * 核心约定：
 *   1. 每条记录统一带 { id, entityType, deleted(软删除墓碑), updatedAt } 四个同步字段。
 *   2. 同步以「记录级增量」进行，不做整文件覆盖。
 *   3. 冲突解决用 LWW（Last-Write-Wins）：updatedAt 新者胜；
 *      时间相同则「已删除(墓碑)」优先，避免已删记录被旧副本复活。
 *   4. 服务端时间仲裁：服务端在合并前把 change.updatedAt 重写为服务器时间，
 *      避免设备本地时钟不准导致 LWW 失效（见 server 端实现）。
 *
 * 纯函数、无副作用，Node(CommonJS) 直接 require，可单测。
 */

'use strict';

// 实体类型枚举
const ENTITY_TYPES = {
  CATEGORY: 'category',
  EVENT: 'event',
  TODO: 'todo',
  SETTING: 'setting',
};

// 取记录时间戳（兼容旧记录缺少 updatedAt 的情况）
function recordTime(rec) {
  if (!rec) return 0;
  if (typeof rec.updatedAt === 'number') return rec.updatedAt;
  if (typeof rec.createdAt === 'number') return rec.createdAt;
  return 0;
}

// LWW：同 id 同类型，updatedAt 新者胜；相等时 deleted(墓碑) 优先
function lww(a, b) {
  const ta = recordTime(a);
  const tb = recordTime(b);
  if (ta !== tb) return ta > tb ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return a;
}

// 记录 -> 变更对象（change）
function toChange(rec, entityType) {
  return {
    entityType: entityType,
    id: rec.id,
    deleted: !!rec.deleted,
    updatedAt: recordTime(rec),
    data: rec,
  };
}

function changeKey(ch) {
  return ch.entityType + ':' + ch.id;
}

// 把一批 change 合并进记录 map（key = entityType:id -> record）
// 返回合并后的 map（原地修改传入的 map，或新建）
function mergeChanges(map, changes) {
  const out = map || new Map();
  (changes || []).forEach(function (ch) {
    if (!ch || !ch.id || !ch.entityType) return; // 跳过非法 change
    const incoming = Object.assign({}, ch.data, {
      id: ch.id,
      entityType: ch.entityType,
      deleted: !!ch.deleted,
      updatedAt: (ch.updatedAt != null) ? ch.updatedAt : recordTime(ch.data),
    });
    const existing = out.get(changeKey(ch));
    out.set(changeKey(ch), existing ? lww(existing, incoming) : incoming);
  });
  return out;
}

// 从记录集合提取 since 之后发生变化的记录（增量拉取）
function extractChanges(records, entityType, sinceTs) {
  const out = [];
  (records || []).forEach(function (r) {
    if (recordTime(r) > sinceTs) out.push(toChange(r, entityType));
  });
  return out;
}

// 提取「本地修改」的变更（用 localModifiedAt，客户端时间轴）。
// 与 extractChanges 的区别：远程拉取回来的记录只有服务端时间的 updatedAt、
// 没有 localModifiedAt，不应被回推；本地修改会同时带 localModifiedAt。
function extractLocalChanges(records, entityType, sinceTs) {
  const out = [];
  (records || []).forEach(function (r) {
    const t = r.localModifiedAt || 0;
    if (t > sinceTs) out.push(toChange(r, entityType));
  });
  return out;
}

// 从 map 中取某实体类型的「存活」记录（排除墓碑）
function liveRecords(map, entityType) {
  const out = [];
  map.forEach(function (rec) {
    if (rec.entityType === entityType && !rec.deleted) out.push(rec);
  });
  return out;
}

// 把记录数组按 entityType 分组构建 map（用于合并前的初始化）
function recordsToMap(records, entityType) {
  const map = new Map();
  (records || []).forEach(function (r) {
    map.set(entityType + ':' + r.id, Object.assign({ entityType: entityType }, r));
  });
  return map;
}

module.exports = {
  ENTITY_TYPES: ENTITY_TYPES,
  recordTime: recordTime,
  lww: lww,
  toChange: toChange,
  changeKey: changeKey,
  mergeChanges: mergeChanges,
  extractChanges: extractChanges,
  extractLocalChanges: extractLocalChanges,
  liveRecords: liveRecords,
  recordsToMap: recordsToMap,
};
