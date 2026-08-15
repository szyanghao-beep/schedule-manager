/*
 * app.js — 渲染进程入口：数据加载、模块路由、全局初始化。
 */
window.App = (function () {
  'use strict';

  const MODULES = {
    schedule: window.Modules.schedule,
    todo: window.Modules.todo,
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

  document.addEventListener('DOMContentLoaded', init);

  return { switchView: switchView, getView: function () { return currentView; } };
})();
