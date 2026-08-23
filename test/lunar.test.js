/*
 * lunar.test.js — 农历 / 节气 / 节假日 / 纪念日纯函数测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../shared/lunar.js');

function ts(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }

test('solarToLunar：2026-08-23 处暑、七月十一、丙午马', function () {
  const l = L.solarToLunar(ts(2026, 8, 23));
  assert.strictEqual(l.year, 2026);
  assert.strictEqual(l.month, 7);
  assert.strictEqual(l.day, 11);
  assert.strictEqual(l.isLeap, false);
  assert.strictEqual(l.monthCn, '七');
  assert.strictEqual(l.dayCn, '十一');
  assert.strictEqual(l.jieQi, '处暑');
  assert.strictEqual(l.ganZhi, '丙午');
  assert.strictEqual(l.shengXiao, '马');
});

test('getSolarTerm：节气日返回名称，非节气日返回空串', function () {
  assert.strictEqual(L.getSolarTerm(ts(2026, 8, 23)), '处暑');
  assert.strictEqual(L.getSolarTerm(ts(2026, 8, 24)), '');
});

test('getHoliday：法定假日 / 调休上班 / 普通日', function () {
  const gq = L.getHoliday(ts(2026, 10, 1));
  assert.ok(gq, '国庆应为节假日');
  assert.strictEqual(gq.name, '国庆节');
  assert.strictEqual(gq.isWork, false);
  assert.strictEqual(gq.isRest, true);

  const makeUp = L.getHoliday(ts(2026, 1, 4)); // 元旦调休上班日（周日）
  assert.ok(makeUp, '调休日应有节假日记录');
  assert.strictEqual(makeUp.isWork, true);
  assert.strictEqual(makeUp.isRest, false);

  assert.strictEqual(L.getHoliday(ts(2026, 8, 23)), null); // 普通日
});

test('isWorkday：法定假日休息、调休上班、普通周末休息、普通工作日上班', function () {
  assert.strictEqual(L.isWorkday(ts(2026, 10, 1)), false);  // 国庆休息
  assert.strictEqual(L.isWorkday(ts(2026, 1, 4)), true);    // 元旦调休上班（周日）
  assert.strictEqual(L.isWorkday(ts(2026, 8, 23)), false);  // 普通周日
  assert.strictEqual(L.isWorkday(ts(2026, 8, 24)), true);   // 普通周一
  assert.strictEqual(L.isRestDay(ts(2026, 8, 23)), true);
});

test('lunarDateToSolar：农历 1990 五月初四 -> 1990-05-27', function () {
  assert.strictEqual(L.lunarDateToSolar(1990, 5, 4), ts(1990, 5, 27));
});

test('lunarDateToSolar：闰月换算与非法日期兜底', function () {
  // 2023 闰二月十五 -> 2023-04-05
  assert.strictEqual(L.lunarDateToSolar(2023, -2, 15), ts(2023, 4, 5));
  // 2026 无闰二月 -> 平月兜底（闰二月初一按二月初一）
  const fallback = L.lunarDateToSolar(2026, -2, 1);
  assert.strictEqual(fallback, L.lunarDateToSolar(2026, 2, 1));
  // 非法农历日（某月无三十）-> null
  assert.strictEqual(L.lunarDateToSolar(2023, 2, 31), null);
  // 非法入参 -> null
  assert.strictEqual(L.lunarDateToSolar(2023, 0, 1), null);
});

test('nextMemorialOccurrence：公历生日跨年推进 + 年龄', function () {
  const m = { calendar: 'solar', month: 5, day: 27, year: 1990 };
  const now = ts(2026, 8, 23);
  const occ = L.nextMemorialOccurrence(m, now);
  assert.ok(occ);
  assert.strictEqual(occ.ts, ts(2027, 5, 27)); // 今年已过，推进到明年
  assert.strictEqual(occ.age, 37);
});

test('nextMemorialOccurrence：未来日期不推进', function () {
  const m = { calendar: 'solar', month: 12, day: 25, year: null };
  const occ = L.nextMemorialOccurrence(m, ts(2026, 8, 23));
  assert.strictEqual(occ.ts, ts(2026, 12, 25));
  assert.strictEqual(occ.age, null);
});

test('nextMemorialOccurrence：农历生日每年换算公历', function () {
  const m = { calendar: 'lunar', month: 5, day: 4, year: 1990 }; // 农历 1990 五月初四 = 1990-05-27
  const occ = L.nextMemorialOccurrence(m, ts(2026, 8, 23));
  assert.ok(occ);
  // 2026-08-23 已是农历七月十一，五月初四已过 -> 推进到 2027
  assert.ok(occ.ts >= ts(2026, 8, 23));
  assert.strictEqual(occ.year, 2027);
  assert.strictEqual(occ.age, 37);
});

test('countdownDays：今天 0、明天 1、未来跨年', function () {
  assert.strictEqual(L.countdownDays(ts(2026, 8, 23), ts(2026, 8, 23)), 0);
  assert.strictEqual(L.countdownDays(ts(2026, 8, 24), ts(2026, 8, 23)), 1);
  assert.strictEqual(L.countdownDays(ts(2027, 1, 1), ts(2026, 8, 23)), 131);
});

test('lunarShort / lunarFull：节气优先与月初显示', function () {
  assert.strictEqual(L.lunarShort(ts(2026, 8, 23)), '处暑');     // 节气优先
  assert.strictEqual(L.lunarShort(ts(2026, 8, 25)), '十三');      // 非节气日显示农历日（七月十三）
  const full = L.lunarFull(ts(2026, 8, 23));
  assert.strictEqual(full.date, '七月十一');
  assert.strictEqual(full.jieQi, '处暑');
});

test('getHoliday：自定义节假日覆盖（overrides）优先于内置数据', function () {
  const overrides = { '2027-01-01': { name: '元旦', isWork: false }, '2027-01-04': { name: '元旦调休', isWork: true } };
  const rest = L.getHoliday(ts(2027, 1, 1), overrides);
  assert.ok(rest);
  assert.strictEqual(rest.name, '元旦');
  assert.strictEqual(rest.isWork, false);
  assert.strictEqual(rest.isRest, true);
  const makeUp = L.getHoliday(ts(2027, 1, 4), overrides);
  assert.strictEqual(makeUp.isWork, true);
  // 未覆盖日期仍走内置/周末规则
  assert.strictEqual(L.getHoliday(ts(2027, 1, 2), overrides), null);
  assert.strictEqual(L.isWorkday(ts(2027, 1, 1), overrides), false);
  assert.strictEqual(L.isWorkday(ts(2027, 1, 4), overrides), true);
});

test('lunarMonthCn / lunarDayCn：农历月日中文名', function () {
  assert.strictEqual(L.lunarMonthCn(1), '正月');
  assert.strictEqual(L.lunarMonthCn(11), '冬月');
  assert.strictEqual(L.lunarMonthCn(12), '腊月');
  assert.strictEqual(L.lunarMonthCn(-2), '闰二月');
  assert.strictEqual(L.lunarMonthCn(0), '');
  assert.strictEqual(L.lunarDayCn(1), '初一');
  assert.strictEqual(L.lunarDayCn(10), '初十');
  assert.strictEqual(L.lunarDayCn(11), '十一');
  assert.strictEqual(L.lunarDayCn(20), '二十');
  assert.strictEqual(L.lunarDayCn(21), '廿一');
  assert.strictEqual(L.lunarDayCn(30), '三十');
  assert.strictEqual(L.lunarDayCn(31), '');
});
