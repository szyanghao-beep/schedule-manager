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
  var QUADRANT_ORDER = ['q1', 'q2', 'q3', 'q4'];
  var PRIORITY_ORDER = { high: 2, medium: 1, low: 0 };

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
    if (input.estimatedMinutes != null) {
      var em = Number(input.estimatedMinutes);
      if (!isFinite(em) || em <= 0 || Math.floor(em) !== em || em > 1440) {
        errors.push('预估耗时需为 1~1440 的整数分钟');
      }
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

  // ---- 穿透明细（统计页下钻）----
  // 按 type 收集底层条目，口径与 calcStats / calcQuadrantStats 严格一致：
  //   today/week/month -> 时间窗内（事件按 startTime，待办按 deadline）
  //   overdue          -> displayStatus === overdue
  //   completed        -> status === done
  //   q1..q4           -> 未完成且 calcQuadrant === type 的待办
  // 返回 [{ kind: 'event'|'todo', item }]，已排序。
  function calcDrillItems(events, todos, type, now, urgentThresholdMs) {
    if (now == null) now = Date.now();
    if (urgentThresholdMs == null) urgentThresholdMs = 24 * 3600 * 1000;
    var out = [];

    (events || []).forEach(function (e) {
      if (type === 'overdue') {
        if (displayStatus(e, now) === STATUS.OVERDUE) out.push({ kind: 'event', item: e, time: e.startTime });
      } else if (type === 'completed') {
        if (e.status === STATUS.DONE) out.push({ kind: 'event', item: e, time: e.startTime });
      } else if (type === 'today' || type === 'week' || type === 'month') {
        if (e.startTime != null && inRange(e.startTime, type, now)) out.push({ kind: 'event', item: e, time: e.startTime });
      }
    });

    (todos || []).forEach(function (t) {
      if (type === 'overdue') {
        if (displayStatus(t, now) === STATUS.OVERDUE) out.push({ kind: 'todo', item: t, time: t.deadline });
      } else if (type === 'completed') {
        if (t.status === STATUS.DONE) out.push({ kind: 'todo', item: t, time: t.deadline });
      } else if (type === 'q1' || type === 'q2' || type === 'q3' || type === 'q4') {
        if (t.status !== STATUS.DONE && calcQuadrant(t, now, urgentThresholdMs) === type) out.push({ kind: 'todo', item: t, time: t.deadline });
      } else if (type === 'today' || type === 'week' || type === 'month') {
        if (t.deadline != null && inRange(t.deadline, type, now)) out.push({ kind: 'todo', item: t, time: t.deadline });
      }
    });

    out.sort(function (a, b) {
      if (type === 'completed' || type === 'overdue') return (b.time || 0) - (a.time || 0);
      if (type === 'today' || type === 'week' || type === 'month') {
        var ad = a.item.status === STATUS.DONE, bd = b.item.status === STATUS.DONE;
        if (ad !== bd) return ad ? 1 : -1; // 未完成在前
      }
      return (a.time || Number.MAX_SAFE_INTEGER) - (b.time || Number.MAX_SAFE_INTEGER);
    });

    return out.map(function (x) { return { kind: x.kind, item: x.item }; });
  }

  // 时间窗判断：[start, end)，与 calcStats 的 bucket 口径一致
  function inRange(ts, type, now) {
    var day = startOfDay(now);
    if (type === 'today') return ts >= day && ts < addDays(day, 1);
    var week = startOfWeek(now);
    if (type === 'week') return ts >= week && ts < addDays(week, 7);
    var monthStart = startOfMonth(now);
    var d = new Date(monthStart);
    var nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return ts >= monthStart && ts < nextMonth;
  }

  // ---- 搜索 ----
  // 全文搜索日程与待办：匹配标题 / 描述 / 分类名，多关键词 AND、大小写不敏感。
  // 返回 { events, todos }，各自按时间升序（无时间的排最后）；空查询返回空结果。
  // 不修改入参数组（filter 产生新数组后排序）。
  function searchItems(query, events, todos) {
    var out = { events: [], todos: [] };
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return out;
    var terms = q.split(/\s+/).filter(function (t) { return t.length > 0; });
    if (!terms.length) return out;

    function matches(item) {
      var hay = [item.title, item.description, item.categoryName]
        .filter(function (x) { return x != null; })
        .join('\n')
        .toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    }

    function byTimeAsc(a, b, key) {
      var ta = a[key], tb = b[key];
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    }

    (events || []).filter(matches).sort(function (a, b) { return byTimeAsc(a, b, 'startTime'); })
      .forEach(function (e) { out.events.push(e); });
    (todos || []).filter(matches).sort(function (a, b) { return byTimeAsc(a, b, 'deadline'); })
      .forEach(function (t) { out.todos.push(t); });
    return out;
  }

  // ---- 统计趋势合并（stats.js 使用）----
  // 把主进程历史快照与「今天」实时值合并为曲线数据：
  //   - 历史截取最近 30 条；todayEntry 为 { date, q1..q4, total }
  //   - 历史最后一条是今天 → 覆盖为实时值；否则追加今天
  //   - 不伪造缺失日期（应用未运行的日期没有快照，曲线如实空缺）
  function mergeTrend(history, todayEntry) {
    var list = (history || []).slice(-30);
    var merged = list.slice();
    if (todayEntry && todayEntry.date) {
      var last = merged[merged.length - 1];
      if (last && last.date === todayEntry.date) merged[merged.length - 1] = todayEntry;
      else merged.push(todayEntry);
    }
    return merged.slice(-30);
  }

  // ---- 时间块排程（Time Blocking）----
  // 把已合并的区间按起点排序合并重叠段
  function mergeIntervals(arr) {
    if (!arr.length) return [];
    var sorted = arr.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [sorted[0].slice()];
    for (var i = 1; i < sorted.length; i++) {
      var cur = sorted[i];
      var last = out[out.length - 1];
      if (cur[0] <= last[1]) {
        if (cur[1] > last[1]) last[1] = cur[1];
      } else {
        out.push(cur.slice());
      }
    }
    return out;
  }

  // 区间 [s,e) 是否与任一已占用区间重叠（端点相接不视为重叠，允许块紧邻）
  function overlapsInterval(s, e, intervals) {
    for (var i = 0; i < intervals.length; i++) {
      var it = intervals[i];
      if (s < it[1] && it[0] < e) return true;
    }
    return false;
  }

  // 在 [from, workEnd] 内按 slot 粒度找到第一个能容纳 dur 的空闲槽位；找不到返回 null
  function findFreeSlot(from, dur, occupied, workEnd, slotMs) {
    var t = Math.ceil(from / slotMs) * slotMs;
    var maxStart = workEnd - dur;
    while (t <= maxStart) {
      if (!overlapsInterval(t, t + dur, occupied)) return t;
      t += slotMs;
    }
    return null;
  }

  // 由待办生成一个时间块 { start, end, minutes }；无预估耗时回退 defaultMinutes（默认 60）
  function blockFromTodo(todo, start, defaultMinutes) {
    var min = (todo && todo.estimatedMinutes) ? Number(todo.estimatedMinutes) : 0;
    if (!(min > 0)) min = defaultMinutes || 60;
    return { start: start, end: start + min * 60000, minutes: min };
  }

  // 自动排程：把待办按「截止时间 → 四象限 → 优先级」贪心填入当天工作时段内的空闲槽位。
  // 输入：todos（待排程待办，含 estimatedMinutes>0 且未完成）、events（当天已占用的日程）、opts。
  // opts：
  //   now（默认 Date.now()）、dayStart/dayEnd（默认当天）、
  //   workStart/workEnd（默认 dayStart + workStartHour/workEndHour，缺省 9/18）、
  //   slotMinutes（默认 30）、bufferMinutes（默认 0）、urgentThresholdMs（默认 24h）。
  // 返回 { blocks:[{todoId,start,end}], unscheduled:[todoId], workStart, workEnd }。
  function autoSchedule(todos, events, opts) {
    opts = opts || {};
    var now = opts.now != null ? opts.now : Date.now();
    var dayStart = opts.dayStart != null ? opts.dayStart : startOfDay(now);
    var dayEnd = opts.dayEnd != null ? opts.dayEnd : addDays(dayStart, 1);
    var workStart = opts.workStart != null ? opts.workStart : dayStart + (opts.workStartHour != null ? opts.workStartHour : 9) * 3600000;
    var workEnd = opts.workEnd != null ? opts.workEnd : dayStart + (opts.workEndHour != null ? opts.workEndHour : 18) * 3600000;
    var slotMs = Math.max(1, opts.slotMinutes != null ? opts.slotMinutes : 30) * 60000;
    var bufferMs = Math.max(0, opts.bufferMinutes != null ? opts.bufferMinutes : 0) * 60000;
    var threshold = opts.urgentThresholdMs != null ? opts.urgentThresholdMs : 24 * 3600000;

    // 已占用区间：全天事件占整天，时段事件取与工作时段交集
    var occupied = [];
    (events || []).forEach(function (e) {
      if (e.allDay) { occupied.push([dayStart, dayEnd]); return; }
      if (e.startTime == null || e.endTime == null) return;
      var s = Math.max(workStart, e.startTime);
      var en = Math.min(workEnd, e.endTime);
      if (en > s) occupied.push([s, en]);
    });
    occupied = mergeIntervals(occupied);

    // 候选：未完成且 estimatedMinutes > 0 的待办
    var candidates = (todos || []).filter(function (t) {
      return t && t.status !== 'done' && Number(t.estimatedMinutes) > 0;
    });

    // 排序：有截止时间在前（按截止升序），随后按四象限优先级，再按优先级高者先
    candidates.sort(function (a, b) {
      var ad = a.deadline == null ? 1 : 0;
      var bd = b.deadline == null ? 1 : 0;
      if (ad !== bd) return ad - bd;
      if (a.deadline != null && b.deadline != null && a.deadline !== b.deadline) return a.deadline - b.deadline;
      var aqi = QUADRANT_ORDER.indexOf(calcQuadrant(a, now, threshold));
      var bqi = QUADRANT_ORDER.indexOf(calcQuadrant(b, now, threshold));
      if (aqi !== bqi) return aqi - bqi;
      var ap = PRIORITY_ORDER[a.priority] != null ? PRIORITY_ORDER[a.priority] : 1;
      var bp = PRIORITY_ORDER[b.priority] != null ? PRIORITY_ORDER[b.priority] : 1;
      return bp - ap;
    });

    var blocks = [];
    var unscheduled = [];
    var from = Math.max(workStart, now);
    candidates.forEach(function (t) {
      var dur = Number(t.estimatedMinutes) * 60000;
      if (dur > workEnd - workStart) { unscheduled.push(t.id); return; }
      var start = findFreeSlot(from, dur, occupied, workEnd, slotMs);
      if (start == null) { unscheduled.push(t.id); return; }
      var end = start + dur;
      blocks.push({ todoId: t.id, start: start, end: end });
      occupied = mergeIntervals(occupied.concat([[start, end]]));
      from = end + bufferMs;
    });

    return { blocks: blocks, unscheduled: unscheduled, workStart: workStart, workEnd: workEnd };
  }

  // ---- 周回顾统计（GTD weekly review）----
  // 汇总本周：完成数 / 新增数 / 逾期数 / 收件箱（无截止时间）积压 / 缺预估耗时数 / 四象限分布。
  function calcWeeklyReview(todos, now) {
    if (now == null) now = Date.now();
    var weekStart = startOfWeek(now);
    var threshold = 24 * 3600000;
    var summary = {
      doneWeek: 0, createdWeek: 0, overdue: 0, inbox: 0, noEstimate: 0,
      byQuadrant: { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 },
    };
    (todos || []).forEach(function (t) {
      if (t.createdAt != null && t.createdAt >= weekStart && t.createdAt <= now) summary.createdWeek++;
      if (t.status === 'done') {
        if (t.completedAt != null && t.completedAt >= weekStart && t.completedAt <= now) summary.doneWeek++;
        return;
      }
      if (displayStatus(t, now) === STATUS.OVERDUE) summary.overdue++;
      if (t.deadline == null) summary.inbox++;
      if (!(Number(t.estimatedMinutes) > 0)) summary.noEstimate++;
      var q = calcQuadrant(t, now, threshold);
      summary.byQuadrant[q]++;
      summary.byQuadrant.total++;
    });
    return summary;
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
    calcDrillItems: calcDrillItems,
    searchItems: searchItems,
    mergeTrend: mergeTrend,
    autoSchedule: autoSchedule,
    blockFromTodo: blockFromTodo,
    calcWeeklyReview: calcWeeklyReview,
  };
}));
