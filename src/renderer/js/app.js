/*
 * app.js — 渲染进程入口：数据加载、模块路由、全局初始化。
 */
window.App = (function () {
  'use strict';

  const MODULES = {
    schedule: window.Modules.schedule,
    todo: window.Modules.todo,
    customer: window.Modules.customer,
    plan: window.Modules.plan,
    inbox: window.Modules.inbox,
    review: window.Modules.review,
    memorials: window.Modules.memorials,
    bookkeeping: window.Modules.bookkeeping,
    search: window.Modules.search,
    stats: window.Modules.stats,
    settings: window.Modules.settings,
    admin: window.Modules.admin,
  };
  let currentView = 'schedule';
  // 当前账号的访问控制信息（来自主进程 sync:status；未登录时视为普通用户 + 全部功能）
  let access = { loggedIn: false, isAdmin: false, permissions: null };
  // 新手引导还没结束时先不弹功能提示卡，免得引导弹窗和提示卡一起冒出来
  let tipsReady = false;

  function renderCurrent() {
    const mod = MODULES[currentView];
    if (mod && mod.render) mod.render();
  }

  // 按角色与权限控制导航项显隐：
  //   - 「用户管理」只给管理员；
  //   - 其余按 permissions 过滤（「设置」永远可见，否则用户没法看引导/改密码）；
  //   - 未登录时不做任何隐藏（纯本地使用不该被权限限制）。
  // 注意：这只是界面层的体验优化，真正的权限校验在服务端。
  function applyAccessControl() {
    const navs = Array.prototype.slice.call(document.querySelectorAll('.nav-item'));
    const P = window.PermUtil;
    let firstVisible = null;

    navs.forEach(function (btn) {
      const view = btn.dataset.view;
      let visible;
      if (view === 'admin') {
        visible = !!access.isAdmin;
      } else if (!access.loggedIn) {
        visible = true;
      } else {
        visible = P.canAccess(access.permissions, view);
      }
      btn.hidden = !visible;
      if (visible && !firstVisible) firstVisible = view;
    });

    // 当前视图被隐藏了（比如刚被管理员取消权限）→ 切到第一个可见视图
    const currentBtn = navs.find(function (b) { return b.dataset.view === currentView; });
    if (currentBtn && currentBtn.hidden && firstVisible) switchView(firstVisible);
  }

  function loadAccess() {
    return API.syncStatus().then(function (st) {
      access = {
        loggedIn: !!(st && st.loggedIn),
        isAdmin: !!(st && st.isAdmin),
        permissions: st ? st.permissions : null,
      };
      applyAccessControl();
      return access;
    }).catch(function () { return access; });
  }

  // 应用主题：settings.theme = light | dark | system（跟随系统）
  function applyTheme() {
    const theme = (Store.get().settings && Store.get().settings.theme) || 'system';
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function init() {
    // 数据变更 -> 重绘当前视图 + 应用主题
    Store.subscribe(function () { applyTheme(); renderCurrent(); });

    // 系统提醒 -> 轻提示 + 刷新
    API.onReminder(function () {
      Toast.info('有日程/任务到提醒时间');
      renderCurrent();
    });

    // 点击通知 -> 定位到条目并弹出操作条（完成 / 稍后）
    API.onReminderAction(function (payload) {
      showReminderAction(payload || {});
    });

    // 全局快捷键快速捕捉 -> 打开收件箱快速捕捉弹窗
    API.onQuickCapture(function () {
      switchView('inbox');
      if (MODULES.inbox && MODULES.inbox.openQuickCapture) MODULES.inbox.openQuickCapture();
    });

    // 同步拉取到新数据 -> 重新加载并刷新
    API.onSyncDataUpdated(function () {
      API.loadData().then(function (loaded) {
        Store.set(loaded);
        Toast.info('已同步最新数据');
      });
    });

    // 同步冲突：本地修改被其他设备覆盖 -> 警告提示
    API.onSyncConflict(function (conflicts) {
      if (!conflicts || !conflicts.length) return;
      const names = conflicts.map(function (c) { return c.title || c.id; }).slice(0, 3).join('、');
      const more = conflicts.length > 3 ? ' 等 ' + conflicts.length + ' 条' : '';
      Toast.warning('有 ' + conflicts.length + ' 条记录被其他设备更新：' + names + more);
    });

    // 每日邮件当天放弃重试 -> 让用户知道「邮件为什么没来」（此前只有控制台日志）
    API.onEmailReminderFailed(function (payload) {
      Toast.error((payload && payload.message) || '每日邮件发送失败，请到设置中检查邮件配置');
    });

    // 本机局域网地址变了（换网络/换主机）-> 提示更新其它设备上填的地址，
    // 并告知是否已自动改用回环地址（回环不会随网段变化失效）
    API.onLanAddressChanged(function (n) {
      if (!n) return;
      const parts = [];
      if (n.previousIps && n.previousIps.length && n.currentIps && n.currentIps.length) {
        parts.push('本机地址已变：' + n.previousIps.join('/') + ' → ' + n.currentIps.join('/'));
      }
      if (n.repaired) {
        parts.push('同步地址已自动切到 ' + n.repaired.to + '（不受网段变化影响）');
      }
      parts.push('手机或其它设备需填新地址，可在「设置 → 本机同步服务」查看');
      Toast.warning(parts.join('；'));
    });

    // 导航切换
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.dataset.view); });
    });

    // Ctrl+F / Cmd+F 唤起搜索
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        switchView('search');
        if (MODULES.search && MODULES.search.focus) MODULES.search.focus();
      }
    });

    // 加载数据后进入默认视图
    API.loadData().then(function (loaded) {
      Store.set(loaded);
      applyTheme();
      return loadAccess();
    }).then(function () {
      switchView('schedule');
      // 新手引导：只在第一次（或引导版本更新后）自动弹出，老用户点「跳过引导」即可
      if (window.Guide) {
        if (window.Guide.shouldShowOnboarding()) {
          window.Guide.openOnboarding({});
        } else {
          tipsReady = true;
        }
      }
    });

    // 跟随系统时，系统主题切换即时生效
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = function () {
      if ((Store.get().settings && Store.get().settings.theme) === 'system') applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else if (mq.addListener) mq.addListener(onSystemThemeChange); // 旧浏览器兜底
  }

  function switchView(view) {
    // 无权限/不可见的视图不允许切入（快捷键、引导跳转等入口都走这里）
    const target = document.querySelector('.nav-item[data-view="' + view + '"]');
    if (target && target.hidden) return;

    currentView = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(function (s) {
      s.classList.toggle('active', s.id === 'view-' + view);
    });
    renderCurrent();
    // 进入功能时给初学者一句「这是做什么的」；看过/关过的不会再弹
    if (tipsReady && window.Guide) window.Guide.showTip(view);
  }

  // 引导结束（完成或跳过）后，功能提示卡才开始工作
  function onGuideDone() { tipsReady = true; }

  // 点击通知：定位到对应视图并弹出「操作条」（完成 / 稍后 10 分钟 / 稍后 1 小时）
  function showReminderAction(payload) {
    const id = payload.id;
    if (!id) return;
    const entityType = payload.entityType === 'todo' ? 'todo' : 'event';
    const record = (entityType === 'todo'
      ? Store.get().todos.find(function (t) { return t.id === id; })
      : Store.get().events.find(function (e) { return e.id === id; }));
    if (!record) {
      Toast.info('提醒条目已不存在');
      return;
    }
    switchView(entityType === 'todo' ? 'todo' : 'schedule');

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = record.title || '';
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';
    body.appendChild(title);
    const hint = document.createElement('div');
    hint.className = 'item-meta';
    hint.textContent = entityType === 'todo' ? '待办提醒' : '日程提醒';
    body.appendChild(hint);

    const btns = document.createElement('div');
    btns.style.marginTop = '16px';

    function btn(label, cls, onClick) {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.style.marginRight = '8px';
      b.addEventListener('click', onClick);
      return b;
    }

    btns.appendChild(btn('完成', 'btn-primary', function () {
      if (entityType === 'todo') Store.updateTodo(id, { status: 'done', completedAt: Date.now() });
      else Store.updateEvent(id, { status: 'done' });
      window.Modal.close();
      Toast.success('已完成');
    }));
    btns.appendChild(btn('稍后 10 分钟', '', function () { snooze(10); }));
    btns.appendChild(btn('稍后 1 小时', '', function () { snooze(60); }));
    body.appendChild(btns);

    function snooze(minutes) {
      API.snoozeReminder({ id: id, minutes: minutes }).then(function () {
        window.Modal.close();
        Toast.success('已稍后 ' + minutes + ' 分钟');
      });
    }

    window.Modal.open({ title: '提醒操作', content: body, okText: false });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    switchView: switchView,
    getView: function () { return currentView; },
    // 登录/退出/被改权限后调用：重新拉取角色与权限并刷新导航显隐
    refreshAccess: function () { return loadAccess(); },
    getAccess: function () { return access; },
    onGuideDone: onGuideDone,
    // 供测试与引导判断用
    isTipsReady: function () { return tipsReady; },
    setTipsReady: function (v) { tipsReady = !!v; },
  };
})();
