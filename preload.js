/*
 * preload.js — 通过 contextBridge 向渲染进程暴露安全 API。
 * contextIsolation 开启，渲染进程只能通过 window.api 访问主进程能力。
 */
const { contextBridge, ipcRenderer } = require('electron');
const constants = require('./src/shared/constants.js');

contextBridge.exposeInMainWorld('api', {
  constants: constants,
  loadData: function () { return ipcRenderer.invoke('data:load'); },
  saveData: function (payload) { return ipcRenderer.invoke('data:save', payload); },
  exportData: function () { return ipcRenderer.invoke('data:export'); },
  importData: function () { return ipcRenderer.invoke('data:import'); },
  restoreData: function () { return ipcRenderer.invoke('data:restore'); },
  notify: function (opts) { return ipcRenderer.invoke('notify', opts); },
  onReminder: function (cb) { ipcRenderer.on('reminder', function (e, payload) { cb(payload); }); },
});
