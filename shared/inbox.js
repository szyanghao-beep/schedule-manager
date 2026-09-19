/*
 * inbox.js — 收件箱收集条目的规范化与合并（共享纯函数）
 *
 * 场景：手机端「收集」页离线随手记的待办/想法，回到电脑旁手动直传；
 * 电脑端收到后由本模块合并进 todos —— 关键语义：
 *   deadline = null 且未完成 —— 正好等于电脑端「收件箱（未整理）」的定义，
 *   因此条目会直接出现在收件箱等待整理，无需额外状态字段。
 *
 * 幂等：按条目 id 去重，手机端重复点「同步」不会产生重复条目。
 * 纯函数、无副作用，主进程与测试共用。
 */

'use strict';

// 单条收集条目 -> 待办记录；非法条目返回 null
function normalizeInboxItem(it, now) {
  if (!it || typeof it !== 'object') return null;
  const title = it.title == null ? '' : String(it.title).trim();
  if (!it.id || !title) return null;

  const ts = now || Date.now();
  return {
    id: String(it.id),
    title: title.slice(0, 500),
    description: it.description ? String(it.description).slice(0, 2000) : '',
    deadline: null,          // 无截止时间 = 未整理 → 收件箱
    status: 'pending',
    priority: 'medium',
    categoryId: '',
    categoryName: '未分类',
    categoryColor: '#8a8f98',
    importance: 'important',
    repeat: { type: 'none', interval: 1, endDate: null },
    remindBefore: 0,
    completedAt: null,
    createdAt: Number(it.createdAt) || ts,
    updatedAt: ts,
    localModifiedAt: ts,     // 视为本地修改（若启用双向同步会推给服务器）
    source: 'mobile-inbox',  // 来源标记：手机收集
  };
}

// 把条目合并进现有 todos（不改动入参；按 id 去重）
function mergeInboxItems(todos, items, now) {
  const list = Array.isArray(todos) ? todos.slice() : [];
  const existing = new Set(list.map(function (t) { return t.id; }));
  let accepted = 0, duplicated = 0, invalid = 0;

  (items || []).forEach(function (it) {
    const rec = normalizeInboxItem(it, now);
    if (!rec) { invalid++; return; }
    if (existing.has(rec.id)) { duplicated++; return; } // 幂等
    list.push(rec);
    existing.add(rec.id);
    accepted++;
  });

  return { todos: list, accepted: accepted, duplicated: duplicated, invalid: invalid };
}

module.exports = { normalizeInboxItem, mergeInboxItems };
