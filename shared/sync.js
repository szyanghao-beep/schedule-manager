/*
 * sync.js — 多端同步纯函数（单一来源，desktop / server / mobile 三方共用）
 *
 * 核心约定：
 *   1. 每条记录统一带 { id, entityType, deleted(软删除墓碑), updatedAt } 四个同步字段。
 *   2. 同步以「记录级增量」进行，不做整文件覆盖。
 *   3. 冲突解决用 LWW（Last-Write-Wins）：updatedAt 新者胜；
 *      时间相同则「已删除(墓碑)」优先，避免已删记录被旧副本复活。
 *   4. 服务端仲裁：LWW 按客户端声明的编辑时间（updatedAt）判定，服务端另盖
 *      单调递增的 updated_at 仅作增量拉取游标，二者职责分离（见 server 端实现）。
 *      客户端时间轴只用于推送判定（localModifiedAt），不与服务端时间混用。
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
  CUSTOMER: 'customer',   // 2.3.2：客户商机
  FOLLOWUP: 'followup',   // 2.3.2：跟进记录
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
  const data = Object.assign({}, rec);
  // localModifiedAt 是「客户端内部」追踪字段，不参与同步：
  // 若随 data 上传，会被别的设备拉取后误判为「本地修改」而反复重推。
  delete data.localModifiedAt;
  return {
    entityType: entityType,
    id: rec.id,
    deleted: !!rec.deleted,
    updatedAt: recordTime(rec),
    data: data,
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
//
// ⚠️ key 是 entityType + ':' + id。若某些记录**缺 id**，它们会全部塌缩成同一个 key
// （entityType:undefined），合并后只剩最后一条 —— 表现为「一批数据被清空」。
// 所以这里对缺 id 的记录改用递增的独立 key，宁可它们同步不了，也不能互相覆盖掉。
let warnedMissingId = false;
function recordsToMap(records, entityType) {
  const map = new Map();
  (records || []).forEach(function (r, i) {
    if (!r) return;
    const key = r.id
      ? entityType + ':' + r.id
      : entityType + ':' + '__missing_id__' + i;
    if (!r.id && !warnedMissingId) {
      warnedMissingId = true;
      console.warn('[sync] 发现缺少 id 的记录（' + entityType +
        '）：已用独立键保存以免互相覆盖，但这类记录无法参与同步');
    }
    map.set(key, Object.assign({ entityType: entityType }, r));
  });
  return map;
}

// 数据安全护栏：合并后「某类记录变少」是否可疑？
//
// 同步是**唯一能删掉本地数据**的通道，所以合并结果必须校验：
// 记录减少只能由「抵达的墓碑（deleted 变更）」解释 —— 一条墓碑最多删一条记录。
// 若减少得比墓碑能解释的还多，说明合并逻辑有问题（例如记录缺 id 挤到同一个 key、
// 或某个环节漏了字段），此时应当整批放弃、保住本地数据，而不是照单全收。
//
// @param beforeByType { entityType: 合并前存活记录数 }
// @param afterByType  { entityType: 合并后存活记录数 }
// @param changes      本批远程变更
// @returns 违规列表（空数组 = 安全）
function detectSuspiciousLoss(beforeByType, afterByType, changes) {
  const violations = [];
  Object.keys(beforeByType || {}).forEach(function (type) {
    const before = beforeByType[type] || 0;
    const after = (afterByType || {})[type] || 0;
    if (after >= before) return; // 没减少，安全
    const tombstones = (changes || []).filter(function (c) {
      return c && c.entityType === type && c.deleted;
    }).length;
    const lost = before - after;
    if (lost > tombstones) {
      violations.push({ entityType: type, before: before, after: after, tombstones: tombstones, lost: lost });
    }
  });
  return violations;
}

// 带护栏的合并（desktop 主进程实际走的就是这个函数，因此测试覆盖的就是真实路径）
//
// @param localByField 本地数据对象（含各实体字段，如 data.categories / data.customers）
// @param entities     [{ field: 'customers', type: 'customer' }, ...]
// @param changes      远程变更
// @param onBeforeMerge 可选回调，在合并**之前**拿到初始 map（用于快照本地已修改记录）
// @returns { ok, map, beforeByType, afterByType, violations }
//          ok=false 时**不要**采用 map —— 调用方应放弃这一批，保住本地数据。
function mergeWithGuardrail(localByField, entities, changes, onBeforeMerge) {
  const map = new Map();
  (entities || []).forEach(function (e) {
    recordsToMap((localByField || {})[e.field] || [], e.type).forEach(function (v, k) { map.set(k, v); });
  });

  const beforeByType = {};
  (entities || []).forEach(function (e) {
    beforeByType[e.type] = ((localByField || {})[e.field] || []).filter(function (r) {
      return r && !r.deleted;
    }).length;
  });

  if (typeof onBeforeMerge === 'function') onBeforeMerge(map);

  mergeChanges(map, changes);

  const afterByType = {};
  (entities || []).forEach(function (e) {
    afterByType[e.type] = liveRecords(map, e.type).length;
  });

  const violations = detectSuspiciousLoss(beforeByType, afterByType, changes);
  return {
    ok: violations.length === 0,
    map: map,
    beforeByType: beforeByType,
    afterByType: afterByType,
    violations: violations,
  };
}

// 增量拉取的游标推进规则（修 bug：曾用 serverTime 推进导致分页时漏记录）
//
// 服务端返回的 serverTime 是**服务端全局最新时间**，不是本批最后一条的时间。
// 若用它推进游标，两页之间的记录（updatedAt < serverTime）会被永久跳过、
// 前端再也拉不到。所以游标只能推进到**本批实际返回记录的最大 updatedAt**。
function nextPullCursor(currentCursor, changes) {
  const cur = Number(currentCursor) || 0;
  let maxT = 0;
  (changes || []).forEach(function (c) {
    const t = Number(c && c.updatedAt) || 0;
    if (t > maxT) maxT = t;
  });
  return maxT > cur ? maxT : cur;
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
  detectSuspiciousLoss: detectSuspiciousLoss,
  mergeWithGuardrail: mergeWithGuardrail,
  nextPullCursor: nextPullCursor,
};
