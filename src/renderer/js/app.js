/*
 * app.js — 渲染进程入口：数据加载、模块路由、全局初始化。
 */
window.App = (function () {
  'use strict';

  const MODULES = {
    schedule: window.Modules.schedule,
    todo: window.Modules.todo,
    plan: window.Modules.plan,
    inbox: window.Modules.inbox,
    review: window.Modules.review,
    memorials: window.Modules.memorials,
    bookkeeping: window.Modules.bookkeeping,
    search: window.Modules.search,
    stats: window.Modules.stats,
    settings: window.Modules.settings,
  };
  let currentView = 'schedule';

  function renderCurrent() {
    const mod = MODULES[currentView];
    if (mod && mod.render) mod.render();
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
      switchView('schedule');
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
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(function (s) {
      s.classList.toggle('active', s.id === 'view-' + view);
    });
    renderCurrent();
  }

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

  return { switchView: switchView, getView: function () { return currentView; } };
})();
