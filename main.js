/*
 * main.js — Electron 主进程
 * 职责：窗口管理、JSON 文件持久化、系统弹窗通知、定时提醒扫描、导入导出对话框、IPC。
 * 数据存储于 app.getPath('userData')，不污染源码目录。
 */
const { app, BrowserWindow, ipcMain, Notification, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const Utils = require('./src/renderer/js/utils.js');
const constants = require('./src/shared/constants.js');
const { DATA_VERSION, migrateData } = require('./src/shared/migrate.js');

const DATA_FILE = 'data.json';
const BACKUP_DIR = 'backup';
const MAX_BACKUPS = 10;
const REMINDER_INTERVAL = 30 * 1000; // 每 30s 扫描一次提醒

let mainWindow = null;
let data = null;      // 完整数据（含 notified，内部用）
let saveTimer = null;
let recovering = false; // 渲染进程崩溃重建中（抑制 window-all-closed 触发退出）
let lastCrashAt = 0;    // 上次渲染进程崩溃时间（10s 内不重复重建，防崩溃循环）
let tray = null;        // 系统托盘
let isQuitting = false; // 真正退出中（关闭窗口不再拦截为最小化）
let trayHintShown = false; // 首次最小化到托盘的提示只弹一次

// ---------- 路径 ----------
function dataFilePath() { return path.join(app.getPath('userData'), DATA_FILE); }
function backupDir() { return path.join(app.getPath('userData'), BACKUP_DIR); }

// ---------- 默认数据 ----------
function defaultData() {
  const categories = constants.DEFAULT_CATEGORIES.map(function (c) {
    return { id: Utils.genId(), name: c.name, color: c.color, isDefault: true, createdAt: Date.now() };
  });
  return {
    version: DATA_VERSION,
    categories: categories,
    events: [],
    todos: [],
    settings: { defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system' },
    statsHistory: [], // 每日四象限分布快照：{ date, q1..q4, total }
    notified: {}, // key(occurrence) -> 通知时间戳，用于去重
  };
}

// ---------- 加载 / 保存 ----------
function loadData() {
  try {
    const raw = fs.readFileSync(dataFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    migrateData(parsed); // 旧版本文件先迁移（无 version 视为 v1）
    data = Object.assign(defaultData(), parsed);
    // 深度合并 settings，确保新增默认字段（如 urgentThresholdHours）在旧数据上也能生效
    data.settings = Object.assign(defaultData().settings, parsed.settings || {});
    data.version = DATA_VERSION;
    if (parsed.version !== DATA_VERSION) scheduleSave(); // 迁移后立即落盘一次
  } catch (e) {
    data = defaultData();
  }
  // 清理上次崩溃可能残留的临时文件（原子写盘遗留）
  try {
    const tmp = dataFilePath() + '.tmp';
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch (e) { /* 忽略清理失败 */ }
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
    data.version = DATA_VERSION;
    // 原子写盘：先写临时文件再 rename 替换，避免写入中途崩溃损坏数据文件
    const file = dataFilePath();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('保存失败', e);
    try {
      const tmp = dataFilePath() + '.tmp';
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (e2) { /* 忽略清理失败 */ }
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
    version: data.version || DATA_VERSION,
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
  const q = Utils.calcQuadrantStats(data.todos, Date.now(), urgentThresholdMs());
  const last = data.statsHistory[data.statsHistory.length - 1];
  if (last && last.date === today) {
    // 当天内随时间变化，更新为最新快照（仅在有变化时落盘，避免频繁写文件）
    if (last.q1 !== q.q1 || last.q2 !== q.q2 || last.q3 !== q.q3 || last.q4 !== q.q4 || last.total !== q.total) {
      last.q1 = q.q1; last.q2 = q.q2; last.q3 = q.q3; last.q4 = q.q4; last.total = q.total;
      scheduleSave();
    }
    return;
  }
  data.statsHistory.push({ date: today, q1: q.q1, q2: q.q2, q3: q.q3, q4: q.q4, total: q.total });
  if (data.statsHistory.length > 90) data.statsHistory = data.statsHistory.slice(-90);
  scheduleSave();
}

// ---------- IPC ----------
function applyImported(parsed) {
  if (!parsed || !Array.isArray(parsed.events) || !Array.isArray(parsed.todos)) {
    return '文件格式不正确：缺少 events/todos 数组';
  }
  migrateData(parsed); // 导入/恢复旧版本备份时先迁移到当前 schema
  data.categories = Array.isArray(parsed.categories) ? parsed.categories : [];
  data.events = parsed.events;
  data.todos = parsed.todos;
  data.settings = Object.assign(defaultData().settings, parsed.settings || {});
  data.statsHistory = Array.isArray(parsed.statsHistory) ? parsed.statsHistory : [];
  data.notified = {};
  data.version = DATA_VERSION;
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

// ---------- 托盘 ----------
function iconPath() { return path.join(__dirname, 'build', 'icon.png'); }

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(iconPath());
    const size = process.platform === 'win32' ? 16 : 22;
    tray = new Tray(img.resize({ width: size, height: size }));
    tray.setToolTip('日程管理');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开日程管理', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: function () { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
  } catch (e) {
    console.error('创建托盘失败', e);
    tray = null;
  }
}

// ---------- 窗口 ----------
function createWindow() {
  const winIcon = fs.existsSync(iconPath()) ? iconPath() : undefined;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '日程管理',
    icon: winIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 关闭 preload 沙箱，使 preload 可 require 相对路径的常量文件
    },
  });
  // 关闭窗口默认最小化到托盘（真正退出走托盘菜单 / before-quit；托盘不可用时直接关闭）
  mainWindow.on('close', function (e) {
    if (isQuitting || !tray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      if (Notification.isSupported()) {
        new Notification({ title: '日程管理', body: '已最小化到系统托盘，可从托盘图标重新打开' }).show();
      }
    }
  });
  // 渲染进程日志/错误转发到主进程 stdout，便于开发排查
  mainWindow.webContents.on('console-message', function (event) {
    console.log('[renderer]', event.message);
  });
  mainWindow.webContents.on('did-finish-load', function () { console.log('[main] renderer loaded'); });
  mainWindow.webContents.on('did-fail-load', function (event, code, desc) { console.error('[main] load failed', code, desc); });
  // 渲染进程崩溃兜底：自动重建窗口（数据在主进程内存中并已防抖落盘，崩溃不丢数据）
  mainWindow.webContents.on('render-process-gone', function (event, details) {
    const reason = details && details.reason;
    console.error('[main] renderer process gone:', reason);
    if (reason === 'clean-exit') return; // 主动正常退出（如 devtools 关闭）不重建
    const now = Date.now();
    if (now - lastCrashAt < 10 * 1000) { lastCrashAt = now; return; } // 防崩溃循环
    lastCrashAt = now;
    try {
      if (Notification.isSupported()) {
        new Notification({ title: '日程管理', body: '窗口异常退出，正在自动恢复…' }).show();
      }
    } catch (e) { /* 忽略 */ }
    recovering = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    createWindow();
    recovering = false;
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  mainWindow.on('closed', function () { mainWindow = null; });
}

app.whenReady().then(function () {
  if (process.platform === 'win32') app.setAppUserModelId('com.schedule.manager'); // Windows 通知/任务栏身份
  loadData();
  registerIpc();
  createWindow();
  createTray();
  checkReminders(); // 启动即查一次
  setInterval(checkReminders, REMINDER_INTERVAL);
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', function () { isQuitting = true; });

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin' && !recovering) app.quit();
});
