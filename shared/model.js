/*
 * model.js — 数据模型契约（desktop / server / mobile 三方共用）
 * 定义可同步实体、记录规范化、以及多端一致的数据形状。
 */

'use strict';

const { ENTITY_TYPES } = require('./sync.js');

// 可同步实体 -> 在 data 对象中的数组字段名
const ENTITY_FIELDS = {
  categories: ENTITY_TYPES.CATEGORY,
  events: ENTITY_TYPES.EVENT,
  todos: ENTITY_TYPES.TODO,
  settings: ENTITY_TYPES.SETTING,
};

// 规范化一条记录，确保带有同步必需字段（幂等）
function normalizeRecord(rec, entityType) {
  const out = Object.assign({}, rec || {});
  out.entityType = entityType;
  if (!out.id) out.id = '';
  out.deleted = !!out.deleted;
  if (out.updatedAt == null) out.updatedAt = out.createdAt || 0;
  return out;
}

// 校验一批 change 的合法性，返回 { ok, error }
function validateChanges(changes) {
  if (!Array.isArray(changes)) return { ok: false, error: 'changes 必须为数组' };
  if (changes.length > 1000) return { ok: false, error: '单次推送 change 数量超限（最多 1000 条）' };
  const validTypes = Object.keys(ENTITY_TYPES).map(function (k) { return ENTITY_TYPES[k]; });
  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    if (!ch || typeof ch !== 'object') return { ok: false, error: '第 ' + i + ' 条 change 非法' };
    if (!ch.id || typeof ch.id !== 'string') return { ok: false, error: '第 ' + i + ' 条 change 缺少 id' };
    if (ch.id.length > 128) return { ok: false, error: '第 ' + i + ' 条 change 的 id 过长' };
    if (!ch.entityType || typeof ch.entityType !== 'string') return { ok: false, error: '第 ' + i + ' 条 change 缺少 entityType' };
    if (validTypes.indexOf(ch.entityType) === -1) return { ok: false, error: '第 ' + i + ' 条 change 的 entityType 非法' };
  }
  return { ok: true };
}

module.exports = {
  ENTITY_FIELDS: ENTITY_FIELDS,
  normalizeRecord: normalizeRecord,
  validateChanges: validateChanges,
};
