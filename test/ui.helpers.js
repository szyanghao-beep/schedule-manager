/*
 * ui.helpers.js — 渲染层 UI 测试的 jsdom 宿主（不是测试文件，自身不含用例）
 *
 * 目标：把 src/renderer 下的「纯原生 JS 全局脚本」按 index.html 的真实顺序加载进一个
 * 真实的 DOM 环境（jsdom），让模块的 render() 产出真实节点，从而对 textContent /
 * classList / 查询选择器做真实断言，并可以派发真实的 click / change 事件验证交互。
 *
 * 关键设计：
 *   1. 脚本顺序来自 index.html 本身（正则抽取 <script src>，不手写重复清单）——
 *      index.html 改了顺序，这里自动跟随，且 ui.harness 用例会校验顺序一致。
 *   2. **必须打桩 window.api**：api.js 在加载期就读 window.api.constants，
 *      shared/customer.js 也要 window.api.constants，所以桩必须在加载脚本「之前」就位。
 *      window.API（api.js 生成的一层透传壳）因此天然指向桩，全程不碰 ipcRenderer。
 *   3. 环境缺失的浏览器能力（jsdom 没有 matchMedia；confirm/alert 是 not implemented）
 *      在加载脚本前补齐/替换，避免「环境问题」被误判成「代码问题」。
 *   4. 可注入固定时钟（opts.now）：stats / customer 这类按「现在」推导象限、逾期、
 *      阶段停留的渲染，只有冻结 Date.now() 才能写出确定性断言。
 *   5. 异步渲染：settings 的「多端同步」卡片、stats 的历史趋势等都是 Promise 填充，
 *      断言前必须 await handle.flush()（踩过的坑，见 flush 注释）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const INDEX_HTML = path.join(RENDERER_DIR, 'index.html');
const CONSTANTS = require(path.join(ROOT, 'shared', 'constants.js'));

// 固定时钟：2026-03-10 14:30（本地时区）。用 Date.now() 的冻结让渲染结果可复现。
const FIXED_NOW = new Date(2026, 2, 10, 14, 30, 0, 0).getTime();
const DAY = 86400000;

// ---------------------------------------------------------------------------
// index.html 解析：脚本顺序 + 去脚本的页面骨架
// ---------------------------------------------------------------------------
let cachedHtml = null;

function readIndexHtml() {
  if (cachedHtml == null) cachedHtml = fs.readFileSync(INDEX_HTML, 'utf8');
  return cachedHtml;
}

// index.html 中 <script src="..."> 的相对路径，保持出现顺序
function indexHtmlScriptSrcs() {
  const html = readIndexHtml();
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>\s*<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// 去掉 <script> 标签后的整页 HTML（jsdom 只负责搭骨架，脚本由我们按序注入）
function pageHtmlWithoutScripts() {
  return readIndexHtml().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// ---------------------------------------------------------------------------
// 脚本编译缓存：vendor/lunar.js 有 400KB+，每个用例都重新编译太慢
// ---------------------------------------------------------------------------
const scriptCache = new Map();

function compiledScript(absPath) {
  if (!scriptCache.has(absPath)) {
    scriptCache.set(absPath, new vm.Script(fs.readFileSync(absPath, 'utf8'), { filename: absPath }));
  }
  return scriptCache.get(absPath);
}

// ---------------------------------------------------------------------------
// window.api / window.API 打桩
// ---------------------------------------------------------------------------
function emptyData() {
  return {
    categories: [],
    events: [],
    todos: [],
    settings: { defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system' },
    accounts: [],
    transactions: [],
    bookkeepingCategories: [],
    budgets: [],
    memorials: [],
    customers: [],
    followups: [],
  };
}

function emailStatusFrom(payload, prev) {
  const p = payload || {};
  const r = p.reminder || {};
  const s = p.smtp || {};
  return {
    enabled: !!r.enabled,
    time: r.time || '08:00',
    to: r.to || '',
    host: s.host || '',
    port: Number(s.port) || 465,
    secure: s.secure !== false,
    user: s.user || '',
    fromName: s.fromName || '',
    hasPassword: !!(p.password || (prev && prev.hasPassword)),
    lastSentDate: (prev && prev.lastSentDate) || null,
  };
}

function aiStatusFrom(payload, prev) {
  const p = payload || {};
  const a = p.ai || {};
  return {
    enabled: !!a.enabled,
    provider: a.provider || 'ollama',
    endpoint: a.endpoint || '',
    model: a.model || '',
    hasApiKey: !!(p.apiKey || (prev && prev.hasApiKey)),
  };
}

/**
 * 创建一个可配置的 ipcRenderer 替身。
 * 用法（测试里）：
 *   const api = handle.api;
 *   api.__set('syncStatus', { loggedIn: true, serverUrl: 'http://x:8787' });  // 直接覆盖某个方法
 *   api.__sync({ loggedIn: true, serverUrl: 'http://x:8787' });              // 只改同步状态机的状态
 *   api.__fail('loginSync', new Error('用户名或密码错误'));
 *   api.__count('syncNow') / api.__lastArgs('syncStatus')
 *   api.__emit('onReminderAction', { id: 't1', entityType: 'todo' })  // 触发主进程事件回调
 *
 * 同步相关方法照主进程 main.js 的契约实现（不是简单返回常量），这样「登录 → 状态变已登录」
 * 「改地址 → 状态里是新地址」「退出登录 → 回到未登录」这些链路可以在真实状态机上演进：
 *   loginSync(opts)        -> { ok:true }，置 loggedIn=true、serverUrl=归一化(opts.serverUrl)
 *   syncStatus()           -> { loggedIn, serverUrl }
 *   syncSetServer(url)     -> { serverUrl, changed }，空地址 throw（与 main.js 一致，invoke 语义下即 reject）
 *   syncLogout()           -> { ok:true }，置 loggedIn=false（serverUrl 保留，与渲染层文案一致）
 */
function normalizeServerUrl(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'http://' + s;
}

function createApiStub(overrides) {
  const state = {
    email: emailStatusFrom(null, null),
    ai: aiStatusFrom(null, null),
    sync: { loggedIn: false, serverUrl: '' },
  };

  // 默认实现（返回值会被 Promise.resolve 包装，模拟 ipcRenderer.invoke）
  const defaults = {
    loadData: function () { return emptyData(); },
    saveData: function () { return { ok: true }; },
    exportData: function () { return { ok: false, canceled: true }; },
    importData: function () { return { ok: false, canceled: true }; },
    restoreData: function () { return { ok: false, canceled: true }; },
    getStatsHistory: function () { return { statsHistory: [] }; },
    notify: function () { return undefined; },
    snoozeReminder: function () { return undefined; },
    emailSaveSettings: function (payload) {
      state.email = emailStatusFrom(payload, state.email);
      return Object.assign({}, state.email);
    },
    emailTest: function () { return { ok: true }; },
    emailStatus: function () { return Object.assign({}, state.email); },
    aiSaveSettings: function (payload) {
      state.ai = aiStatusFrom(payload, state.ai);
      return Object.assign({}, state.ai);
    },
    aiTest: function () { return 'pong'; },
    aiStatus: function () { return Object.assign({}, state.ai); },
    aiParse: function () { return { ok: false, reason: 'stub' }; },
    loginSync: function (opts) {
      state.sync.loggedIn = true;
      if (opts && opts.serverUrl) state.sync.serverUrl = normalizeServerUrl(opts.serverUrl);
      return { ok: true };
    },
    syncPull: function () { return { pulled: 0, pushed: 0 }; },
    syncPush: function () { return { pushed: 0, pulled: 0 }; },
    syncNow: function () { return { pushed: 0, pulled: 0 }; },
    syncStatus: function () { return Object.assign({}, state.sync); },
    syncSetServer: function (serverUrl) {
      const u = normalizeServerUrl(serverUrl);
      if (!u) throw new Error('请填写服务器地址'); // main.js 同款校验，空地址 invoke 失败
      if (u === state.sync.serverUrl) return { serverUrl: u, changed: false };
      state.sync.serverUrl = u;
      return { serverUrl: u, changed: true };
    },
    syncLogout: function () { state.sync.loggedIn = false; return { ok: true }; },
    syncServerStatus: function () { return { running: false, ips: [], port: 8787 }; },
    syncServerStart: function () {
      return { running: true, port: 8787, ips: ['192.168.0.106'], url: 'http://192.168.0.106:8787', pairingCode: '246810' };
    },
    syncServerStop: function () { return { running: false, ips: [], port: 8787 }; },
  };

  // 事件订阅类：只记录回调，供 __emit 触发
  const listeners = ['onReminder', 'onReminderAction', 'onQuickCapture', 'onSyncDataUpdated', 'onSyncConflict'];

  const stub = { constants: CONSTANTS };
  const calls = {};
  const handlers = {};
  const failures = {};
  const registered = {};

  Object.keys(defaults).forEach(function (name) {
    calls[name] = [];
    stub[name] = function () {
      const args = Array.prototype.slice.call(arguments);
      calls[name].push(args);
      if (failures[name]) {
        const err = failures[name];
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      const h = handlers[name] || defaults[name];
      try {
        return Promise.resolve(h.apply(null, args));
      } catch (e) {
        return Promise.reject(e); // 同步抛错等价于 IPC 失败
      }
    };
  });

  listeners.forEach(function (name) {
    registered[name] = [];
    stub[name] = function (cb) {
      calls[name] = calls[name] || [];
      calls[name].push([cb]);
      registered[name].push(cb);
      return undefined; // 订阅类不返回 Promise，与 preload 一致
    };
  });

  // ---- 测试控制面 ----
  // ⚠️ 记录的是 params javascript 对象（jsdom realm 的 Object/Array），
  //    node:assert.deepStrictEqual 会比较原型，跨 realm 会判不等。
  //    所以取用时统一转成「本 realm 的纯数据」。
  const toPlain = function (v) {
    if (v === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  };
  stub.__calls = calls;
  stub.__listeners = registered;
  stub.__state = state;
  stub.__set = function (name, valueOrFn) {
    handlers[name] = (typeof valueOrFn === 'function') ? valueOrFn : function () { return valueOrFn; };
    return stub;
  };
  // 只改同步状态机的状态（等价于「服务端/主进程那边登录态变了」），不覆盖方法实现
  stub.__sync = function (patch) {
    Object.assign(state.sync, patch || {});
    ['syncStatus', 'loginSync', 'syncLogout', 'syncSetServer'].forEach(function (k) { delete handlers[k]; });
    return stub;
  };
  stub.__fail = function (name, err) { failures[name] = err; return stub; };
  stub.__count = function (name) { return (calls[name] || []).length; };
  stub.__lastArgs = function (name) {
    const list = calls[name] || [];
    return list.length ? toPlain(list[list.length - 1]) : null;
  };
  stub.__argsAt = function (name, index) { return toPlain((calls[name] || [])[index]); };
  stub.__emit = function (name) {
    const args = Array.prototype.slice.call(arguments, 1);
    (registered[name] || []).forEach(function (cb) { cb.apply(null, args); });
  };
  stub.__reset = function () {
    Object.keys(calls).forEach(function (k) { calls[k] = []; });
    Object.keys(handlers).forEach(function (k) { delete handlers[k]; });
    Object.keys(failures).forEach(function (k) { delete failures[k]; });
    return stub;
  };

  Object.keys(overrides || {}).forEach(function (k) { stub.__set(k, overrides[k]); });
  return stub;
}

// ---------------------------------------------------------------------------
// 环境补丁
// ---------------------------------------------------------------------------
function patchBrowserGlobals(win) {
  // jsdom 没实现 matchMedia，而 app.js 的主题跟随系统依赖它
  if (typeof win.matchMedia !== 'function') {
    win.matchMedia = function (query) {
      return {
        media: query,
        matches: false,
        onchange: null,
        addListener: function () {},
        removeListener: function () {},
        addEventListener: function () {},
        removeEventListener: function () {},
        dispatchEvent: function () { return false; },
      };
    };
  }
  // jsdom 的 confirm/alert/prompt 是「not implemented」并返回 undefined，会污染日志
  win.confirm = function () { return true; };
  win.alert = function () {};
  win.prompt = function () { return null; };
  win.print = function () {};
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
/**
 * @param {object} [opts]
 * @param {number|null} [opts.now]   冻结 Date.now()（渲染层内），默认不冻结
 * @param {boolean}   [opts.init]    是否派发 DOMContentLoaded 触发 App.init()，默认 true
 * @param {object}    [opts.data]    init 时 API.loadData() 返回的初始数据（走真实加载链路进 Store）
 * @param {object}    [opts.loadData] 直接指定 loadData 的返回值（优先于 data）
 * @param {object}    [opts.sync]    同步状态机初值 { loggedIn, serverUrl }
 * @param {object}    [opts.api]     追加的 API 桩覆盖（方法名 -> 值或函数）
 * @param {boolean}   [opts.patchGlobals] 是否把 window/document/localStorage 挂到 Node global，默认 true
 * @returns {Promise<object>} handle —— setupUi 是 async：init 时会等 API.loadData() 落库后再返回，
 *          否则用例里刚 seed 的 Store 数据会被初始加载的返回覆盖（踩过的坑）。
 */
async function setupUi(opts) {
  opts = opts || {};
  const virtualConsole = new VirtualConsole();
  const logs = [];
  virtualConsole.on('jsdomError', function (e) { logs.push({ type: 'jsdomError', message: String(e && e.message || e) }); });
  ['error', 'warn', 'log', 'info'].forEach(function (level) {
    virtualConsole.on(level, function () {
      logs.push({ type: level, message: Array.prototype.map.call(arguments, function (a) {
        return (a && a.message) ? a.message : String(a);
      }).join(' ') });
    });
  });

  const dom = new JSDOM(pageHtmlWithoutScripts(), {
    url: 'http://localhost/',
    runScripts: 'outside-only', // 我们自己用 vm.runInContext 按序注入脚本，禁用 jsdom 自动加载
    pretendToBeVisual: true,
    virtualConsole: virtualConsole,
  });
  const win = dom.window;
  const ctx = dom.getInternalVMContext();

  patchBrowserGlobals(win);

  // 冻结渲染层时钟（必须在加载脚本前，脚本里若缓存了 Date.now 引用才能生效）
  if (opts.now != null) {
    const fixed = opts.now;
    win.Date.now = function () { return fixed; };
  }

  // ★ 打桩必须先于脚本加载：api.js 读 window.api.constants，
  //   shared/customer.js（浏览器分支）也读 window.api.constants
  const api = createApiStub(opts.api);
  if (opts.sync) api.__sync(opts.sync);
  const initialData = opts.loadData != null ? opts.loadData : Object.assign(emptyData(), opts.data || {});
  // 每次 loadData 返回一份拷贝：Store 会直接持有返回的对象引用，共享同一份会互相污染
  api.__set('loadData', function () { return JSON.parse(JSON.stringify(initialData)); });
  win.api = api;

  // 按 index.html 的真实顺序加载全部渲染层脚本
  const srcs = indexHtmlScriptSrcs();
  if (!srcs.length) throw new Error('index.html 里没解析到任何 <script src>，UI 测试宿主无法加载渲染层');
  srcs.forEach(function (src) {
    const abs = path.resolve(RENDERER_DIR, src);
    if (!fs.existsSync(abs)) throw new Error('index.html 引用了不存在的脚本：' + src + ' -> ' + abs);
    compiledScript(abs).runInContext(ctx);
  });

  // api.js 把 window.API 建成一层透传到 window.api 的壳；两者都指向桩。
  // 校验壳的方法集合与桩一致：将来新增 IPC 方法却忘了在桩里加默认实现，这里会立刻炸出来。
  const missing = Object.keys(win.API || {}).filter(function (k) { return !(k in api); });
  if (missing.length) throw new Error('window.API 有未打桩的方法：' + missing.join(', ') + '（请同步补到 ui.helpers.js 的 defaults）');

  const handle = {
    dom: dom,
    window: win,
    document: win.document,
    api: api,
    API: win.API,
    Store: win.Store,
    Utils: win.Utils,
    CustomerUtil: win.CustomerUtil,
    Helpers: win.Helpers,
    Dom: win.Dom,
    App: win.App,
    Modules: win.Modules,
    Toast: win.Toast,
    Modal: win.Modal,
    ContextMenu: win.ContextMenu,
    logs: logs,
    scriptSrcs: srcs,
    setupOptions: opts,
  };

  // 方便测试文件里直接写 document.querySelector（与浏览器一致的心智）。
  // 注意：Node 24 的 global.navigator 是只读 getter，不能覆盖，这里只挂可写的几个。
  if (opts.patchGlobals !== false) {
    const assign = function (key, value) {
      try { global[key] = value; } catch (e) { /* 只读的内建全局，跳过 */ }
    };
    assign('window', win);
    assign('document', win.document);
    assign('localStorage', win.localStorage);
    assign('Event', win.Event);
    assign('MouseEvent', win.MouseEvent);
  }

  // ---- 视图与查询辅助 ----
  handle.renderView = function (name) {
    win.App.switchView(name);
    return win.document.getElementById('view-' + name);
  };
  handle.view = function (name) { return win.document.getElementById('view-' + name); };
  handle.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || win.document).querySelectorAll(sel));
  };
  handle.qs = function (sel, root) { return (root || win.document).querySelector(sel); };
  handle.texts = function (sel, root) { return handle.qsa(sel, root).map(function (n) { return n.textContent.trim(); }); };
  handle.text = function (sel, root) { const n = handle.qs(sel, root); return n ? n.textContent.trim() : null; };
  // 按可见文本找按钮（断言交互时最直观：点「修改地址」而不是点第 3 个 btn）
  handle.byText = function (sel, label, root) {
    const hit = handle.qsa(sel, root).filter(function (n) { return n.textContent.trim() === label; });
    if (!hit.length) throw new Error('未找到文本为「' + label + '」的 ' + sel);
    return hit[0];
  };
  handle.allByText = function (sel, label, root) {
    return handle.qsa(sel, root).filter(function (n) { return n.textContent.trim() === label; });
  };
  handle.click = function (node) { node.click(); return node; };
  handle.clickText = function (sel, label, root) { return handle.click(handle.byText(sel, label, root)); };
  handle.change = function (node, value) {
    if (value !== undefined) {
      if (node.type === 'checkbox') node.checked = !!value;
      else node.value = value;
    }
    node.dispatchEvent(new win.Event('change', { bubbles: true }));
    return node;
  };
  // 按卡片标题定位 .card（设置页/客户页都是「一堆同名 class 的卡片」，靠标题最稳）
  handle.cardByTitle = function (title, root) {
    const hit = handle.qsa('.panel-title', root).filter(function (n) { return n.textContent.trim() === title; });
    if (!hit.length) throw new Error('未找到标题为「' + title + '」的卡片');
    return hit[0].closest('.card') || hit[0].parentNode;
  };
  // 一个 form-row 里的 label + 控件，返回 [{ label, node, type, value }]
  handle.formRows = function (root) {
    return handle.qsa('.form-row', root).map(function (row) {
      const label = row.querySelector('label');
      const node = row.querySelector('input, select, textarea');
      return {
        row: row,
        label: label ? label.textContent.trim() : '',
        node: node,
        type: node ? node.type : '',
        value: node ? (node.type === 'checkbox' ? node.checked : node.value) : undefined,
      };
    });
  };
  // 按按钮文本定位它所在的分组容器（toolbar），再往上取整个区块。
  // 用途：不依赖「区块 A 在区块 B 之前」这类 DOM 顺序，只依赖「按钮属于哪个区块」。
  handle.rowOfButton = function (label, root) {
    const btn = handle.byText('button', label, root);
    return btn.closest('.toolbar') || btn.parentNode;
  };
  handle.boxOfButton = function (label, root) {
    const row = handle.rowOfButton(label, root);
    return row.parentNode;
  };
  // 由某个按钮定位到同一区块里的输入控件：先把范围收缩到该按钮所在的区块，
  // 避免选到别的区块（例如「未登录」表单里的服务器地址输入框）。
  handle.inputOfRow = function (label, root, selector) {
    return handle.qs(selector || 'input', handle.boxOfButton(label, root));
  };
  // 提示条（toast）文本
  handle.toasts = function () { return handle.texts('#toast-root .toast'); };
  handle.clearToasts = function () { win.document.getElementById('toast-root').innerHTML = ''; };
  handle.flush = flush;
  handle.wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  handle.close = function () { try { win.close(); } catch (e) { /* 已关闭 */ } };

  // 触发 App.init()（app.js 在 DOMContentLoaded 时初始化）。
  // jsdom 由字符串构造时该事件已经发过，这里手动派发一次，保证 init 一定执行。
  if (opts.init !== false) {
    win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
    // 等初始数据加载完成（API.loadData() -> Store.set）再交还控制权
    await flush();
  }

  return handle;
}

/**
 * 让当前所有 Promise 链跑到底（含 .then 里再 .then 的异步渲染）。
 * ⚠️ 设置页的「多端同步」「邮件提醒」「AI」以及统计页的历史趋势都是 Promise 填充，
 *    render() 返回时这些容器还是空的 —— 必须先 await flush() 再断言，
 *    否则会把「异步还没回来」误判成「元素不存在」。
 */
function flush(rounds) {
  const n = rounds == null ? 4 : rounds;
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) {
    p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  }
  return p;
}

module.exports = {
  ROOT: ROOT,
  RENDERER_DIR: RENDERER_DIR,
  INDEX_HTML: INDEX_HTML,
  CONSTANTS: CONSTANTS,
  FIXED_NOW: FIXED_NOW,
  DAY: DAY,
  setupUi: setupUi,
  flush: flush,
  indexHtmlScriptSrcs: indexHtmlScriptSrcs,
  pageHtmlWithoutScripts: pageHtmlWithoutScripts,
  createApiStub: createApiStub,
  emptyData: emptyData,
};
