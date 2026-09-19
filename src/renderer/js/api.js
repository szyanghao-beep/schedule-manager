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
  snoozeReminder: function (opts) { return window.api.snoozeReminder(opts); },
  emailSaveSettings: function (opts) { return window.api.emailSaveSettings(opts); },
  emailTest: function (opts) { return window.api.emailTest(opts); },
  emailStatus: function () { return window.api.emailStatus(); },
  aiSaveSettings: function (opts) { return window.api.aiSaveSettings(opts); },
  aiTest: function () { return window.api.aiTest(); },
  aiStatus: function () { return window.api.aiStatus(); },
  aiParse: function (opts) { return window.api.aiParse(opts); },
  onReminder: function (cb) { window.api.onReminder(cb); },
  onReminderAction: function (cb) { window.api.onReminderAction(cb); },
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
  // 内嵌同步服务器（本机作为同步中心）
  syncServerStatus: function () { return window.api.syncServerStatus(); },
  syncServerStart: function () { return window.api.syncServerStart(); },
  syncServerStop: function () { return window.api.syncServerStop(); },
};
