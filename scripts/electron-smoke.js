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
    // 团队共用商机库的关键入口（客户一多就必须能搜、能按人看）
    out.customerHasSearch = !!(cEl && cEl.querySelector('#customer-search'));
    out.customerHasOwnerFilter = cEl ? cEl.textContent.indexOf('全部负责人') >= 0 : false;
    out.customerHasBucketBar = cEl
      ? (cEl.textContent.indexOf('已逾期') >= 0 && cEl.textContent.indexOf('未安排') >= 0) : false;
    out.customerHasTeamToggle = cEl ? cEl.textContent.indexOf('团队汇总') >= 0 : false;
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

    // 6b) 「修改地址」必须真的能打开编辑器。
    //     曾经出现过 editBox 创建了但没有 appendChild 到页面上的 bug：
    //     点「修改地址」切换的是一个游离节点，界面上毫无反应。
    //     只断言「按钮存在」抓不到这种问题，必须真点一次并检查可见性。
    window.App.switchView('settings');
    const realSyncStatus = window.API.syncStatus;
    window.API.syncStatus = function () {
      return Promise.resolve({
        serverUrl: 'http://192.168.0.106:8787', loggedIn: true,
        lastPulledAt: 0, lastPushedAt: 0,
      });
    };
    window.Modules.settings.render();
    await new Promise(function (r) { setTimeout(r, 500); });
    const setEl = document.getElementById('view-settings');
    function findByText(rootEl, sel, text) {
      return Array.prototype.filter.call(rootEl.querySelectorAll(sel), function (n) {
        return n.textContent.trim() === text;
      })[0];
    }
    function visible(node) {
      if (!node) return false;
      // offsetParent 为 null 通常意味着 display:none 或未挂载
      return node.offsetParent !== null || node.getClientRects().length > 0;
    }
    out.editAddr = {};
    out.editAddr.hasEditBtn = !!findByText(setEl, 'button', '修改地址');
    const saveBtnBefore = findByText(setEl, 'button', '保存地址');
    // 关键：按钮必须挂在页面上（游离节点 querySelector 找不到）
    out.editAddr.saveBtnAttached = !!saveBtnBefore;
    out.editAddr.saveBtnHiddenBefore = !!saveBtnBefore && !visible(saveBtnBefore);

    const editBtnEl = findByText(setEl, 'button', '修改地址');
    if (editBtnEl) editBtnEl.click();
    const saveBtnAfter = findByText(setEl, 'button', '保存地址');
    out.editAddr.saveBtnVisibleAfterClick = visible(saveBtnAfter);
    // 地址输入框应预填当前服务器地址。
    // 注意：设置页里 AI / 邮件等卡片也有 text 输入框，不能取全页第一个 input，
    // 要从「保存地址」按钮往上找到它所在的编辑器容器再取。
    const editContainer = saveBtnAfter && saveBtnAfter.parentNode ? saveBtnAfter.parentNode.parentNode : null;
    const ipInputEl = editContainer ? editContainer.querySelector('input') : null;
    out.editAddr.ipPrefilled = !!ipInputEl && ipInputEl.value === 'http://192.168.0.106:8787';
    out.editAddr.ipValueFound = ipInputEl ? String(ipInputEl.value) : '(未找到输入框)';

    // 再点一次应收起
    if (editBtnEl) editBtnEl.click();
    out.editAddr.saveBtnHiddenAfterSecondClick = !visible(findByText(setEl, 'button', '保存地址'));

    // 还原真实的 syncStatus 桩，避免影响后续检查
    window.API.syncStatus = realSyncStatus;

    // 7) 「收件箱 → 待办 → 日程」的关联与流转：断言真实行为，而不只是元素存在
    //    （这些是用户抱怨「关联不人性化」的具体点）
    const S = window.Store;
    const LK = window.LinkUtil;
    out.link = {};
    function baseTodo(id, title, extra) {
      return Object.assign({
        id: id, title: title, description: '', status: 'pending', completedAt: null,
        createdAt: Date.now(), updatedAt: Date.now(), deadline: null, priority: 'medium',
        categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98', importance: 'important',
        repeat: { type: 'none', interval: 1, endDate: null }, reminds: [], remindBefore: 0,
        remindAt: null, estimatedMinutes: null,
      }, extra || {});
    }
    function buttonsOf(rootEl, text) {
      return Array.prototype.filter.call(rootEl.querySelectorAll('button'), function (b) {
        return b.textContent.indexOf(text) >= 0;
      });
    }

    // 7a) 收件箱：无截止时间的待办出现；手机收集来的带「手机收集」徽标
    S.addTodo(baseTodo('smoke-inbox-1', '冒烟-收件箱条目'));
    S.addTodo(baseTodo('smoke-inbox-mobile', '冒烟-手机收集条目', { source: 'mobile-inbox' }));
    window.App.switchView('inbox');
    const iEl = document.getElementById('view-inbox');
    out.link.inboxShowsItem = iEl.textContent.indexOf('冒烟-收件箱条目') >= 0;
    out.link.inboxShowsMobileBadge = iEl.textContent.indexOf('手机收集') >= 0;
    out.link.inboxHasSelectAll = buttonsOf(iEl, '全选').length > 0;

    // 7b) 批量整理：全选后出现批量操作栏
    const allBtn = buttonsOf(iEl, '全选')[0];
    if (allBtn) allBtn.click();
    const iEl2 = document.getElementById('view-inbox');
    out.link.batchBarHasSetToday = buttonsOf(iEl2, '设为今天').length > 0;
    out.link.batchBarShowsCount = iEl2.textContent.indexOf('已选') >= 0;

    // 7c) 批量「设为今天」→ 这些条目应带着截止时间离开收件箱
    const todayBtn = buttonsOf(iEl2, '设为今天')[0];
    if (todayBtn) todayBtn.click();
    const leftInInbox = LK.inboxTodos(S.get().todos).filter(function (t) {
      return t.id.indexOf('smoke-inbox') === 0;
    });
    out.link.batchRemovedFromInbox = leftInInbox.length;
    const movedToday = S.get().todos.filter(function (t) {
      return t.id.indexOf('smoke-inbox') === 0 && t.deadline != null;
    }).length;
    out.link.batchGotDeadline = movedToday;

    // 7d) 待办排到日程后：待办侧能看出「已排到日程」并给出去日程的入口
    S.addTodo(baseTodo('smoke-link-todo', '冒烟-联动待办', { deadline: Date.now() + 3600000, estimatedMinutes: 30 }));
    S.addEvent({
      id: 'smoke-link-event', status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
      title: '冒烟-联动待办', description: '', allDay: false,
      startTime: Date.now() + 3600000, endTime: Date.now() + 5400000, priority: 'medium',
      categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98',
      repeat: { type: 'none', interval: 1, endDate: null }, remindBefore: 0, reminds: [],
    });
    S.updateTodo('smoke-link-todo', { scheduledEventId: 'smoke-link-event' });
    window.App.switchView('todo');
    const tdEl = document.getElementById('view-todo');
    out.link.todoShowsScheduled = tdEl.textContent.indexOf('已排到日程') >= 0;
    out.link.todoHasGoScheduleBtn = buttonsOf(tdEl, '去日程').length > 0;

    // 7e) 日程侧反查：日视图里该时间块应带「来自待办」徽标
    window.App.switchView('schedule');
    window.Modules.schedule.goto(Date.now() + 3600000);
    const scEl = document.getElementById('view-schedule');
    out.link.scheduleShowsFromTodo = scEl.textContent.indexOf('来自待办') >= 0;

    // 7f) 状态联动：完成待办 → 关联日程也跟着完成（两边不该各说各话）
    out.link.eventStatusBefore = S.get().events.find(function (e) { return e.id === 'smoke-link-event'; }).status;
    const todoObj = S.get().todos.find(function (t) { return t.id === 'smoke-link-todo'; });
    window.Modules.todo.toggle(todoObj);
    out.link.eventStatusAfter = S.get().events.find(function (e) { return e.id === 'smoke-link-event'; }).status;

    // 7g) 悬空关联清理：日程被删后，待办不应再显示「已排到日程」
    S.deleteEvent('smoke-link-event');
    window.Modules.todo.render();
    const afterDel = S.get().todos.find(function (t) { return t.id === 'smoke-link-todo'; });
    out.link.danglingLinkCleared = !afterDel.scheduledEventId;
    window.App.switchView('todo');
    out.link.todoNoLongerShowsScheduled =
      document.getElementById('view-todo').textContent.indexOf('已排到日程') < 0;

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

  console.log('== 「修改地址」真的能打开编辑器（防「创建了但没挂到页面上」）==');
  const ea = result.editAddr || {};
  check('已登录态下有「修改地址」按钮', ea.hasEditBtn === true);
  check('★ 地址编辑器已挂载到页面（游离节点在此会判失败）', ea.saveBtnAttached === true);
  check('编辑器默认是收起的', ea.saveBtnHiddenBefore === true);
  check('★ 点「修改地址」后编辑器可见', ea.saveBtnVisibleAfterClick === true);
  check('编辑器预填当前服务器地址', ea.ipPrefilled === true, '实际值=' + ea.ipValueFound);
  check('再点一次收起', ea.saveBtnHiddenAfterSecondClick === true);

  console.log('== 客户页渲染（本版本新功能）==');
  check('客户页渲染无异常', result.customerError === null, result.customerError || '');
  check('客户页有内容', result.customerHtmlLen > 200, 'len=' + result.customerHtmlLen);
  check('客户页含标题「客户商机」', result.customerHasTitle === true);
  check('客户页含「新增客户」按钮', result.customerHasAddBtn === true);
  check('客户页含搜索框（团队共用商机库的刚需）', result.customerHasSearch === true);
  check('客户页含负责人筛选下拉', result.customerHasOwnerFilter === true);
  check('客户页含「今天该跟谁」跟进分桶（逾期/今天/本周/未安排）', result.customerHasBucketBar === true);
  check('客户页含「团队汇总（按负责人）」入口', result.customerHasTeamToggle === true);

  console.log('== 其余视图逐个渲染 ==');
  const errs = result.viewErrors || {};
  check('全部视图渲染无异常', Object.keys(errs).length === 0, JSON.stringify(errs));

  console.log('== 内嵌同步服务器 IPC ==');
  const st = result.syncServerStatus;
  check('syncServerStatus 返回状态对象', !!st && typeof st === 'object', result.syncServerStatusError || '');
  check('状态含局域网 IP 与配对码字段', !!st && Array.isArray(st.ips) && typeof st.pairingCode === 'string',
    st ? ('ips=' + JSON.stringify(st.ips) + ' code=' + st.pairingCode) : '无');

  console.log('== 收件箱 → 待办 → 日程：关联与流转（用户痛点）==');
  const lk = result.link || {};
  check('收件箱渲染出未整理条目', lk.inboxShowsItem === true);
  check('手机收集来的条目带「手机收集」徽标', lk.inboxShowsMobileBadge === true);
  check('收件箱有全选入口', lk.inboxHasSelectAll === true);
  check('全选后出现批量操作栏', lk.batchBarShowsCount === true && lk.batchBarHasSetToday === true);
  check('批量「设为今天」后条目带上截止时间', lk.batchGotDeadline >= 2, 'got=' + lk.batchGotDeadline);
  check('★ 批量整理后条目离开收件箱', lk.batchRemovedFromInbox === 0, 'left=' + lk.batchRemovedFromInbox);
  check('待办侧显示「已排到日程」', lk.todoShowsScheduled === true);
  check('待办侧给出去日程的入口', lk.todoHasGoScheduleBtn === true);
  check('日程侧显示「来自待办」', lk.scheduleShowsFromTodo === true);
  check('★ 完成待办后关联日程同步为已完成',
    lk.eventStatusBefore === 'pending' && lk.eventStatusAfter === 'done',
    lk.eventStatusBefore + ' -> ' + lk.eventStatusAfter);
  check('★ 日程被删后待办的悬空关联被清理', lk.danglingLinkCleared === true);
  check('悬空清理后待办不再显示「已排到日程」', lk.todoNoLongerShowsScheduled === true);

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
