/*
 * preload.js — 通过 contextBridge 向渲染进程暴露安全 API。
 * contextIsolation 开启，渲染进程只能通过 window.api 访问主进程能力。
 */
const { contextBridge, ipcRenderer } = require('electron');
const constants = require('./shared/constants.js');

contextBridge.exposeInMainWorld('api', {
  constants: constants,
  loadData: function () { return ipcRenderer.invoke('data:load'); },
  saveData: function (payload) { return ipcRenderer.invoke('data:save', payload); },
  exportData: function () { return ipcRenderer.invoke('data:export'); },
  importData: function () { return ipcRenderer.invoke('data:import'); },
  restoreData: function () { return ipcRenderer.invoke('data:restore'); },
  getStatsHistory: function () { return ipcRenderer.invoke('data:statsHistory'); },
  notify: function (opts) { return ipcRenderer.invoke('notify', opts); },
  snoozeReminder: function (opts) { return ipcRenderer.invoke('reminder:snooze', opts); },
  emailSaveSettings: function (opts) { return ipcRenderer.invoke('email:save-settings', opts); },
  emailTest: function (opts) { return ipcRenderer.invoke('email:test', opts); },
  emailStatus: function () { return ipcRenderer.invoke('email:status'); },
  aiSaveSettings: function (opts) { return ipcRenderer.invoke('ai:save-settings', opts); },
  aiTest: function () { return ipcRenderer.invoke('ai:test'); },
  aiStatus: function () { return ipcRenderer.invoke('ai:status'); },
  aiParse: function (opts) { return ipcRenderer.invoke('ai:parse', opts); },
  onReminder: function (cb) { ipcRenderer.on('reminder', function (e, payload) { cb(payload); }); },
  onReminderAction: function (cb) { ipcRenderer.on('reminder-action', function (e, payload) { cb(payload); }); },
  onQuickCapture: function (cb) { ipcRenderer.on('quick-capture', function () { cb(); }); },
  // 同步
  loginSync: function (opts) { return ipcRenderer.invoke('sync:login', opts); },
  syncPull: function () { return ipcRenderer.invoke('sync:pull'); },
  syncPush: function () { return ipcRenderer.invoke('sync:push'); },
  syncNow: function () { return ipcRenderer.invoke('sync:now'); },
  syncStatus: function () { return ipcRenderer.invoke('sync:status'); },
  syncLogout: function () { return ipcRenderer.invoke('sync:logout'); },
  onSyncDataUpdated: function (cb) { ipcRenderer.on('sync-data-updated', function () { cb(); }); },
  onSyncConflict: function (cb) { ipcRenderer.on('sync-conflicts', function (e, payload) { cb(payload); }); },
});
