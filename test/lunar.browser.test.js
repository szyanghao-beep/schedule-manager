/*
 * lunar.browser.test.js — 验证 lunar.js 浏览器分支（<script> 引入挂 window.LunarUtil）与 vendor 装配。
 * 用 vm 模拟无 module/exports 的浏览器环境，确保渲染端 <script> 加载路径不依赖 CommonJS。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBrowserSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  // 先加载 vendor（UMD 浏览器分支：把 Solar/Lunar/HolidayUtil 挂到 root）
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared', 'vendor', 'lunar.js'), 'utf-8'), sandbox);
  // 再加载封装（浏览器分支：挂 window.LunarUtil）
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared', 'lunar.js'), 'utf-8'), sandbox);
  return sandbox;
}

test('浏览器分支：window.LunarUtil 挂载成功且可换算农历', function () {
  const sb = loadBrowserSandbox();
  assert.ok(sb.LunarUtil, 'LunarUtil 应挂到 window');
  const l = sb.LunarUtil.solarToLunar(new Date(2026, 7, 23).getTime());
  assert.strictEqual(l.monthCn, '七');
  assert.strictEqual(l.dayCn, '十一');
  assert.strictEqual(l.jieQi, '处暑');
});

test('浏览器分支：节假日 / 工作日 / 农历转公历可用', function () {
  const sb = loadBrowserSandbox();
  const L = sb.LunarUtil;
  assert.strictEqual(L.getHoliday(new Date(2026, 9, 1).getTime()).name, '国庆节');
  assert.strictEqual(L.isWorkday(new Date(2026, 0, 4).getTime()), true);  // 调休上班
  assert.strictEqual(L.lunarDateToSolar(1990, 5, 4), new Date(1990, 4, 27).getTime());
});
