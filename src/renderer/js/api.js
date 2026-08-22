/*
 * api.js — 主进程 IPC 统一封装。渲染进程统一通过 window.API 访问，避免直接触 window.api。
 */
window.API = {
  constants: window.api.constants,
  loadData: function () { return window.api.loadData(); },
  saveData: function (p) { return window.api.saveData(p); },
  exportData: function () { return window.api.exportData(); },
  importData: function () { return window.api.importData(); },
  restoreData: function () { return window.api.restoreData(); },
  getStatsHistory: function () { return window.api.getStatsHistory(); },
  notify: function (opts) { return window.api.notify(opts); },
  onReminder: function (cb) { window.api.onReminder(cb); },
  onQuickCapture: function (cb) { window.api.onQuickCapture(cb); },
  // 同步
  loginSync: function (opts) { return window.api.loginSync(opts); },
  syncPull: function () { return window.api.syncPull(); },
  syncPush: function () { return window.api.syncPush(); },
  syncNow: function () { return window.api.syncNow(); },
  syncStatus: function () { return window.api.syncStatus(); },
  syncLogout: function () { return window.api.syncLogout(); },
  onSyncDataUpdated: function (cb) { window.api.onSyncDataUpdated(cb); },
  onSyncConflict: function (cb) { window.api.onSyncConflict(cb); },
};
