/*
 * ui.harness.test.js — UI 测试宿主自身的契约测试（防止「宿主悄悄失效」导致用例永远绿）
 *
 * 为什么需要：如果 ui.helpers.js 加载脚本失败、少加载了模块、或 window.API 没打桩成功，
 * 上层用例很可能因为「查不到元素」而误报成业务问题，甚至在某些写法下变成永远通过。
 * 这里把宿主的几条硬约束钉住：
 *   1. 加载的脚本清单必须与 index.html 的 <script src> 完全一致（顺序一致）；
 *   2. 每个 js/modules/*.js 都挂上了 window.Modules.<name>.render；
 *   3. window.api 是桩，window.API 的所有方法都不碰 Electron；
 *   4. 所有视图容器都在，切换视图后可渲染。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const helpers = require('./ui.helpers.js');
const { setupUi, flush, FIXED_NOW } = helpers;

test('宿主 · 按 index.html 的顺序加载全部渲染层脚本', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  const expected = helpers.indexHtmlScriptSrcs();
  assert.deepStrictEqual(h.scriptSrcs, expected);
  assert.ok(expected.length >= 20, 'index.html 应引用全部渲染层脚本，实际只有 ' + expected.length + ' 个');
  // 顺序敏感：shared 必须先于依赖它的 js/
  assert.ok(expected[0].indexOf('shared/utils.js') > 0, 'window.Utils 必须最先加载');
  assert.ok(expected.indexOf('../../shared/customer.js') < expected.indexOf('js/store.js'), 'CustomerUtil 必须先于 store.js');
  assert.strictEqual(expected[expected.length - 1], 'js/app.js', 'app.js 必须最后加载');
  assert.ok(helpers.indexHtmlScriptSrcs().every(function (src) {
    return fs.existsSync(path.resolve(helpers.RENDERER_DIR, src));
  }));
});

test('宿主 · 各全局命名空间与视图容器就位', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  ['Utils', 'CustomerUtil', 'Store', 'Dom', 'Helpers', 'API', 'App', 'Toast', 'Modal', 'ContextMenu', 'Modules']
    .forEach(function (name) {
      assert.ok(h.window[name], 'window.' + name + ' 未挂载');
    });

  // 每个模块脚本都要挂上 render()
  h.scriptSrcs.filter(function (src) { return src.indexOf('js/modules/') >= 0; }).forEach(function (src) {
    const name = path.basename(src, '.js');
    assert.strictEqual(typeof h.Modules[name], 'object', 'window.Modules.' + name + ' 缺失');
    assert.strictEqual(typeof h.Modules[name].render, 'function', 'window.Modules.' + name + '.render 缺失');
  });

  // 视图容器与导航项一一对应
  const views = h.qsa('.view').map(function (v) { return v.id.replace('view-', ''); });
  const navs = h.qsa('.nav-item').map(function (b) { return b.dataset.view; });
  assert.deepStrictEqual(views, navs);
  views.forEach(function (name) {
    assert.ok(h.window.document.getElementById('view-' + name), '缺少容器 #view-' + name);
  });
});

test('宿主 · window.API 已被打桩：不依赖 Electron 也能跑通全部方法', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  // api.js 的透传壳必须完全落在桩上
  const missing = Object.keys(h.API).filter(function (k) { return !(k in h.api); });
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(h.window.api, h.api, 'preload 的 window.api 应被替换成桩');

  const asyncMethods = Object.keys(h.API).filter(function (k) { return k !== 'constants'; });
  for (const name of asyncMethods) {
    const ret = h.API[name](function () {});
    if (name === 'onReminder' || name === 'onReminderAction' || name === 'onQuickCapture' ||
        name === 'onSyncDataUpdated' || name === 'onSyncConflict') {
      assert.strictEqual(typeof ret, 'undefined', name + ' 是订阅类，应返回 undefined');
      continue;
    }
    // 注意：返回值是 jsdom realm 的 Promise，不能用 instanceof 判断
    assert.strictEqual(typeof ret.then, 'function', name + ' 应返回 Promise');
  }
  await flush();
  // 事件类订阅的桩回调可以手动触发
  let fired = null;
  h.API.onQuickCapture(function () { fired = 'quick'; });
  h.api.__emit('onQuickCapture');
  assert.strictEqual(fired, 'quick');
});

test('宿主 · App.init 后默认进入日程视图，切视图可渲染且渲染出错会被捕获', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  assert.strictEqual(h.App.getView(), 'schedule', 'init 后应进入默认视图');
  assert.ok(h.view('schedule').innerHTML.length > 0, '日程视图应已渲染内容');
  assert.strictEqual(h.qs('.nav-item.active').dataset.view, 'schedule');

  // 点导航切换视图（真实 click 事件）
  h.clickText('.nav-item', '设置');
  await flush();
  assert.strictEqual(h.App.getView(), 'settings');
  assert.strictEqual(h.qs('.nav-item.active').dataset.view, 'settings');
  assert.ok(h.view('settings').classList.contains('active'));
  assert.ok(!h.view('schedule').classList.contains('active'));

  // 每个视图都能渲染且没有 console 报错
  ['schedule', 'todo', 'customer', 'plan', 'inbox', 'review', 'memorials', 'bookkeeping', 'search', 'stats', 'settings']
    .forEach(function (name) { h.renderView(name); });
  await flush();
  assert.deepStrictEqual(h.logs, [], '渲染各视图不应有 console 报错');
});

test('宿主 · 冻结时钟与全局桥接生效', async function (t) {
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });

  // 渲染层里 Date.now() 被冻结（否则「今天/本周」这类断言不可能稳定）
  assert.strictEqual(h.window.Utils.toDateStr(h.window.Date.now()), '2026-03-10');
  assert.strictEqual(h.window.Date.now(), FIXED_NOW);
  // 浏览器全局已桥接到 Node global，便于用例直接写 document
  assert.strictEqual(global.document, h.document);
  assert.strictEqual(typeof h.window.localStorage, 'object');
  assert.strictEqual(typeof h.window.matchMedia, 'function', 'app.js 依赖 matchMedia，宿主必须补齐');
  assert.strictEqual(h.window.confirm('x'), true, 'confirm 必须被桩掉（否则会走 jsdom 的 not implemented）');
});
