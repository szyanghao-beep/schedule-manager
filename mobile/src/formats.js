/**
 * formats.js — 日期时间「文本输入/展示」辅助（表单用）。
 * 输入格式：日期 YYYY-MM-DD、时间 HH:mm；解析口径与 shared/utils 一致（本地时区）。
 * 校验失败返回 null，供表单 inline 报错。
 */
const shared = require('./shared');
const utils = shared.utils;

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 'YYYY-MM-DD' -> 当天 00:00 的时间戳；非法返回 null（如 2024-02-31 会回滚校验失败）
function parseDateText(str) {
  const s = String(str == null ? '' : str).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt.getTime();
}

// 'HH:mm' -> 当天分钟数（0-1439）；非法返回 null
function parseTimeText(str) {
  const s = String(str == null ? '' : str).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function nowDateText() {
  return utils.toDateStr(Date.now());
}

function nowTimeText() {
  return utils.toTimeStr(Date.now());
}

function minutesToTimeText(min) {
  return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
}

function dateTimeToText(ts) {
  return utils.toDateStr(ts) + ' ' + utils.toTimeStr(ts);
}

function timeRangeText(startTs, endTs) {
  return utils.toTimeStr(startTs) + ' – ' + utils.toTimeStr(endTs);
}

// 日期 + 星期，如 2024-05-20 周一
function dateLabel(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + WEEKDAYS[d.getDay()];
}

// 时间戳 -> 'YYYY-MM-DD HH:mm'；0/空 显示「从未同步」
function formatTs(ts) {
  if (!ts) return '从未同步';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

module.exports = {
  WEEKDAYS,
  parseDateText,
  parseTimeText,
  nowDateText,
  nowTimeText,
  minutesToTimeText,
  dateTimeToText,
  timeRangeText,
  dateLabel,
  formatTs,
};
