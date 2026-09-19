/*
 * api.contract.test.js — 渲染层 IPC 接口契约测试（防回归）
 *
 * 背景：曾出现 preload.js 暴露了 syncServerStatus/Start/Stop，但 api.js 漏了透传，
 * 导致设置页调用 window.API.syncServerStatus() 时同步抛 TypeError、整个设置页渲染中断
 * （用户表现为「设置里没有本机同步服务」）。单测当时覆盖不到渲染层，故补此契约测试。
 *
 * 校验三件事：
 *   1. preload.js 暴露给渲染进程的每个 API，api.js 都必须透传（否则 window.API.xxx 为 undefined）
 *   2. api.js 里引用的 window.api.xxx 都必须在 preload 中真实存在（防止拼错）
 *   3. 渲染层各处调用的 window.API.xxx 都必须在 api.js 中定义（防止调用不存在的方法）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

// 从 `key: value` 形式的对象字面量源码里提取所有 key
function extractKeys(src, startMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) return [];
  const body = src.slice(start);
  const keys = [];
  const re = /(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    // 只在对象字面量范围内收集：遇到首个 `}` 且不在嵌套里就停（简单实现：限制在原文本前 4000 字符）
    if (m.index > 4000) break;
    keys.push(m[1]);
  }
  return keys;
}

function unique(arr) { return Array.from(new Set(arr)); }

test('preload 暴露的 each API 都被 api.js 透传（防「漏透传」回归）', function () {
  const preload = read('preload.js');
  const api = read('src/renderer/js/api.js');

  const exposed = unique(extractKeys(preload, "exposeInMainWorld('api'"));
  const forwarded = unique(extractKeys(api, 'window.API = {'));

  assert.ok(exposed.length > 5, '应能解析出 preload 暴露的方法（实际 ' + exposed.length + ' 个）');

  const missing = exposed.filter(function (k) { return forwarded.indexOf(k) < 0; });
  assert.deepStrictEqual(
    missing, [],
    'api.js 缺少对 preload 方法的透传：' + missing.join(', ') +
    '（渲染层调用 window.API.xxx 会同步抛 TypeError，导致整页渲染中断）'
  );
});

test('api.js 引用的 window.api.xxx 都在 preload 中真实存在（防拼写错误）', function () {
  const preload = read('preload.js');
  const api = read('src/renderer/js/api.js');

  const exposed = unique(extractKeys(preload, "exposeInMainWorld('api'"));

  const referenced = [];
  const re = /window\.api\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(api)) !== null) referenced.push(m[1]);

  const ghost = unique(referenced).filter(function (k) { return exposed.indexOf(k) < 0; });
  assert.deepStrictEqual(ghost, [], 'api.js 引用了 preload 未暴露的方法：' + ghost.join(', '));
});

test('渲染层调用的 window.API.xxx 都在 api.js 中定义（防调用不存在的方法）', function () {
  const api = read('src/renderer/js/api.js');
  const defined = unique(extractKeys(api, 'window.API = {'));

  // 收集渲染层所有 js
  const files = [];
  (function walk(dir) {
    fs.readdirSync(path.join(ROOT, dir)).forEach(function (name) {
      const rel = path.join(dir, name);
      const full = path.join(ROOT, rel);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(rel);
      else if (name.endsWith('.js')) files.push(rel.replace(/\\/g, '/'));
    });
  })('src/renderer/js');

  const used = [];
  files.forEach(function (f) {
    const src = read(f);
    const re = /(?:window\.)?API\.([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) used.push({ file: f, key: m[1] });
  });

  const bad = used.filter(function (u) { return defined.indexOf(u.key) < 0; });
  const detail = unique(bad.map(function (b) { return b.file + ' -> API.' + b.key; }));
  assert.deepStrictEqual(detail, [], '渲染层调用了未定义的 API 方法：\n  ' + detail.join('\n  '));
});

test('每个 IPC 通道名在 preload 与主进程之间都有对应（防通道名不一致）', function () {
  const preload = read('preload.js');
  const main = read('main.js');

  const invoked = [];
  const reInvoke = /ipcRenderer\.invoke\(\s*'([^']+)'/g;
  let m;
  while ((m = reInvoke.exec(preload)) !== null) invoked.push(m[1]);
  const reOn = /ipcRenderer\.on\(\s*'([^']+)'/g;
  while ((m = reOn.exec(preload)) !== null) invoked.push(m[1]);

  const handled = [];
  const reHandle = /ipcMain\.handle\(\s*'([^']+)'/g;
  while ((m = reHandle.exec(main)) !== null) handled.push(m[1]);
  const reSend = /webContents\.send\(\s*'([^']+)'/g;
  while ((m = reSend.exec(main)) !== null) handled.push(m[1]);

  const missing = unique(invoked).filter(function (c) { return handled.indexOf(c) < 0; });
  assert.deepStrictEqual(missing, [], 'preload 使用了主进程未注册的 IPC 通道：' + missing.join(', '));
});
