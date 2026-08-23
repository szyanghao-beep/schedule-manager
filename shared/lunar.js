/*
 * lunar.js — 农历 / 节气 / 法定节假日（含调休）封装（2.3.0 新增）。
 * 基于 6tail/lunar-javascript（零依赖，源码 vendored 至 shared/vendor/lunar.js，数据至 2026）。
 * UMD 包装：Node(CommonJS) 下 require 使用，浏览器下挂载到 window.LunarUtil。
 * 该文件同时被主进程（纪念日提醒）、渲染进程（日历标注）、单元测试复用，逻辑纯函数、无副作用。
 *
 * 约定：
 *   - 输入时间戳一律本地时区。
 *   - 农历月份用负数表示闰月（与 lunar-javascript 一致），如 -2 = 闰二月。
 *   - 节假日：HolidayUtil.getHoliday 返回 null = 普通日；isWork()=true = 调休上班日；false = 法定休假日。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/lunar.js'));
  } else {
    root.LunarUtil = factory({
      Solar: root.Solar,
      Lunar: root.Lunar,
      HolidayUtil: root.HolidayUtil,
      LunarYear: root.LunarYear,
    });
  }
}(typeof self !== 'undefined' ? self : this, function (lib) {
  'use strict';

  var Solar = lib.Solar;
  var Lunar = lib.Lunar;
  var HolidayUtil = lib.HolidayUtil;
  var LunarYear = lib.LunarYear;

  var DAY_MS = 86400000;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function toDateStr(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function toTimestamp(y, m, d) {
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }

  // 时间戳 -> 农历信息对象（纯数据，无副作用）。
  // 返回 { year, month(正值), isLeap, day, monthCn, dayCn, ganZhi, shengXiao, jieQi, festivals, otherFestivals }
  function solarToLunar(ts) {
    var d = new Date(ts);
    var lunar = Solar.fromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()).getLunar();
    var month = lunar.getMonth(); // 负数 = 闰月
    return {
      year: lunar.getYear(),
      month: Math.abs(month),
      isLeap: month < 0,
      day: lunar.getDay(),
      monthCn: lunar.getMonthInChinese(), // 如「七」「闰二」
      dayCn: lunar.getDayInChinese(),     // 如「十一」「初二」
      ganZhi: lunar.getYearInGanZhi(),    // 干支纪年「丙午」
      shengXiao: lunar.getYearShengXiao(),// 生肖「马」
      jieQi: lunar.getJieQi() || '',      // 当天节气名，非节气日为空串
      festivals: lunar.getFestivals() || [],
      otherFestivals: lunar.getOtherFestivals() || [],
    };
  }

  // 当天节气名；非节气日返回空串
  function getSolarTerm(ts) {
    return solarToLunar(ts).jieQi;
  }

  // 法定节假日 / 调休信息；普通日返回 null。
  // 返回 { name, isWork, isRest }；调休上班日 isWork=true，休假日 isWork=false。
  // overrides：可选自定义节假日覆盖 map（'YYYY-MM-DD' -> { name, isWork }），优先于内置数据（新年度导入，A5）。
  function getHoliday(ts, overrides) {
    var d = new Date(ts);
    var key = toDateStr(ts);
    if (overrides && overrides[key]) {
      var work = !!overrides[key].isWork;
      return { name: overrides[key].name || '节假日', isWork: work, isRest: !work };
    }
    var h = HolidayUtil.getHoliday(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (!h) return null;
    var w = !!h.isWork();
    return { name: h.getName(), isWork: w, isRest: !w };
  }

  // 是否工作日：调休上班日按 isWork 覆盖；法定假日按休息；其余按周一~周五。
  function isWorkday(ts, overrides) {
    var d = new Date(ts);
    var key = toDateStr(ts);
    if (overrides && overrides[key]) return !!overrides[key].isWork;
    var h = HolidayUtil.getHoliday(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (h) return !!h.isWork();
    var wd = d.getDay();
    return wd !== 0 && wd !== 6;
  }

  function isRestDay(ts, overrides) { return !isWorkday(ts, overrides); }

  // 农历日期 -> 公历时间戳（当天 0 点，本地时区）；无法换算返回 null。
  // month 为负数表示闰月；若该年无此闰月，回退到同序号平月（闰月生日在普通年份按平月过）。
  function lunarDateToSolar(year, month, day) {
    year = Number(year); month = Number(month); day = Number(day);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return null;
    if (month === 0) return null;
    var ts = lunarToSolarSafe(year, month, day);
    if (ts != null) return ts;
    if (month < 0) return lunarToSolarSafe(year, -month, day); // 该年无此闰月 -> 平月兜底
    return null;
  }

  function lunarToSolarSafe(year, month, day) {
    try {
      var lunar = Lunar.fromYmd(year, month, day);
      var s = lunar.getSolar();
      return toTimestamp(s.getYear(), s.getMonth(), s.getDay());
    } catch (e) {
      return null; // 非法日期（如农历三十不存在、该年无此闰月）
    }
  }

  // 纪念日下一次发生日期。memorial: { calendar:'solar'|'lunar', month, day, year }
  // 从 now（默认今天）起查找，最多向后 5 年；返回 { ts, year, age }（age 需 year 且为生日口径）。
  function nextMemorialOccurrence(memorial, now) {
    if (now == null) now = Date.now();
    var today = startOfDay(now);
    var cur = new Date(now);
    var startYear = cur.getFullYear();
    var birthYear = (memorial && memorial.year) ? Number(memorial.year) : null;
    for (var y = startYear; y <= startYear + 5; y++) {
      var ts = memorialSolarTs(memorial, y);
      if (ts != null && ts >= today) {
        var age = (birthYear != null && birthYear > 0) ? (y - birthYear) : null;
        return { ts: ts, year: y, age: age };
      }
    }
    return null;
  }

  // 纪念日在某一年对应的公历时间戳（当天 0 点）；非法日期返回 null。
  function memorialSolarTs(memorial, y) {
    if (!memorial) return null;
    var month = Number(memorial.month);
    var day = Number(memorial.day);
    if (!isFinite(month) || !isFinite(day)) return null;
    if (memorial.calendar === 'lunar') return lunarDateToSolar(y, month, day);
    // 公历：手动校验越界（如 2/30），避免 Date 自动进位
    if (month < 1 || month > 12) return null;
    var d = new Date(y, month - 1, day);
    if (d.getFullYear() !== y || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d.getTime();
  }

  // 距今还有多少天（向上取整，今天=0）
  function countdownDays(ts, now) {
    if (now == null) now = Date.now();
    return Math.round((startOfDay(ts) - startOfDay(now)) / DAY_MS);
  }

  // 日历用的简短标签：节气优先，其次月初显示「X月」，其余显示「初二」。
  function lunarShort(ts) {
    var l = solarToLunar(ts);
    if (l.jieQi) return l.jieQi;
    if (l.day === 1) return l.monthCn + '月';
    return l.dayCn;
  }

  // 完整农历信息（供日视图 / 悬浮提示）。
  function lunarFull(ts) {
    var l = solarToLunar(ts);
    return {
      date: l.monthCn + '月' + l.dayCn,
      jieQi: l.jieQi,
      festivals: l.festivals.slice(),
      ganZhi: l.ganZhi,
      shengXiao: l.shengXiao,
    };
  }

  // 农历月份中文名（month 负数=闰月）：正月..腊月，闰月加「闰」前缀。
  var LUNAR_MONTH_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  function lunarMonthCn(month) {
    var m = Math.abs(Number(month));
    if (!isFinite(m) || m < 1 || m > 12) return '';
    return (Number(month) < 0 ? '闰' : '') + LUNAR_MONTH_CN[m - 1] + '月';
  }

  // 农历日中文名：初一..初十、十一..十九、二十、廿一..廿九、三十。
  function lunarDayCn(day) {
    var d = Number(day);
    var ones = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (!isFinite(d) || d < 1 || d > 30) return '';
    if (d === 10) return '初十';
    if (d === 20) return '二十';
    if (d === 30) return '三十';
    var tens = Math.floor(d / 10);
    var one = d % 10;
    if (tens === 0) return '初' + ones[one - 1];
    return ['', '十', '廿'][tens] + ones[one - 1];
  }

  return {
    solarToLunar: solarToLunar,
    getSolarTerm: getSolarTerm,
    getHoliday: getHoliday,
    isWorkday: isWorkday,
    isRestDay: isRestDay,
    lunarDateToSolar: lunarDateToSolar,
    nextMemorialOccurrence: nextMemorialOccurrence,
    countdownDays: countdownDays,
    lunarShort: lunarShort,
    lunarFull: lunarFull,
    lunarMonthCn: lunarMonthCn,
    lunarDayCn: lunarDayCn,
  };
}));
