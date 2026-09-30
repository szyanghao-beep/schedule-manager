/*
 * mobile.contract.test.js — 手机端（React Native）接线契约测试
 *
 * 背景：手机端无法在 CI 里跑真实的安卓构建，过去出过「代码看着对、一跑就崩」的问题
 * （例如桌面端 preload 暴露了方法但 api.js 漏透传，整页渲染中断）。
 * 手机端同类风险很高：
 *   - 屏幕里 store.xxx() 调了 store 没导出的方法
 *   - navigation.navigate('X') 指向没注册的 Stack.Screen
 *   - App.js import 了不存在的屏幕文件
 *   - 屏幕里用了 shared / constants 里不存在的字段
 * 这些都能在纯 Node 下静态查出来，不必等打包到手机上才发现。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

// 收集手机端所有屏幕与组件源码
function mobileSources() {
  const out = [];
  ['src/screens', 'src/components', 'src'].forEach(function (dir) {
    const full = path.join(MOBILE, dir);
    if (!fs.existsSync(full)) return;
    fs.readdirSync(full).forEach(function (name) {
      const rel = path.join(dir, name).replace(/\\/g, '/');
      const abs = path.join(MOBILE, rel);
      if (fs.statSync(abs).isFile() && name.endsWith('.js')) out.push('mobile/' + rel);
    });
  });
  return Array.from(new Set(out));
}

// 解析 store.js 的 export default { ... } 里列出的方法名
function storeExports() {
  const src = read('mobile/src/store.js');
  const start = src.indexOf('export default {');
  assert.ok(start > 0, '应能定位 mobile/src/store.js 的导出块');
  const body = src.slice(start);
  const names = [];
  const re = /(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*[,}]/gm;
  let m;
  while ((m = re.exec(body)) !== null) names.push(m[1]);
  return Array.from(new Set(names));
}

test('手机端调用的 store.xxx 都在 mobile/src/store.js 中导出（防调用不存在的方法）', function () {
  const exported = storeExports();
  assert.ok(exported.length > 20, '应解析出 store 的导出方法（实际 ' + exported.length + ' 个）');

  const bad = [];
  mobileSources().forEach(function (f) {
    if (f === 'mobile/src/store.js') return;
    const src = read(f);
    const re = /\bstore\.([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (exported.indexOf(m[1]) < 0) bad.push(f + ' -> store.' + m[1]);
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    '屏幕调用了 store 未导出的方法：\n  ' + Array.from(new Set(bad)).join('\n  '));
});

test('手机端 navigation.navigate 的目标都有对应的 Stack.Screen 注册（防跳到不存在的页面）', function () {
  const app = read('mobile/App.js');
  const registered = [];
  const reReg = /<Stack\.Screen\s+name="([^"]+)"/g;
  let m;
  while ((m = reReg.exec(app)) !== null) registered.push(m[1]);
  assert.ok(registered.length >= 4, '应解析出已注册的路由（实际 ' + registered.length + ' 个）');

  const bad = [];
  mobileSources().forEach(function (f) {
    const src = read(f);
    const re = /navigation\.navigate\(\s*'([^']+)'/g;
    let m2;
    while ((m2 = re.exec(src)) !== null) {
      if (registered.indexOf(m2[1]) < 0) bad.push(f + ' -> ' + m2[1]);
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    '跳转目标没有注册 Stack.Screen：\n  ' + Array.from(new Set(bad)).join('\n  ') +
    '\n已注册：' + registered.join(', '));
});

test('App.js 里 import 的屏幕文件都真实存在', function () {
  const app = read('mobile/App.js');
  const re = /import\s+\w+\s+from\s+'\.\/(src\/[^']+)'/g;
  const missing = [];
  let m;
  while ((m = re.exec(app)) !== null) {
    const rel = 'mobile/' + m[1];
    const candidates = [rel, rel + '.js'];
    if (!candidates.some(function (c) { return fs.existsSync(path.join(ROOT, c)); })) missing.push(rel);
  }
  assert.deepStrictEqual(missing, [], 'App.js 引用了不存在的文件：' + missing.join(', '));
});

test('手机端用到的 shared 子模块都存在（防写成 shared.xxx 但入口没导出）', function () {
  const sharedIndex = require(path.join(ROOT, 'shared', 'index.js'));
  const available = Object.keys(sharedIndex);

  const bad = [];
  mobileSources().forEach(function (f) {
    const src = read(f);
    // 形如 const { customer: CU, constants, sync } = shared;
    const re = /const\s*\{([^}]+)\}\s*=\s*shared\s*;/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      m[1].split(',').forEach(function (part) {
        const key = part.split(':')[0].trim();
        if (key && available.indexOf(key) < 0) bad.push(f + ' -> shared.' + key);
      });
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    'shared 入口没有这些子模块：' + Array.from(new Set(bad)).join(', ') + '（可用：' + available.join(', ') + '）');
});

test('手机端用到的 constants.XXX 都在 shared/constants.js 中真实存在', function () {
  const constants = require(path.join(ROOT, 'shared', 'constants.js'));

  const bad = [];
  mobileSources().forEach(function (f) {
    const src = read(f);
    const re = /\bconstants\.([A-Z][A-Z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!Object.prototype.hasOwnProperty.call(constants, m[1])) bad.push(f + ' -> constants.' + m[1]);
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    '引用了不存在的常量：' + Array.from(new Set(bad)).join(', '));
});
