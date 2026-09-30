/*
 * electron-smoke.js — 真实 Electron 冒烟/验收测试
 *
 * 用真实的 Electron 运行整个应用（含主进程 IPC + preload + 渲染层），
 * 然后注入脚本检查界面是否真的能渲染出来 —— 直接验证用户上报的问题
 * （「安装后设置里没有本机同步服务」）。
 *
 * 运行：npx electron test/electron-smoke.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

// 隔离用户数据目录，避免污染真实数据（main.js 会读取该环境变量）
const tmpDir = path.join(os.tmpdir(), 'schedule-smoke-' + Date.now());
process.env.SCHEDULE_USER_DATA_DIR = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const { app, BrowserWindow } = require('electron');

// 先启动真实应用（main.js 内部会注册全部 IPC、创建窗口）
require('../main.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

async function main() {
  await app.whenReady();
  // 等窗口与渲染层就绪
  await new Promise(function (r) { setTimeout(r, 2500); });

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('✘ 未创建主窗口'); app.exit(1); return; }

  // 收集渲染层控制台错误（用于发现渲染中断）
  const rendererErrors = [];
  win.webContents.on('console-message', function (event) {
    const level = event && event.level;
    const msg = event && event.message;
    if (level === 'error' || level === 3) rendererErrors.push(msg);
  });

  const result = await win.webContents.executeJavaScript(`(async function () {
    const out = {};
    // 1) preload 暴露 + api.js 透传
    out.apiKeys = Object.keys(window.API || {});
    out.hasSyncServerMethods = ['syncServerStatus','syncServerStart','syncServerStop']
      .every(function (k) { return typeof window.API[k] === 'function'; });
    // 2) 模块与共享包
    out.modules = Object.keys(window.Modules || {});
    out.hasCustomerUtil = typeof window.CustomerUtil === 'object' && typeof window.CustomerUtil.amountSummary === 'function';
    out.hasUtils = typeof window.Utils === 'object';
    // 3) 真实渲染设置页
    let settingsErr = null;
    try { window.App.switchView('settings'); } catch (e) { settingsErr = String(e && e.message || e); }
    out.settingsError = settingsErr;
    // 「多端同步」卡片内容由 syncStatus() 异步填充（IPC 往返），需等一拍再读，
    // 否则会误判为「按钮不存在」
    await new Promise(function (r) { setTimeout(r, 500); });
    const sEl = document.getElementById('view-settings');
    out.settingsHtmlLen = sEl ? sEl.innerHTML.length : 0;
    out.settingsHasSyncServer = sEl ? sEl.textContent.indexOf('本机同步服务') >= 0 : false;
    out.settingsHasSyncCard = sEl ? sEl.textContent.indexOf('多端同步') >= 0 : false;
    // 3b) 同步服务器地址可修改（本次修复：此前设置里无处可改 IP）
    out.hasSyncSetServer = typeof window.API.syncSetServer === 'function';
    out.hasNormalizeUtil = !!(window.Utils && typeof window.Utils.normalizeServerUrl === 'function');
    out.settingsHasFillLocalBtn = sEl ? sEl.textContent.indexOf('填入本机地址') >= 0 : false;
    // 真调一次：只填 IP:端口（漏协议）应被自动补全 http://
    try {
      out.setServerRes = await window.API.syncSetServer('192.168.0.99:8787');
      const st2 = await window.API.syncStatus();
      out.setServerStatusUrl = st2 ? st2.serverUrl : null;
    } catch (e) {
      out.setServerError = String(e && e.message || e);
    }
    // 空地址应被拒绝（不能静默写入空地址导致后续同步静默失败）
    try {
      await window.API.syncSetServer('   ');
      out.setServerEmptyAccepted = true;
    } catch (e) {
      out.setServerEmptyRejected = true;
    }
    // 4) 真实渲染客户页
    let custErr = null;
    try { window.App.switchView('customer'); } catch (e) { custErr = String(e && e.message || e); }
    out.customerError = custErr;
    const cEl = document.getElementById('view-customer');
    out.customerHtmlLen = cEl ? cEl.innerHTML.length : 0;
    out.customerHasTitle = cEl ? cEl.textContent.indexOf('客户商机') >= 0 : false;
    out.customerHasAddBtn = cEl ? cEl.textContent.indexOf('新增客户') >= 0 : false;
    // 5) 其余视图也逐个渲染（确保没有整页崩溃）
    out.viewErrors = {};
    ['schedule','todo','plan','inbox','review','memorials','bookkeeping','search','stats'].forEach(function (v) {
      try { window.App.switchView(v); } catch (e) { out.viewErrors[v] = String(e && e.message || e); }
    });
    // 6) 同步服务状态 IPC 真能返回（验证内嵌服务器模块已打包且可加载）
    try {
      out.syncServerStatus = await window.API.syncServerStatus();
    } catch (e) {
      out.syncServerStatusError = String(e && e.message || e);
    }
    return out;
  })()`);

  console.log('== 渲染层与 IPC 验收 ==');
  check('window.API 已注入', Array.isArray(result.apiKeys) && result.apiKeys.length > 10, 'keys=' + result.apiKeys.length);
  check('API 含 syncServerStatus/Start/Stop（本次 bug 修复点）', result.hasSyncServerMethods === true);
  check('window.CustomerUtil（UMD）已加载', result.hasCustomerUtil === true);
  check('window.Utils 已加载', result.hasUtils === true);
  check('window.Modules.customer 已注册', (result.modules || []).indexOf('customer') >= 0, (result.modules || []).join(','));

  console.log('== 设置页渲染（用户上报问题）==');
  check('设置页渲染无异常', result.settingsError === null, result.settingsError || '');
  check('设置页有内容', result.settingsHtmlLen > 500, 'len=' + result.settingsHtmlLen);
  check('★ 设置页含「本机同步服务」卡片', result.settingsHasSyncServer === true);
  check('设置页含「多端同步」卡片（此前被中断的后续卡片）', result.settingsHasSyncCard === true);

  console.log('== 同步地址可修改（用户痛点：无法改 IP）==');
  check('API 含 syncSetServer（设置里可改服务器地址）', result.hasSyncSetServer === true);
  check('渲染层已加载 Utils.normalizeServerUrl（地址容错共用实现）', result.hasNormalizeUtil === true);
  check('登录表单含「填入本机地址」一键按钮', result.settingsHasFillLocalBtn === true);
  check('syncSetServer 自动补 http://（只填 IP:端口 也能用）',
    !!result.setServerRes && result.setServerRes.serverUrl === 'http://192.168.0.99:8787',
    result.setServerError || JSON.stringify(result.setServerRes));
  check('改地址后 syncStatus 与之一致', result.setServerStatusUrl === 'http://192.168.0.99:8787',
    String(result.setServerStatusUrl));
  check('空地址被拒绝（不会静默写入空地址）', result.setServerEmptyRejected === true);

  console.log('== 客户页渲染（本版本新功能）==');
  check('客户页渲染无异常', result.customerError === null, result.customerError || '');
  check('客户页有内容', result.customerHtmlLen > 200, 'len=' + result.customerHtmlLen);
  check('客户页含标题「客户商机」', result.customerHasTitle === true);
  check('客户页含「新增客户」按钮', result.customerHasAddBtn === true);

  console.log('== 其余视图逐个渲染 ==');
  const errs = result.viewErrors || {};
  check('全部视图渲染无异常', Object.keys(errs).length === 0, JSON.stringify(errs));

  console.log('== 内嵌同步服务器 IPC ==');
  const st = result.syncServerStatus;
  check('syncServerStatus 返回状态对象', !!st && typeof st === 'object', result.syncServerStatusError || '');
  check('状态含局域网 IP 与配对码字段', !!st && Array.isArray(st.ips) && typeof st.pairingCode === 'string',
    st ? ('ips=' + JSON.stringify(st.ips) + ' code=' + st.pairingCode) : '无');

  console.log('== 渲染层控制台错误 ==');
  check('无渲染层错误日志', rendererErrors.length === 0, rendererErrors.slice(0, 3).join(' | '));

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('冒烟测试异常:', e);
  app.exit(1);
});
