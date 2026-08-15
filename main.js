/*
 * main.js — Electron 主进程
 * 职责：窗口管理、JSON 文件持久化、系统弹窗通知、定时提醒扫描、导入导出对话框、IPC。
 * 数据存储于 app.getPath('userData')，不污染源码目录。
 */
const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Utils = require('./src/renderer/js/utils.js');
const constants = require('./src/shared/constants.js');

const DATA_FILE = 'data.json';
const BACKUP_DIR = 'backup';
const MAX_BACKUPS = 10;
const REMINDER_INTERVAL = 30 * 1000; // 每 30s 扫描一次提醒

let mainWindow = null;
let data = null;      // 完整数据（含 notified，内部用）
let saveTimer = null;

// ---------- 路径 ----------
function dataFilePath() { return path.join(app.getPath('userData'), DATA_FILE); }
function backupDir() { return path.join(app.getPath('userData'), BACKUP_DIR); }

// ---------- 默认数据 ----------
function defaultData() {
  const categories = constants.DEFAULT_CATEGORIES.map(function (c) {
    return { id: Utils.genId(), name: c.name, color: c.color, isDefault: true, createdAt: Date.now() };
  });
  return {
    categories: categories,
    events: [],
    todos: [],
    settings: { defaultRemindBefore: 15, urgentThresholdHours: 24 },
    statsHistory: [], // 每日四象限分布快照：{ date, q1..q4, total }
    notified: {}, // key(occurrence) -> 通知时间戳，用于去重
  };
}

// ---------- 加载 / 保存 ----------
function loadData() {
  try {
    const raw = fs.readFileSync(dataFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    data = Object.assign(defaultData(), parsed);
    // 深度合并 settings，确保新增默认字段（如 urgentThresholdHours）在旧数据上也能生效
    data.settings = Object.assign(defaultData().settings, parsed.settings || {});
  } catch (e) {
    data = defaultData();
  }
}

function pruneNotified() {
  // 清理 7 天前的通知记录，避免无限增长
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  Object.keys(data.notified).forEach(function (k) {
    if (data.notified[k] < cutoff) delete data.notified[k];
  });
}

function backupData() {
  try {
    if (!fs.existsSync(dataFilePath())) return; // 首次保存无需备份
    const bdir = backupDir();
    if (!fs.existsSync(bdir)) fs.mkdirSync(bdir, { recursive: true });
    const stamp = Utils.toDateStr(Date.now()).replace(/-/g, '') + '-' + Utils.toTimeStr(Date.now()).replace(/:/g, '');
    fs.copyFileSync(dataFilePath(), path.join(bdir, 'data-' + stamp + '.json'));
    // 只保留最近 MAX_BACKUPS 份
    const files = fs.readdirSync(bdir).filter(function (f) { return f.endsWith('.json'); }).sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(bdir, files.shift()));
    }
  } catch (e) {
    console.error('备份失败', e);
  }
}

function persistData() {
  try {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    pruneNotified();
    backupData();
    fs.writeFileSync(dataFilePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存失败', e);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { persistData(); } catch (e) { console.error('保存失败', e); }
  }, 500);
}

function publicData() {
  return {
    categories: data.categories,
    events: data.events,
    todos: data.todos,
    settings: data.settings,
    statsHistory: data.statsHistory || [],
  };
}

// ---------- 提醒 ----------
function buildReminderBody(kind, item, occ) {
  if (kind === 'todo') return '截止于 ' + Utils.toDateTimeStr(occ.startTime) + ' · 提前 ' + item.remindBefore + ' 分钟提醒';
  const time = item.allDay ? '全天' : '开始于 ' + Utils.toDateTimeStr(occ.startTime);
  return time + ' · 提前 ' + item.remindBefore + ' 分钟提醒';
}

function showNotification(kind, item, occ) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: item.title, body: buildReminderBody(kind, item, occ) });
  n.on('click', function () {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  n.show();
  // 通知渲染进程高亮/刷新
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('reminder', { id: item.id, key: occ.key });
  }
}

function checkReminders() {
  if (!data) return;
  snapshotStats();
  const now = Date.now();
  const list = [];
  data.events.forEach(function (e) { list.push({ kind: 'event', item: e, startTime: e.startTime, endTime: e.endTime }); });
  data.todos.forEach(function (t) {
    if (t.status === 'done') return; // 已完成待办不再提醒
    list.push({ kind: 'todo', item: t, startTime: t.deadline, endTime: t.deadline });
  });

  list.forEach(function (entry) {
    const item = entry.item;
    const remindBefore = item.remindBefore || 0;
    if (!remindBefore || entry.startTime == null) return;
    // 归一化：待办用 deadline 作为基准时间展开重复
    const norm = {
      id: item.id, startTime: entry.startTime, endTime: entry.endTime,
      repeat: item.repeat, allDay: item.allDay, exceptions: item.exceptions,
    };
    Utils.expandOccurrences(norm, { from: now, to: now + remindBefore * 60 * 1000 + 60 * 1000 }).forEach(function (occ) {
      const remindAt = occ.startTime - remindBefore * 60 * 1000;
      if (now >= remindAt && now < occ.startTime && !data.notified[occ.key]) {
        data.notified[occ.key] = now;
        showNotification(entry.kind, item, occ);
        scheduleSave();
      }
    });
  });
}

// ---------- 四象限历史快照 ----------
function urgentThresholdMs() {
  const h = data && data.settings && data.settings.urgentThresholdHours;
  return (h != null ? h : 24) * 3600 * 1000;
}

// 每日记录一次四象限分布，随时间推移累积历史趋势
function snapshotStats() {
  if (!data) return;
  if (!Array.isArray(data.statsHistory)) data.statsHistory = [];
  const today = Utils.toDateStr(Date.now());
  const last = data.statsHistory[data.statsHistory.length - 1];
  if (last && last.date === today) return; // 当天已快照
  const q = Utils.calcQuadrantStats(data.todos, Date.now(), urgentThresholdMs());
  data.statsHistory.push({ date: today, q1: q.q1, q2: q.q2, q3: q.q3, q4: q.q4, total: q.total });
  if (data.statsHistory.length > 90) data.statsHistory = data.statsHistory.slice(-90);
  scheduleSave();
}

// ---------- IPC ----------
function applyImported(parsed) {
  if (!parsed || !Array.isArray(parsed.events) || !Array.isArray(parsed.todos)) {
    return '文件格式不正确：缺少 events/todos 数组';
  }
  data.categories = Array.isArray(parsed.categories) ? parsed.categories : [];
  data.events = parsed.events;
  data.todos = parsed.todos;
  data.settings = Object.assign(defaultData().settings, parsed.settings || {});
  data.statsHistory = Array.isArray(parsed.statsHistory) ? parsed.statsHistory : [];
  data.notified = {};
  persistData();
  return null;
}

function registerIpc() {
  ipcMain.handle('data:load', function () { return publicData(); });

  ipcMain.handle('data:statsHistory', function () {
    return { statsHistory: data.statsHistory || [] };
  });

  ipcMain.handle('data:save', function (e, payload) {
    if (payload && typeof payload === 'object') {
      data.categories = payload.categories || data.categories;
      data.events = payload.events || data.events;
      data.todos = payload.todos || data.todos;
      data.settings = payload.settings || data.settings;
    }
    scheduleSave();
    return true;
  });

  ipcMain.handle('data:export', async function () {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出数据',
      defaultPath: '日程数据备份-' + Utils.toDateStr(Date.now()) + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(publicData(), null, 2), 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('data:import', async function () {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '导入数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    try {
      const raw = fs.readFileSync(res.filePaths[0], 'utf-8');
      const err = applyImported(JSON.parse(raw));
      if (err) return { ok: false, error: err };
      return { ok: true, data: publicData() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('data:restore', async function () {
    const bdir = backupDir();
    if (!fs.existsSync(bdir)) return { ok: false, error: '暂无备份文件' };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件恢复',
      defaultPath: bdir,
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    try {
      const raw = fs.readFileSync(res.filePaths[0], 'utf-8');
      const err = applyImported(JSON.parse(raw));
      if (err) return { ok: false, error: err };
      return { ok: true, data: publicData() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('notify', function (e, opts) {
    if (Notification.isSupported() && opts && opts.title) {
      new Notification({ title: opts.title, body: opts.body || '' }).show();
    }
    return true;
  });
}

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '日程管理',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 关闭 preload 沙箱，使 preload 可 require 相对路径的常量文件
    },
  });
  // 渲染进程日志/错误转发到主进程 stdout，便于开发排查
  mainWindow.webContents.on('console-message', function (event) {
    console.log('[renderer]', event.message);
  });
  mainWindow.webContents.on('did-finish-load', function () { console.log('[main] renderer loaded'); });
  mainWindow.webContents.on('did-fail-load', function (event, code, desc) { console.error('[main] load failed', code, desc); });
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  mainWindow.on('closed', function () { mainWindow = null; });
}

app.whenReady().then(function () {
  loadData();
  registerIpc();
  createWindow();
  checkReminders(); // 启动即查一次
  setInterval(checkReminders, REMINDER_INTERVAL);
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
