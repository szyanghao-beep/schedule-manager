/*
 * system.contract.test.js — 系统级契约测试（跨文件一致性，防整类 bug）
 *
 * 覆盖四类「单文件测试抓不到」的问题：
 *   1. 数据集合一致性：defaultData 声明的集合，必须在渲染层 store 中有对应字段，
 *      且同步白名单（buildLocalChanges / applyRemoteChanges）不漏接
 *   2. 脚本加载完整性：index.html 必须加载所有模块依赖的全局脚本（如 window.CustomerUtil）
 *   3. 打包完整性：package.json 的 files 必须覆盖运行时必需文件（服务器源码、共享包、图标）
 *   4. 主进程 IPC 与渲染层调用一致
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

test('数据集合一致性：defaultData 的业务集合都在 store 中声明', function () {
  const main = read('main.js');
  const store = read('src/renderer/js/store.js');

  // 从 defaultData 里提取 `xxx: [],` 形式的集合字段
  const start = main.indexOf('function defaultData()');
  const body = main.slice(start, main.indexOf('// ---------- 加载 / 保存', start));
  const collections = [];
  const re = /^\s{4}([a-zA-Z][\w]*):\s*\[\]/gm;
  let m;
  while ((m = re.exec(body)) !== null) collections.push(m[1]);

  assert.ok(collections.length >= 8, '应解析出 defaultData 的集合字段（实际 ' + collections.length + '）');

  // 主进程内部字段：不需要（也不应该）在渲染层 store 中持有
  const MAIN_ONLY = ['statsHistory', 'notified', 'snoozed'];
  const business = collections.filter(function (c) { return MAIN_ONLY.indexOf(c) < 0; });

  const missing = business.filter(function (c) {
    return !new RegExp('\\b' + c + ':\\s*\\[\\]').test(store);
  });
  assert.deepStrictEqual(missing, [], 'store 中缺少这些业务数据集合的声明：' + missing.join(', '));
});

test('同步白名单不漏接：需要同步的集合都出现在 buildLocalChanges 与 applyRemoteChanges', function () {
  const main = read('main.js');

  // 期望同步的集合（与 ENTITY_TYPES 对应）
  const expectations = [
    { collection: 'categories', entity: 'CATEGORY' },
    { collection: 'events', entity: 'EVENT' },
    { collection: 'todos', entity: 'TODO' },
    { collection: 'customers', entity: 'CUSTOMER' },
    { collection: 'followups', entity: 'FOLLOWUP' },
  ];

  const build = main.slice(main.indexOf('function buildLocalChanges'), main.indexOf('function recordContentKey'));
  const apply = main.slice(main.indexOf('function applyRemoteChanges'), main.indexOf('function notifyConflict'));

  expectations.forEach(function (e) {
    assert.ok(
      build.indexOf('data.' + e.collection) >= 0 && build.indexOf('ENTITY_TYPES.' + e.entity) >= 0,
      'buildLocalChanges 未接线 ' + e.collection + '（' + e.entity + '）'
    );
    assert.ok(
      apply.indexOf('data.' + e.collection) >= 0 && apply.indexOf('ENTITY_TYPES.' + e.entity) >= 0,
      'applyRemoteChanges 未接线 ' + e.collection + '（' + e.entity + '）'
    );
  });
});

test('index.html 加载了渲染层模块依赖的所有全局脚本', function () {
  const html = read('src/renderer/index.html');

  // 需要被加载的全局脚本（模块依赖它们）
  const required = [
    { file: 'shared/utils.js', global: 'Utils' },
    { file: 'shared/customer.js', global: 'CustomerUtil' },
  ];
  required.forEach(function (r) {
    assert.ok(html.indexOf(r.file) >= 0, 'index.html 未加载 ' + r.file + '（模块依赖 window.' + r.global + '）');
  });

  // index.html 里出现的每个模块脚本文件都必须真实存在（防止漏提交/改名）
  // script src 是相对 src/renderer/ 的路径（如 js/dom.js、../../shared/utils.js）
  const re = /<script src="([^"]+)"><\/script>/g;
  let m;
  const missing = [];
  while ((m = re.exec(html)) !== null) {
    const full = path.resolve(ROOT, 'src/renderer', m[1]);
    if (!fs.existsSync(full)) missing.push(m[1]);
  }
  assert.deepStrictEqual(missing, [], 'index.html 引用了不存在的脚本：' + missing.join(', '));
});

test('导航项与视图容器一一对应（防止加了导航没加容器）', function () {
  const html = read('src/renderer/index.html');

  const navViews = [];
  const reNav = /data-view="([^"]+)"/g;
  let m;
  while ((m = reNav.exec(html)) !== null) navViews.push(m[1]);

  const sections = [];
  const reSec = /id="view-([^"]+)"/g;
  while ((m = reSec.exec(html)) !== null) sections.push(m[1]);

  assert.ok(navViews.length >= 10, '应解析出导航项（实际 ' + navViews.length + '）');
  const noSection = navViews.filter(function (v) { return sections.indexOf(v) < 0; });
  assert.deepStrictEqual(noSection, [], '导航项缺少对应视图容器：' + noSection.join(', '));
});

test('每个导航视图都有对应的渲染模块（app.js MODULES 已注册）', function () {
  const html = read('src/renderer/index.html');
  const app = read('src/renderer/js/app.js');

  const navViews = [];
  const reNav = /data-view="([^"]+)"/g;
  let m;
  while ((m = reNav.exec(html)) !== null) navViews.push(m[1]);

  const missing = navViews.filter(function (v) {
    return !new RegExp('\\b' + v + ':\\s*window\\.Modules\\.' + v).test(app);
  });
  assert.deepStrictEqual(missing, [], 'app.js 未注册这些视图模块：' + missing.join(', '));
});

test('打包 files 覆盖运行时必需文件（服务器源码 / 共享包 / 图标 / 主进程）', function () {
  const pkg = JSON.parse(read('package.json'));
  const files = (pkg.build && pkg.build.files) || [];

  const required = ['main.js', 'preload.js', 'src/**/*', 'shared/**/*', 'server/src/**/*', 'package.json'];
  required.forEach(function (r) {
    assert.ok(files.indexOf(r) >= 0, 'package.json build.files 缺少：' + r);
  });

  // 这些文件必须真实存在于磁盘（否则打包会静默丢文件）
  ['main.js', 'preload.js', 'server/src/app.js', 'server/src/db.js', 'server/src/inboxDrop.js',
   'shared/customer.js', 'shared/inbox.js', 'build/icon.png'].forEach(function (f) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), '缺少运行时必需文件：' + f);
  });
});

test('生产依赖齐全（打包前必须能 require 到，否则 electron-builder 会失败）', function () {
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys(pkg.dependencies || {});
  assert.ok(deps.length > 0, '应有生产依赖');

  const missing = deps.filter(function (d) {
    return !fs.existsSync(path.join(ROOT, 'node_modules', d, 'package.json'));
  });
  assert.deepStrictEqual(missing, [], '未安装的生产依赖（会导致打包失败）：' + missing.join(', '));
});

test('内嵌同步服务器的必需模块都能被主进程 require', function () {
  // 主进程 startSyncServer 依赖这两个模块路径
  assert.ok(fs.existsSync(path.join(ROOT, 'server/src/app.js')), 'server/src/app.js 缺失');
  assert.ok(fs.existsSync(path.join(ROOT, 'server/src/db.js')), 'server/src/db.js 缺失');

  // 实际加载一次，确保导出符合预期（打包后 require 才不会是运行时炸弹）
  const { createApp } = require('../server/src/app.js');
  const { createDb } = require('../server/src/db.js');
  const { derivePairingCode } = require('../server/src/inboxDrop.js');
  assert.strictEqual(typeof createApp, 'function');
  assert.strictEqual(typeof createDb, 'function');
  assert.strictEqual(typeof derivePairingCode, 'function');
});
