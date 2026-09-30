/*
 * links.js — 「收件箱 → 待办 → 日程」之间的关联与流转（纯函数，三端共用）
 *
 * 为什么单独成模块：
 *   这三者过去各管各的——待办「排到日程」后写了 scheduledEventId 就没人再读；
 *   日程被删掉后待办上留下悬空指针；待办完成了日程还挂着「未开始」；
 *   从手机上收集来的条目在收件箱里看不出是从哪来的。
 *   把「谁关联谁、关联还成立吗、状态该怎么联动」收敛成可单测的纯函数，
 *   避免渲染层各处再手写一遍 indexOf 逻辑。
 *
 * UMD：Node(CommonJS) 下 require（主进程/手机端/测试），浏览器下挂载到 window.LinkUtil。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LinkUtil = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function alive(list) {
    return (list || []).filter(function (x) { return x && !x.deleted; });
  }

  // 某待办关联的日程；关联不存在（日程已删）时返回 null
  function linkedEvent(todo, events) {
    if (!todo || !todo.scheduledEventId) return null;
    const hit = alive(events).find(function (e) { return e.id === todo.scheduledEventId; });
    return hit || null;
  }

  // eventId -> todo 反查表（日程侧显示「来自待办」用）
  function eventToTodoIndex(todos) {
    const out = {};
    alive(todos).forEach(function (t) {
      if (t.scheduledEventId) out[t.scheduledEventId] = t;
    });
    return out;
  }

  // 悬空关联：待办指向的日程已经不存在了。
  // 返回这些待办，调用方应把它们的 scheduledEventId 清空，
  // 否则待办会一直显示「已排到日程」但实际跳不过去。
  function danglingTodos(todos, events) {
    const ids = {};
    alive(events).forEach(function (e) { ids[e.id] = true; });
    return alive(todos).filter(function (t) {
      return !!t.scheduledEventId && !ids[t.scheduledEventId];
    });
  }

  // 待办完成状态变化时，关联日程应同步的字段；无需同步时返回 null。
  // 只动 status/completedAt，不碰日程的时间与标题（用户可能已单独调整过）。
  function statusSyncPatch(todo, events, done) {
    const ev = linkedEvent(todo, events);
    if (!ev) return null;
    const isDone = ev.status === 'done';
    if (done === isDone) return null; // 已经一致，不必写库（避免无谓的同步推送）
    return {
      eventId: ev.id,
      patch: done
        ? { status: 'done', completedAt: Date.now() }
        : { status: 'pending', completedAt: null },
    };
  }

  // 收件箱条目来源标签：手机端「收集」直传进来的会带 source
  function sourceLabel(item) {
    if (!item) return '';
    if (item.source === 'mobile-inbox') return '手机收集';
    return '';
  }

  // 收件箱待整理集合：未完成、无截止时间。
  // 与 inbox.js 的判定保持一致（这里收口，避免两处定义漂移）。
  function isInboxItem(todo) {
    return !!todo && !todo.deleted && todo.status !== 'done' && todo.deadline == null;
  }

  function inboxTodos(todos) {
    return alive(todos).filter(isInboxItem);
  }

  return {
    linkedEvent: linkedEvent,
    eventToTodoIndex: eventToTodoIndex,
    danglingTodos: danglingTodos,
    statusSyncPatch: statusSyncPatch,
    sourceLabel: sourceLabel,
    isInboxItem: isInboxItem,
    inboxTodos: inboxTodos,
  };
}));
