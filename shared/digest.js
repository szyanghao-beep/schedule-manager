/*
 * digest.js — 每日待办邮件摘要（纯函数，供主进程 + 单元测试复用）。
 * 输入完整数据 { events, todos } 与当前时间，输出 { subject, text, html }。
 * 无副作用，不发送邮件；发送由 main.js 用 nodemailer 完成。
 */
const Utils = require('./utils.js');
const constants = require('./constants.js');
const LunarUtil = require('./lunar.js');

const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// 待办的一行摘要（纯文本）：[高] 截止 18:00 · 工作 · 标题
function todoLine(t) {
  const tags = [];
  if (t.priority) tags.push('[' + (PRIORITY_LABEL[t.priority] || t.priority) + ']');
  if (t.deadline != null) tags.push('截止 ' + Utils.toTimeStr(t.deadline));
  if (t.categoryName) tags.push(t.categoryName);
  return (tags.length ? tags.join(' ') + ' · ' : '') + (t.title || '');
}

// 待办的一行摘要（HTML）：标题 + 元信息
function todoHtml(t) {
  const tags = [];
  if (t.priority) tags.push(PRIORITY_LABEL[t.priority] || t.priority);
  if (t.deadline != null) tags.push(Utils.toTimeStr(t.deadline));
  if (t.categoryName) tags.push(t.categoryName);
  const meta = tags.length ? ' <span style="color:#888">(' + escapeHtml(tags.join(' · ')) + ')</span>' : '';
  return '<li>' + escapeHtml(t.title || '') + meta + '</li>';
}

function eventHtml(e) {
  const when = e.allDay ? '全天' : (Utils.toTimeStr(e.startTime) + ' - ' + Utils.toTimeStr(e.endTime));
  return '<li>' + escapeHtml(e.title || '') + ' <span style="color:#888">(' + escapeHtml(when) + ')</span></li>';
}

function buildDailyDigest(data, now) {
  if (now == null) now = Date.now();
  const events = (data && data.events) || [];
  const todos = (data && data.todos) || [];
  const dateStr = Utils.toDateStr(now);
  const dayStart = Utils.startOfDay(now);

  // 今日待办：未完成且截止在今天
  const todayTodos = todos.filter(function (t) {
    return t.status !== Utils.STATUS.DONE && t.deadline != null && Utils.isSameDay(t.deadline, now);
  });
  // 逾期待办：未完成且截止在今天之前
  const overdueTodos = todos.filter(function (t) {
    return t.status !== Utils.STATUS.DONE && t.deadline != null && t.deadline < dayStart;
  });
  // 收件箱积压：未完成且没有截止时间（未整理）
  const inboxTodos = todos.filter(function (t) {
    return t.status !== Utils.STATUS.DONE && t.deadline == null;
  });
  // 今日日程：今天发生的日程（重复日程展开到当天实例）
  const todayEvents = [];
  events.forEach(function (e) {
    Utils.expandOccurrences(e, { from: dayStart, to: Utils.addDays(dayStart, 1) }).forEach(function (occ) {
      todayEvents.push({ title: e.title, allDay: e.allDay, startTime: occ.startTime, endTime: occ.endTime });
    });
  });
  todayEvents.sort(function (a, b) { return a.startTime - b.startTime; });

  // 今日纪念日：下一次发生日期恰为今天（农历生日已换算到公历）
  const memorials = (data && data.memorials) || [];
  const todayMemorials = [];
  memorials.forEach(function (m) {
    if (!m || m.deleted) return;
    const occ = LunarUtil.nextMemorialOccurrence(m, now);
    if (occ && Utils.isSameDay(occ.ts, now)) todayMemorials.push({ m: m, occ: occ });
  });
  todayMemorials.sort(function (a, b) { return a.occ.ts - b.occ.ts; });

  const stats = Utils.calcStats(events, todos, now);

  const subject = '日程管理 · 每日待办 ' + dateStr;

  // ---- 纯文本 ----
  const lines = [];
  lines.push(subject);
  lines.push('==============================');
  lines.push('');
  lines.push('今日待办（' + todayTodos.length + '）');
  if (todayTodos.length) todayTodos.forEach(function (t) { lines.push('· ' + todoLine(t)); });
  else lines.push('（无）');
  lines.push('');
  lines.push('逾期未完成（' + overdueTodos.length + '）');
  if (overdueTodos.length) overdueTodos.forEach(function (t) { lines.push('· ' + todoLine(t)); });
  else lines.push('（无）');
  lines.push('');
  lines.push('今日日程（' + todayEvents.length + '）');
  if (todayEvents.length) todayEvents.forEach(function (e) {
    const when = e.allDay ? '全天' : (Utils.toTimeStr(e.startTime) + ' - ' + Utils.toTimeStr(e.endTime));
    lines.push('· ' + e.title + '（' + when + '）');
  });
  else lines.push('（无）');
  lines.push('');
  lines.push('今日纪念日（' + todayMemorials.length + '）');
  if (todayMemorials.length) todayMemorials.forEach(function (x) {
    const m = x.m, occ = x.occ;
    const kind = constants.MEMORIAL_KIND_LABEL[m.kind] || '纪念日';
    lines.push('· ' + kind + ' · ' + (m.name || '') + (occ.age != null ? '（' + occ.age + ' 岁）' : ''));
  });
  else lines.push('（无）');
  lines.push('');
  lines.push('收件箱积压（' + inboxTodos.length + '）');
  if (inboxTodos.length) inboxTodos.forEach(function (t) { lines.push('· ' + t.title); });
  else lines.push('（无）');
  lines.push('');
  lines.push('今日概览：完成 ' + stats.today.done + '/' + stats.today.total + ' · 逾期 ' + stats.overdue + ' · 收件箱积压 ' + inboxTodos.length);
  const text = lines.join('\n');

  // ---- HTML ----
  function section(title, count, itemsHtml) {
    return '<h2>' + escapeHtml(title) + '（' + count + '）</h2>' +
      (itemsHtml ? '<ul>' + itemsHtml + '</ul>' : '<p style="color:#888">（无）</p>');
  }
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#222">' +
    '<h1 style="font-size:20px">日程管理 · 每日待办</h1>' +
    '<p style="color:#888">' + escapeHtml(dateStr) + '</p>' +
    section('今日待办', todayTodos.length, todayTodos.map(todoHtml).join('')) +
    section('逾期未完成', overdueTodos.length, overdueTodos.map(todoHtml).join('')) +
    section('今日日程', todayEvents.length, todayEvents.map(eventHtml).join('')) +
    section('今日纪念日', todayMemorials.length, todayMemorials.map(function (x) {
      const m = x.m, occ = x.occ;
      const kind = constants.MEMORIAL_KIND_LABEL[m.kind] || '纪念日';
      return '<li>' + escapeHtml(m.name || '') + ' <span style="color:#888">(' + escapeHtml(kind) +
        (occ.age != null ? ' · ' + occ.age + ' 岁' : '') + ')</span></li>';
    }).join('')) +
    section('收件箱积压', inboxTodos.length, inboxTodos.map(function (t) {
      return '<li>' + escapeHtml(t.title || '') + '</li>';
    }).join('')) +
    '<p style="color:#888;margin-top:24px">今日概览：完成 ' + stats.today.done + '/' + stats.today.total + ' · 逾期 ' + stats.overdue + ' · 收件箱积压 ' + inboxTodos.length + '</p>' +
    '</div>';

  return { subject: subject, text: text, html: html };
}

// ---- 每日邮件触发判定（到点 + 当日未发，纯函数、无副作用）----

// 'HH:mm' -> 当日分钟数；非法返回 null
function parseEmailTime(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

// 失败后的重试退避（毫秒）：第 1 次失败后等 5 分钟，第 2 次 15 分钟，第 3 次 60 分钟。
// 为什么需要：检查周期是 30 秒。若失败后不记录任何状态、下一轮又满足「到点且当日未发」，
// 就会**每 30 秒撞一次 SMTP**（一整天约 2880 次），既刷爆日志，
// 也可能被邮箱服务商判定为异常而**锁定账号**。
var EMAIL_RETRY_DELAYS_MS = [5 * 60000, 15 * 60000, 60 * 60000];
// 一天的尝试上限（含首次）：超过就当天不再尝试，避免无意义的持续重试
var EMAIL_MAX_ATTEMPTS_PER_DAY = 4;

// 判断「到点且当日未发」是否应触发每日邮件。
// opts: { enabled, to, host, user, hasPassword, time, now, lastSentDate, sending,
//         failCount?, failDate?, lastAttemptAt? }
//   failCount/failDate/lastAttemptAt 用于失败退避；不传时行为与以前完全一致。
function shouldSendDailyEmail(opts) {
  if (!opts) return false;
  if (!opts.enabled || !opts.to) return false;                    // 开关 + 收件人
  if (!opts.host || !opts.user || !opts.hasPassword) return false; // SMTP 完整
  const minutes = parseEmailTime(opts.time);
  if (minutes == null) return false;                              // 发送时间非法
  if (opts.sending) return false;                                 // 发送中防重入
  const today = Utils.toDateStr(opts.now);
  if (opts.lastSentDate === today) return false;                  // 当日已发去重
  if (opts.now < Utils.startOfDay(opts.now) + minutes * 60000) return false; // 未到点

  // ---- 失败退避（跨天后自动清零）----
  const failDate = opts.failDate || '';
  const failCount = failDate === today ? (Number(opts.failCount) || 0) : 0;
  if (failCount >= EMAIL_MAX_ATTEMPTS_PER_DAY) return false;      // 今天试够次数了，明天再说
  if (failCount > 0 && opts.lastAttemptAt) {
    const delay = EMAIL_RETRY_DELAYS_MS[Math.min(failCount - 1, EMAIL_RETRY_DELAYS_MS.length - 1)];
    if (opts.now - opts.lastAttemptAt < delay) return false;      // 还在退避期内
  }
  return true;
}

// 当天是否已放弃发送（用于「今天就别指望了，去设置里看错误原因」这类提示）
function dailyEmailGaveUp(opts) {
  if (!opts) return false;
  const today = Utils.toDateStr(opts.now);
  if ((opts.failDate || '') !== today) return false;
  return (Number(opts.failCount) || 0) >= EMAIL_MAX_ATTEMPTS_PER_DAY;
}

module.exports = {
  buildDailyDigest: buildDailyDigest,
  parseEmailTime: parseEmailTime,
  shouldSendDailyEmail: shouldSendDailyEmail,
  dailyEmailGaveUp: dailyEmailGaveUp,
  EMAIL_RETRY_DELAYS_MS: EMAIL_RETRY_DELAYS_MS,
  EMAIL_MAX_ATTEMPTS_PER_DAY: EMAIL_MAX_ATTEMPTS_PER_DAY,
};
