/*
 * app.js — 渲染进程入口：数据加载、模块路由、全局初始化。
 */
window.App = (function () {
  'use strict';

  const MODULES = {
    schedule: window.Modules.schedule,
    todo: window.Modules.todo,
    stats: window.Modules.stats,
    settings: window.Modules.settings,
  };
  let currentView = 'schedule';

  function renderCurrent() {
    const mod = MODULES[currentView];
    if (mod && mod.render) mod.render();
  }

  function init() {
    // 数据变更 -> 重绘当前视图
    Store.subscribe(function () { renderCurrent(); });

    // 系统提醒 -> 轻提示 + 刷新
    API.onReminder(function () {
      Toast.info('有日程/任务到提醒时间');
      renderCurrent();
    });

    // 导航切换
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.dataset.view); });
    });

    // 加载数据后进入默认视图
    API.loadData().then(function (loaded) {
      Store.set(loaded);
      switchView('schedule');
    });
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
