/*
 * utils.js — 纯函数工具集（ID、日期、状态派生、校验、重复展开、统计）
 * UMD 包装：Node(CommonJS) 下 require 使用，浏览器下挂载到 window.Utils。
 * 该文件同时被主进程、渲染进程、单元测试复用，逻辑保持纯函数、无副作用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Utils = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = { PENDING: 'pending', DOING: 'doing', DONE: 'done', OVERDUE: 'overdue' };
  var REPEAT_TYPE = { NONE: 'none', DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', CUSTOM: 'custom' };
  var IMPORTANCE = { IMPORTANT: 'important', NOT_IMPORTANT: 'not_important' };
  var QUADRANT = { Q1: 'q1', Q2: 'q2', Q3: 'q3', Q4: 'q4' };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // 生成唯一ID
  function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---- 日期工具（本地时区） ----
  function toDateStr(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function toTimeStr(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function toDateTimeStr(ts) { return toDateStr(ts) + ' ' + toTimeStr(ts); }
  // 'YYYY-MM-DD' + 'HH:mm' -> 时间戳
  function parseDateTime(dateStr, timeStr) {
    return new Date(dateStr + 'T' + (timeStr || '00:00')).getTime();
  }
  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function startOfWeek(ts) {
    var d = new Date(startOfDay(ts));
    var day = d.getDay(); // 0=周日
    d.setDate(d.getDate() - ((day + 6) % 7)); // 周一为一周开始
    return d.getTime();
  }
  function startOfMonth(ts) {
    var d = new Date(ts);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function addDays(ts, n) {
    var d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }
  function isSameDay(a, b) { return toDateStr(a) === toDateStr(b); }

  // 状态派生：已过期是派生状态不落库；完成优先于过期
  function displayStatus(item, now) {
    if (now == null) now = Date.now();
    if (item.status === STATUS.DONE) return STATUS.DONE;
    var end = item.endTime != null ? item.endTime : item.deadline;
    if (end != null && now > end) return STATUS.OVERDUE;
    return item.status === STATUS.DOING ? STATUS.DOING : STATUS.PENDING;
  }

  // ---- 校验 ----
  function validateEvent(input) {
    var errors = [];
    if (!input.title || !String(input.title).trim()) errors.push('标题不能为空');
    if (!input.allDay) {
      if (input.startTime == null || input.endTime == null) errors.push('请填写开始与结束时间');
      else if (input.endTime <= input.startTime) errors.push('结束时间必须晚于开始时间');
    }
    if (input.repeat && input.repeat.type && input.repeat.type !== REPEAT_TYPE.NONE) {
      if (!(input.repeat.type in REPEAT_TYPE)) errors.push('重复规则无效');
      if (input.repeat.type === REPEAT_TYPE.CUSTOM && (!input.repeat.interval || input.repeat.interval < 1)) {
        errors.push('自定义周期需为正整数');
      }
      if (input.repeat.endDate && input.repeat.endDate < input.startTime) errors.push('重复结束时间需晚于开始时间');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function validateTodo(input) {
    var errors = [];
    if (!input.title || !String(input.title).trim()) errors.push('标题不能为空');
    if (input.repeat && input.repeat.type === REPEAT_TYPE.CUSTOM && (!input.repeat.interval || input.repeat.interval < 1)) {
      errors.push('自定义周期需为正整数');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  // ---- 重复展开 ----
  // 基于基准时间与重复次数，直接计算第 count 次重复的时间点（避免逐次累加导致的月末信息丢失）
  function addRepeat(base, type, interval, count) {
    interval = Math.max(1, interval || 1);
    var d = new Date(base);
    switch (type) {
      case REPEAT_TYPE.DAILY:
      case REPEAT_TYPE.CUSTOM:
        d.setDate(d.getDate() + interval * count);
        break;
      case REPEAT_TYPE.WEEKLY:
        d.setDate(d.getDate() + 7 * interval * count);
        break;
      case REPEAT_TYPE.MONTHLY: {
        var day = d.getDate(); // 基准日（如 31），每期都以此为准
        d.setDate(1);
        d.setMonth(d.getMonth() + interval * count);
        var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay)); // 钳制到目标月最后一天
        break;
      }
      default:
        break;
    }
    return d.getTime();
  }

  // 展开重复实例：返回 [{ key, startTime, endTime }]，key 用于单次编辑与提醒去重。
  // opts.from / opts.to 限定时间窗 [from, to)；opts.limit 为「窗内实例」处理上限（含被 exception 跳过的）。
  // 这样很久以前开始的重复系列也能直接定位到近期实例，而不会被 limit 从起点截断。
  function expandOccurrences(item, opts) {
    opts = opts || {};
    var type = (item.repeat && item.repeat.type) || REPEAT_TYPE.NONE;
    var interval = (item.repeat && item.repeat.interval) || 1;
    var endDate = (item.repeat && item.repeat.endDate) ? startOfDay(item.repeat.endDate) : null;
    var from = opts.from;            // 可选：跳过 startTime < from 的实例
    var to = opts.to;                // 可选：startTime >= to 即停止
    var limit = opts.limit || 500;   // 窗内实例处理上限（安全阀）
    var maxIter = opts.maxIter || 100000; // 迭代次数安全阀，防止异常情况死循环
    var dur = (item.endTime || item.startTime) - item.startTime;
    var out = [];
    var count = 0;      // 实际迭代次数
    var produced = 0;   // 已处理的窗内实例数（含 exception 跳过的）
    while (count < maxIter && produced < limit) {
      var start = count === 0 ? item.startTime : addRepeat(item.startTime, type, interval, count);
      if (endDate != null && startOfDay(start) > endDate) break;
      if (to != null && start >= to) break;
      if (from == null || start >= from) {
        produced++;
        var key = item.id + '@' + start;
        // exceptions 记录「仅本次」被覆盖/删除的实例，展开时跳过
        if (!(item.exceptions && item.exceptions[key])) {
          out.push({ key: key, startTime: start, endTime: start + dur });
        }
      }
      count++;
      if (type === REPEAT_TYPE.NONE) break;
    }
    return out;
  }

  // ---- 统计 ----
  function calcStats(events, todos, now) {
    if (now == null) now = Date.now();
    var todayStart = startOfDay(now);
    var weekStart = startOfWeek(now);
    var monthStart = startOfMonth(now);
    var monthD = new Date(monthStart);
    var nextMonth = new Date(monthD.getFullYear(), monthD.getMonth() + 1, 1).getTime();

    var all = [];
    (events || []).forEach(function (e) {
      all.push({ done: e.status === STATUS.DONE, time: e.startTime, overdue: displayStatus(e, now) === STATUS.OVERDUE });
    });
    (todos || []).forEach(function (t) {
      all.push({ done: t.status === STATUS.DONE, time: t.deadline, overdue: displayStatus(t, now) === STATUS.OVERDUE });
    });

    function bucket(start, end) {
      var total = 0, done = 0;
      all.forEach(function (it) {
        if (it.time == null) return;
        if (it.time >= start && it.time < end) { total++; if (it.done) done++; }
      });
      return { total: total, done: done, rate: total ? Math.round(done / total * 100) : 0 };
    }

    return {
      today: bucket(todayStart, addDays(todayStart, 1)),
      week: bucket(weekStart, addDays(weekStart, 7)),
      month: bucket(monthStart, nextMonth),
      overdue: all.filter(function (it) { return it.overdue; }).length,
      completedTotal: all.filter(function (it) { return it.done; }).length,
    };
  }

  // ---- 四象限（艾森豪威尔矩阵）----
  // 象限 = 重要性（手动）× 紧急性（由截止时间推导）。
  // 无截止时间视为不紧急；已逾期或临近截止（now >= deadline - 阈值）视为紧急；importance 缺省视为重要。
  function calcQuadrant(item, now, urgentThresholdMs) {
    if (now == null) now = Date.now();
    if (urgentThresholdMs == null) urgentThresholdMs = 24 * 3600 * 1000;
    var important = item.importance !== IMPORTANCE.NOT_IMPORTANT;
    var urgent = item.deadline != null && now >= item.deadline - urgentThresholdMs;
    if (important && urgent) return QUADRANT.Q1;
    if (important && !urgent) return QUADRANT.Q2;
    if (!important && urgent) return QUADRANT.Q3;
    return QUADRANT.Q4;
  }

  // 四象限分布统计（仅未完成待办）
  function calcQuadrantStats(todos, now, urgentThresholdMs) {
    var counts = { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 };
    (todos || []).forEach(function (t) {
      if (t.status === 'done') return;
      counts[calcQuadrant(t, now, urgentThresholdMs)]++;
      counts.total++;
    });
    return counts;
  }

  return {
    STATUS: STATUS,
    REPEAT_TYPE: REPEAT_TYPE,
    IMPORTANCE: IMPORTANCE,
    QUADRANT: QUADRANT,
    genId: genId,
    pad: pad,
    toDateStr: toDateStr,
    toTimeStr: toTimeStr,
    toDateTimeStr: toDateTimeStr,
    parseDateTime: parseDateTime,
    startOfDay: startOfDay,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    addDays: addDays,
    isSameDay: isSameDay,
    displayStatus: displayStatus,
    validateEvent: validateEvent,
    validateTodo: validateTodo,
    expandOccurrences: expandOccurrences,
    calcStats: calcStats,
    calcQuadrant: calcQuadrant,
    calcQuadrantStats: calcQuadrantStats,
  };
}));
