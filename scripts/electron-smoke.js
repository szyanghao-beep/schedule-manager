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

    // 8) 新手引导与功能提示（用户需求：第一次使用有指引、老用户可跳过）
    out.guide = {};
    // 本轮冒烟用隔离的 userData，localStorage 也是全新的 → 首次启动应该自动弹引导
    out.guide.onboardingShown = !!document.querySelector('#modal-root .modal');
    out.guide.onboardingTitle = (document.querySelector('#modal-root .modal-title') || {}).textContent || '';
    const guideBtnTexts = Array.prototype.map.call(
      document.querySelectorAll('#modal-root .modal-body button'), function (b) { return b.textContent.trim(); });
    out.guide.hasSkip = guideBtnTexts.indexOf('跳过引导') >= 0;
    out.guide.hasNext = guideBtnTexts.indexOf('下一步') >= 0;

    // 点「跳过引导」→ 关闭并记住（老用户不该反复被打扰）
    const skipBtn = Array.prototype.find.call(
      document.querySelectorAll('#modal-root .modal-body button'), function (b) { return b.textContent.trim() === '跳过引导'; });
    if (skipBtn) skipBtn.click();
    out.guide.closedAfterSkip = !document.querySelector('#modal-root .modal');
    try {
      const raw = window.localStorage.getItem('schedule.guide.v1');
      out.guide.persisted = !!(raw && JSON.parse(raw).doneVersion >= 1);
    } catch (e) { out.guide.persisted = false; }

    // 跳过之后进入功能 → 出现「这是做什么的」提示卡
    window.App.switchView('todo');
    const tipEl = document.querySelector('#guide-root .guide-tip');
    out.guide.tipShown = !!tipEl;
    out.guide.tipTitle = (document.querySelector('#guide-root .guide-tip-title') || {}).textContent || '';
    out.guide.tipBadge = (document.querySelector('#guide-root .guide-tip-badge') || {}).textContent || '';
    out.guide.tipExplains = !!tipEl && tipEl.textContent.indexOf('四象限') >= 0;

    // 「不再提示」→ 卡片消失并记住；切到别的功能仍会提示
    const neverBtn = Array.prototype.find.call(
      document.querySelectorAll('#guide-root button'), function (b) { return b.textContent.trim() === '不再提示'; });
    if (neverBtn) neverBtn.click();
    out.guide.tipClosedByNever = !document.querySelector('#guide-root .guide-tip');
    try {
      const raw2 = window.localStorage.getItem('schedule.guide.v1');
      out.guide.neverPersisted = !!(raw2 && JSON.parse(raw2).dismissedTips && JSON.parse(raw2).dismissedTips.todo);
    } catch (e) { out.guide.neverPersisted = false; }
    window.App.switchView('stats');
    out.guide.otherViewStillTips = (document.querySelector('#guide-root .guide-tip-title') || {}).textContent === '统计';
    // 切回已关闭的功能 → 不该残留上一个功能的卡（错位）
    window.App.switchView('todo');
    out.guide.noStaleTipOnDismissedView = !document.querySelector('#guide-root .guide-tip');
    window.Guide.closeTip();

    // 9) 权限：未登录时不做限制；管理员登录后出现「用户管理」入口
    out.access = {};
    out.access.adminHiddenWhenLoggedOut = !!document.querySelector('.nav-item-admin').hidden;
    // 注意：这里要排除「用户管理」——它不是功能模块，未登录时本就该隐藏。
    // 「不做权限限制」指的是各功能模块全部可见，纯本地使用不受影响。
    out.access.allModulesVisibleWhenLoggedOut = Array.prototype.every.call(
      document.querySelectorAll('.nav-item:not(.nav-item-admin)'), function (b) { return !b.hidden; });

    const savedSyncStatus = window.API.syncStatus;
    const savedAdminList = window.API.adminListUsers;
    window.API.syncStatus = function () {
      return Promise.resolve({
        serverUrl: 'http://192.168.0.106:8787', loggedIn: true, lastPulledAt: 0, lastPushedAt: 0,
        userId: 1, username: '管理员甲', role: 'admin', isAdmin: true,
        permissions: ['schedule', 'todo', 'customer', 'plan', 'inbox', 'review', 'memorials', 'bookkeeping', 'search', 'stats'],
      });
    };
    window.API.adminListUsers = function () {
      return Promise.resolve({
        users: [
          { id: 9, username: 'admin', displayName: '超级管理员', role: 'super', status: 'active',
            permissions: [], createdAt: Date.now() - 3 * 86400000, lastLoginAt: Date.now(), recordCount: 0, isSelf: false },
          { id: 1, username: 'admin1', displayName: '管理员甲', role: 'admin', status: 'active',
            permissions: ['todo'], createdAt: Date.now() - 86400000, lastLoginAt: Date.now(), recordCount: 36, isSelf: true },
          { id: 2, username: 'bob', displayName: '', role: 'user', status: 'disabled',
            permissions: ['todo', 'stats'], createdAt: Date.now(), lastLoginAt: 0, recordCount: 4, isSelf: false },
        ],
        me: 1,
      });
    };
    window.API.adminOverview = function () {
      return Promise.resolve({
        totalUsers: 3, activeUsers: 2, disabledUsers: 1, adminUsers: 2, totalRecords: 40,
        superAdmin: { exists: true, username: 'admin', status: 'active', usingDefaultPassword: true },
      });
    };
    await window.App.refreshAccess();
    out.access.adminVisibleForAdmin = !document.querySelector('.nav-item-admin').hidden;
    window.App.switchView('admin');
    window.Modules.admin.render();
    await new Promise(function (r) { setTimeout(r, 300); });
    const aEl = document.getElementById('view-admin');
    out.access.adminRendered = aEl.textContent.indexOf('用户管理') >= 0;
    out.access.adminShowsUsers = aEl.textContent.indexOf('admin1') >= 0 && aEl.textContent.indexOf('bob') >= 0;
    out.access.adminStats = Array.prototype.map.call(
      aEl.querySelectorAll('.stat-value'), function (n) { return n.textContent.trim(); });
    out.access.selfProtected = Array.prototype.some.call(
      aEl.querySelectorAll('button'), function (b) { return b.textContent.trim() === '停用账号' && b.disabled; });
    out.access.canEnableDisabled = Array.prototype.some.call(
      aEl.querySelectorAll('button'), function (b) { return b.textContent.trim() === '启用账号'; });

    // 内置超级管理员：徽标 + 危险操作全部禁用 + 默认密码安全告警
    out.access.superBadgeShown = aEl.textContent.indexOf('超级管理员') >= 0;
    out.access.defaultPasswordWarning = aEl.textContent.indexOf('安全提醒') >= 0;
    out.access.warningMentionsEnv = aEl.textContent.indexOf('SUPER_ADMIN_PASSWORD') >= 0;
    const superRow = Array.prototype.find.call(aEl.querySelectorAll('.card'), function (c) {
      // 注意：安全告警卡片里也含「超级管理员」字样，所以要按「有操作按钮的账号行」来定位
      return c.querySelector('button') && Array.prototype.some.call(c.querySelectorAll('.badge'), function (b) {
        return b.textContent.trim() === '超级管理员';
      });
    });
    out.access.superRowProtected = !!superRow && ['停用账号', '取消管理员', '删除', '设置权限'].every(function (label) {
      const btn = Array.prototype.find.call(superRow.querySelectorAll('button'), function (b) {
        return b.textContent.trim() === label;
      });
      return !!btn && btn.disabled === true;
    });

    // 普通用户：管理员入口隐藏，且无权限的模块导航也隐藏
    window.API.syncStatus = function () {
      return Promise.resolve({
        serverUrl: 'http://192.168.0.106:8787', loggedIn: true, lastPulledAt: 0, lastPushedAt: 0,
        userId: 2, username: 'bob', role: 'user', isAdmin: false, permissions: ['todo', 'stats'],
      });
    };
    await window.App.refreshAccess();
    out.access.adminHiddenForUser = !!document.querySelector('.nav-item-admin').hidden;
    out.access.visibleViewsForUser = Array.prototype.filter.call(
      document.querySelectorAll('.nav-item'), function (b) { return !b.hidden; })
      .map(function (b) { return b.dataset.view; });
    window.App.switchView('admin');
    out.access.userCannotOpenAdmin = window.App.getView() !== 'admin';

    // 还原，避免影响后续检查
    window.API.syncStatus = savedSyncStatus;
    window.API.adminListUsers = savedAdminList;
    await window.App.refreshAccess();

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

  console.log('== 新手引导与功能提示（用户需求：首次指引 / 老用户可跳过）==');
  const gd = result.guide || {};
  check('首次启动自动弹出引导', gd.onboardingShown === true && gd.onboardingTitle.indexOf('欢迎') >= 0,
    gd.onboardingTitle);
  check('引导可跳过（老用户不被反复打扰）', gd.hasSkip === true);
  check('引导有「下一步」可逐步看', gd.hasNext === true);
  check('★ 点「跳过引导」后关闭且状态被记住', gd.closedAfterSkip === true && gd.persisted === true);
  check('★ 跳过之后进入功能会弹「这是做什么的」提示卡',
    gd.tipShown === true && gd.tipBadge === '这是做什么的', gd.tipBadge);
  check('提示卡内容确实在解释该功能', gd.tipExplains === true);
  check('「不再提示」关闭该功能的提示并记住', gd.tipClosedByNever === true && gd.neverPersisted === true);
  check('其他功能仍会提示', gd.otherViewStillTips === true);
  check('切回已关闭的功能时不残留上一个功能的提示卡', gd.noStaleTipOnDismissedView === true);

  console.log('== 多账号：管理员与普通用户的界面分离 ==');
  const ac = result.access || {};
  check('未登录时隐藏「用户管理」入口', ac.adminHiddenWhenLoggedOut === true);
  check('未登录时各功能模块不受限制（纯本地使用不受影响）', ac.allModulesVisibleWhenLoggedOut === true);
  check('★ 管理员登录后出现「用户管理」入口', ac.adminVisibleForAdmin === true);
  check('用户管理页渲染账号列表', ac.adminRendered === true && ac.adminShowsUsers === true);
  check('统计数字正确（3 账号 / 2 启用 / 2 管理员 含超管）',
    JSON.stringify(ac.adminStats) === JSON.stringify(['3', '2', '2', '40']), JSON.stringify(ac.adminStats));
  check('★ 不能停用当前登录账号（按钮禁用）', ac.selfProtected === true);
  check('已停用账号显示「启用账号」', ac.canEnableDisabled === true);
  check('★ 内置超级管理员显示「超级管理员」徽标', ac.superBadgeShown === true);
  check('★ 超级管理员的停用/降级/删除/权限按钮全部禁用', ac.superRowProtected === true);
  check('★ 仍用默认密码时显示安全告警', ac.defaultPasswordWarning === true && ac.warningMentionsEnv === true);
  check('★ 普通用户看不到「用户管理」入口', ac.adminHiddenForUser === true);
  check('★ 普通用户只能看到授权的功能模块',
    JSON.stringify(ac.visibleViewsForUser) === JSON.stringify(['todo', 'stats', 'settings']),
    JSON.stringify(ac.visibleViewsForUser));
  check('普通用户切不进用户管理', ac.userCannotOpenAdmin === true);

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
