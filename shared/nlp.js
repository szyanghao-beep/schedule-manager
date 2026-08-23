/*
 * nlp.js — 自然语言快速捕捉的规则解析器（C1 兜底层）。
 * 纯函数、离线、无副作用，三端复用（UMD：Node require / 浏览器 window.Nlp）。
 *
 * 输入一段中文自然语言，抽取结构化字段：
 *   title / kind / deadline / startTime / endTime / allDay /
 *   priority / importance / categoryName / remindBefore / estimatedMinutes / confidence
 *
 * 只做「能确定」的规则解析，拿不准的留给上层（LLM 兜底 / 用户确认）。
 * 所有时间基于本地时区；opts.now 供测试固定「现在」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Nlp = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

  // 时间段 -> 上下午（中午单独处理）
  const PERIOD_MODE = {
    凌晨: 'am', 早上: 'am', 早晨: 'am', 上午: 'am',
    中午: 'noon',
    下午: 'pm', 傍晚: 'pm', 晚上: 'pm', 夜里: 'pm', 晚: 'pm', 夜: 'pm',
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function endOfDay(ts) { return startOfDay(ts) + 24 * 3600 * 1000 - 1; }
  function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
  function startOfWeekMonday(ts) {
    const d = new Date(startOfDay(ts));
    const day = (d.getDay() + 6) % 7; // 周一=0
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  function mkDate(y, m, d) {
    if (!isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // 如 2/30 这类无效日期
    return dt.getTime();
  }
  // 12 小时制 -> 24 小时
  function to24(hour, mode) {
    let h = hour;
    if (mode === 'pm') { if (h < 12) h += 12; }
    else if (mode === 'am') { if (h === 12) h = 0; }
    else if (mode === 'noon') { h = 12; }
    return h;
  }

  // 切掉匹配片段
  function cut(s, m) { return (s.slice(0, m.index) + s.slice(m.index + m[0].length)); }

  // ---------- 优先级 ----------
  function findPriority(s) {
    const map = [
      { re: /(特急|加急|紧急|很急|高优先级|高优先)/, value: 'high' },
      { re: /(低优先级|低优先|不急)/, value: 'low' },
    ];
    for (let i = 0; i < map.length; i++) {
      const m = map[i].re.exec(s);
      if (m) return { value: map[i].value, m: m };
    }
    return null;
  }

  // ---------- 重要性 ----------
  function findImportance(s) {
    const m = /(不重要|重要)/.exec(s);
    if (!m) return null;
    return { value: m[1] === '不重要' ? 'not_important' : 'important', m: m };
  }

  // ---------- 提醒提前量 ----------
  function findReminder(s) {
    const patterns = [
      { re: /提前\s*(\d+)\s*(分钟|小时|天)\s*提醒/, unit: { 分钟: 1, 小时: 60, 天: 1440 } },
      { re: /提前\s*半\s*小时\s*提醒/, fixed: 30 },
      { re: /(\d+)\s*(分钟|小时|天)\s*前\s*提醒/, unit: { 分钟: 1, 小时: 60, 天: 1440 } },
    ];
    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];
      const m = p.re.exec(s);
      if (!m) continue;
      if (p.fixed) return { minutes: p.fixed, m: m };
      return { minutes: Number(m[1]) * p.unit[m[2]], m: m };
    }
    return null;
  }

  // ---------- 时长 / 预估耗时 ----------
  // estimate=true：明确是待办「预估耗时」（预计/需要/耗时 前缀），不构成事件；
  // estimate=false：裸时长（X小时/X分钟），有具体时间时构成事件块时长。
  function findDuration(s) {
    const UNIT = { 分钟: 1, 小时: 60, 天: 1440, 半小时: 30, 个半小时: 30 };

    const est = /(?:预计|需要|耗时|大概|大约|要花)\s*(\d+)\s*(分钟|小时|天|个半小时|半小时)/.exec(s);
    if (est) return { minutes: Number(est[1]) * UNIT[est[2]], estimate: true, m: est };

    let m = /(\d+)\s*个半\s*小时/.exec(s);
    if (m) return { minutes: Number(m[1]) * 90, estimate: false, m: m };
    m = /(\d+)\s*(小时|分钟|天)/.exec(s);
    if (m) return { minutes: Number(m[1]) * UNIT[m[2]], estimate: false, m: m };
    m = /半小时/.exec(s);
    if (m) return { minutes: 30, estimate: false, m: m };
    return null;
  }

  // ---------- 分类（#标签） ----------
  function findCategory(s, categories) {
    const m = /#([一-龥A-Za-z0-9]+)/.exec(s);
    if (!m) return null;
    if (categories && categories.length && categories.indexOf(m[1]) < 0) return null;
    return { name: m[1], m: m };
  }

  // ---------- 日期 ----------
  const DATE_PATTERNS = [
    { re: /大后天/, fn: function (m, now) { return addDays(startOfDay(now), 3); } },
    { re: /后天/, fn: function (m, now) { return addDays(startOfDay(now), 2); } },
    { re: /明天|明日/, fn: function (m, now) { return addDays(startOfDay(now), 1); } },
    { re: /今天|今日/, fn: function (m, now) { return startOfDay(now); } },
    {
      re: /下(?:周|星期|礼拜)([一二三四五六日天])/,
      fn: function (m, now) {
        const offset = (WEEKDAYS[m[1]] + 6) % 7; // 周一=0
        return addDays(startOfWeekMonday(now), 7 + offset);
      },
    },
    {
      re: /(?:周|星期|礼拜)([一二三四五六日天])/,
      fn: function (m, now) {
        const cur = new Date(now).getDay();
        const diff = (WEEKDAYS[m[1]] - cur + 7) % 7; // 下一次出现（含今天）
        return addDays(startOfDay(now), diff);
      },
    },
    {
      re: /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/,
      fn: function (m) { return mkDate(Number(m[1]), Number(m[2]), Number(m[3])); },
    },
    {
      re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/,
      fn: function (m, now) {
        let ts = mkDate(new Date(now).getFullYear(), Number(m[1]), Number(m[2]));
        if (ts == null) return null;
        if (ts < startOfDay(now)) ts = mkDate(new Date(now).getFullYear() + 1, Number(m[1]), Number(m[2]));
        return ts;
      },
    },
    {
      re: /(\d{1,2})\s*[日号]/,
      fn: function (m, now) {
        const d0 = new Date(now);
        let ts = mkDate(d0.getFullYear(), d0.getMonth() + 1, Number(m[1]));
        if (ts == null) return null;
        if (ts < startOfDay(now)) ts = mkDate(d0.getFullYear(), d0.getMonth() + 2, Number(m[1]));
        return ts;
      },
    },
  ];

  function matchDate(s, now) {
    let best = null;
    for (let i = 0; i < DATE_PATTERNS.length; i++) {
      const p = DATE_PATTERNS[i];
      p.re.lastIndex = 0;
      const m = p.re.exec(s);
      if (!m) continue;
      const ts = p.fn(m, now);
      if (ts == null) continue;
      if (!best || m.index < best.index) best = { ts: ts, m: m };
    }
    return best;
  }

  // ---------- 时间 ----------
  const TIME_RE = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚|夜)?\s*(\d{1,2})\s*[:：点時时]\s*(半|一刻|三刻|(\d{1,2})\s*分?)?/g;

  function matchTime(s) {
    let best = null;
    TIME_RE.lastIndex = 0;
    let m;
    while ((m = TIME_RE.exec(s)) !== null) {
      if (m[0].length === 0) { TIME_RE.lastIndex++; continue; } // 防御空匹配
      const hour = Number(m[2]);
      if (hour > 23) continue;
      let minutes = 0;
      if (m[3] === '半') minutes = 30;
      else if (m[3] === '一刻') minutes = 15;
      else if (m[3] === '三刻') minutes = 45;
      else if (m[4]) minutes = Number(m[4]);
      if (minutes > 59) continue;
      const mode = m[1] ? PERIOD_MODE[m[1]] : null;
      const h24 = mode ? to24(hour, mode) : hour; // 无时间段：按 24 小时原样
      if (!best || m.index < best.index) best = { minutes: h24 * 60 + minutes, m: m };
    }
    return best;
  }

  // ---------- 标题清洗 ----------
  function cleanTitle(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,，。;；:：!！?？.。、·…—-]+|[\s,，。;；:：!！?？.。、·…—-]+$/g, '')
      .trim();
  }

  function computeConfidence(r) {
    let c = 0;
    if (r.title) c += 0.3;
    if (r.deadline != null || r.startTime != null) c += 0.25;
    if (r.priority) c += 0.1;
    if (r.importance) c += 0.1;
    if (r.categoryName) c += 0.1;
    if (r.remindBefore != null) c += 0.05;
    if (r.estimatedMinutes != null) c += 0.1;
    return Math.min(1, Math.round(c * 100) / 100);
  }

  function parse(text, opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : Date.now();
    const categories = opts.categories || [];
    const raw = String(text == null ? '' : text).trim();

    const result = {
      raw: raw,
      title: '',
      kind: 'todo',
      deadline: null,
      startTime: null,
      endTime: null,
      allDay: false,
      priority: null,
      importance: null,
      categoryName: null,
      remindBefore: null,
      estimatedMinutes: null,
      confidence: 0,
    };
    if (!raw) return result;

    let s = raw;

    // 顺序抽取，抽到即从原文切掉，避免「提前30分钟提醒」被时长规则重复命中
    const p = findPriority(s);
    if (p) { result.priority = p.value; s = cut(s, p.m); }

    const im = findImportance(s);
    if (im) { result.importance = im.value; s = cut(s, im.m); }

    const rem = findReminder(s);
    if (rem) { result.remindBefore = rem.minutes; s = cut(s, rem.m); }

    const dur = findDuration(s);
    if (dur) { s = cut(s, dur.m); }

    const cat = findCategory(s, categories);
    if (cat) { result.categoryName = cat.name; s = cut(s, cat.m); }

    // 日期 + 时间
    let dateTs = null, timeMinutes = null;
    const date = matchDate(s, now);
    if (date) { dateTs = date.ts; s = cut(s, date.m); }
    const time = matchTime(s);
    if (time) { timeMinutes = time.minutes; s = cut(s, time.m); }

    // 组装时间字段
    if (dateTs != null || timeMinutes != null) {
      let ts = null;
      if (dateTs != null && timeMinutes != null) ts = dateTs + timeMinutes * 60000;
      else if (dateTs != null) ts = dateTs;
      else ts = startOfDay(now) + timeMinutes * 60000;

      // 事件判定：有具体时间 + 裸时长（非「预计」）→ 一个时间块
      const hasDuration = dur && dur.minutes > 0 && !dur.estimate;
      result.kind = (timeMinutes != null && hasDuration) ? 'event' : 'todo';

      if (result.kind === 'event') {
        result.startTime = ts;
        result.endTime = hasDuration ? ts + dur.minutes * 60000 : null;
        result.allDay = timeMinutes == null;
      } else {
        // 待办：只有日期没有时间 -> 截止到当天结束
        result.deadline = (dateTs != null && timeMinutes == null) ? endOfDay(ts) : ts;
      }
    }

    // 预估耗时：待办归入 estimatedMinutes；事件（裸时长+时间）的时长用于 endTime，不再额外写预估
    if (dur && dur.minutes > 0 && result.kind === 'todo') {
      result.estimatedMinutes = dur.minutes;
    }

    result.title = cleanTitle(s) || raw;
    result.confidence = computeConfidence(result);
    return result;
  }

  return {
    parse: parse,
    // 暴露内部供单测做精细断言
    _matchTime: matchTime,
    _matchDate: matchDate,
  };
}));
