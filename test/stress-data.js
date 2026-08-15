/*
 * stress-data.js — 生成 2 年跨度的压测数据（日程 + 待办），确定性、可复现。
 * 覆盖：全天/时段事件、daily/weekly/monthly/custom 重复、久远起点的重复系列、
 *       待办四象限（重要性 × 截止远近）、不同状态、有无截止/提醒。
 * 同时被 test/stress.test.js 与「填充应用数据」脚本复用。
 */
'use strict';

const DAY = 86400000;

// mulberry32 确定性伪随机数，保证每次生成的数据完全一致
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function generateStressData(opts) {
  opts = opts || {};
  const now = opts.now != null ? opts.now : Date.now();
  const spanDays = opts.spanDays != null ? opts.spanDays : 365; // 前后各 365 天
  const rand = rng(opts.seed != null ? opts.seed : 20260815);

  const CATS = [
    { id: 'cat-work', name: '工作', color: '#4f8ef7' },
    { id: 'cat-life', name: '生活', color: '#4caf7d' },
    { id: 'cat-learn', name: '学习', color: '#f2a541' },
    { id: '', name: '未分类', color: '#8a8f98' },
  ];

  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function dayOffset() { return Math.floor(rand() * (spanDays * 2)) - spanDays; }

  const events = [];
  const todos = [];

  // A. 非重复日程：全天 + 时段，散布在前后两年
  for (let i = 0; i < 400; i++) {
    const allDay = rand() < 0.4;
    const offset = dayOffset();
    const base = now + offset * DAY;
    const d = new Date(base);
    d.setHours(8 + Math.floor(rand() * 10), Math.floor(rand() * 4) * 15, 0, 0);
    const startTime = allDay ? startOfDay(base) : d.getTime();
    let endTime;
    if (allDay) {
      const days = 1 + Math.floor(rand() * 3);
      endTime = startOfDay(startTime) + days * DAY - 1;
    } else {
      endTime = startTime + (1 + Math.floor(rand() * 3)) * 3600000;
    }
    const cat = pick(CATS);
    events.push({
      id: 'ev-' + i, title: (allDay ? '全天' : '日程') + ' ' + i, description: '',
      allDay: allDay, startTime: startTime, endTime: endTime,
      priority: pick(['low', 'medium', 'high']),
      categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color,
      repeat: { type: 'none', interval: 1, endDate: null },
      remindBefore: pick([0, 0, 0, 5, 10, 15, 30, 60]),
      status: 'pending', createdAt: now, updatedAt: now,
    });
  }

  // B. 重复日程：起点散布在过去一年，重点覆盖 daily 以压 expandOccurrences
  const repTypes = ['daily', 'daily', 'weekly', 'monthly', 'custom'];
  for (let i = 0; i < 300; i++) {
    const type = repTypes[Math.floor(rand() * repTypes.length)];
    const interval = type === 'custom' ? (1 + Math.floor(rand() * 10)) : 1;
    const startOffset = -(Math.floor(rand() * spanDays)); // 0 ~ -365 天
    const d = new Date(now + startOffset * DAY);
    d.setHours(9 + Math.floor(rand() * 8), 0, 0, 0);
    const startTime = d.getTime();
    const endTime = startTime + (1 + Math.floor(rand() * 2)) * 3600000;
    const cat = pick(CATS);
    events.push({
      id: 'evr-' + i, title: '重复 ' + i, description: '',
      allDay: false, startTime: startTime, endTime: endTime,
      priority: pick(['low', 'medium', 'high']),
      categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color,
      repeat: { type: type, interval: interval, endDate: rand() < 0.3 ? now + 180 * DAY : null },
      remindBefore: pick([0, 5, 10, 15, 30, 60]),
      status: 'pending', createdAt: now, updatedAt: now,
    });
  }

  // C. 待办：覆盖四象限各区域、不同状态、有无截止/提醒
  for (let i = 0; i < 500; i++) {
    const r = rand();
    let deadline;
    if (r < 0.2) deadline = null;                                          // 无截止 → 不紧急
    else if (r < 0.45) deadline = now + Math.floor(rand() * 24 * 3600000); // 24h 内 → 紧急
    else if (r < 0.6) deadline = now - Math.floor(rand() * 30) * DAY;      // 逾期 → 紧急
    else deadline = now + (1 + Math.floor(rand() * spanDays)) * DAY;       // 远期
    const status = pick(['pending', 'pending', 'pending', 'doing', 'done']);
    const cat = pick(CATS);
    todos.push({
      id: 'td-' + i, title: '待办 ' + i, description: '',
      deadline: deadline,
      priority: pick(['low', 'medium', 'high']),
      importance: rand() < 0.7 ? 'important' : 'not_important',
      categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color,
      repeat: { type: 'none', interval: 1, endDate: null },
      remindBefore: pick([0, 0, 0, 5, 10, 15, 30, 60]),
      status: status, completedAt: status === 'done' ? now : null,
      createdAt: now, updatedAt: now,
    });
  }

  return {
    categories: CATS.slice(0, 3).map(function (c) {
      return { id: c.id, name: c.name, color: c.color, isDefault: true, createdAt: now };
    }),
    events: events,
    todos: todos,
    settings: { defaultRemindBefore: 15, urgentThresholdHours: 24 },
    statsHistory: [],
  };
}

module.exports = { generateStressData: generateStressData, rng: rng, startOfDay: startOfDay, DAY: DAY };
