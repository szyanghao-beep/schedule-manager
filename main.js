/*
 * main.js — Electron 主进程
 * 职责：窗口管理、JSON 文件持久化、系统弹窗通知、定时提醒扫描、导入导出对话框、IPC。
 * 数据存储于 app.getPath('userData')，不污染源码目录。
 */
const { app, BrowserWindow, ipcMain, Notification, dialog, Tray, Menu, nativeImage, safeStorage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const Utils = require('./shared/utils.js');
const constants = require('./shared/constants.js');
const { DATA_VERSION, migrateData } = require('./shared/migrate.js');
const sync = require('./shared/sync.js');

const DATA_FILE = 'data.json';
const BACKUP_DIR = 'backup';
const MAX_BACKUPS = 10;
const REMINDER_INTERVAL = 30 * 1000; // 每 30s 扫描一次提醒
const SYNC_STATE_FILE = 'sync-state.json'; // 同步登录态与游标（独立于 data.json）
const SETTINGS_ID = 'settings'; // 同步的 settings 记录 id（共享偏好：四象限阈值/默认提醒）

let mainWindow = null;
let data = null;      // 完整数据（含 notified，内部用）
let saveTimer = null;
let recovering = false; // 渲染进程崩溃重建中（抑制 window-all-closed 触发退出）
let lastCrashAt = 0;    // 上次渲染进程崩溃时间（10s 内不重复重建，防崩溃循环）
let tray = null;        // 系统托盘
let isQuitting = false; // 真正退出中（关闭窗口不再拦截为最小化）
let trayHintShown = false; // 首次最小化到托盘的提示只弹一次
let syncState = { serverUrl: '', token: '', lastPulledAt: 0, lastPushedAt: 0 }; // 同步配置与游标

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
    settingsMeta: { updatedAt: 0, localModifiedAt: 0 }, // settings 同步游标（theme 为设备本地偏好不同步）
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
    if (!data.settingsMeta || typeof data.settingsMeta !== 'object') {
      data.settingsMeta = { updatedAt: 0, localModifiedAt: 0 };
    }
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

// ---------- 同步 ----------
function syncStatePath() { return path.join(app.getPath('userData'), SYNC_STATE_FILE); }

function syncAuthed() { return !!(syncState.serverUrl && syncState.token); }

// 持久化同步登录态与游标（token 用系统安全存储加密，避免明文落盘）
function persistSyncState() {
  try {
    const toStore = {
      serverUrl: syncState.serverUrl,
      lastPulledAt: syncState.lastPulledAt,
      lastPushedAt: syncState.lastPushedAt,
      tokenEncrypted: '',
    };
    if (syncState.token) {
      if (safeStorage.isEncryptionAvailable()) {
        toStore.tokenEncrypted = safeStorage.encryptString(syncState.token).toString('base64');
      } else {
        // 系统无安全存储（如部分 Linux 无 keyring）时退化为 base64，仍避免明文直存
        toStore.tokenEncrypted = 'plain:' + Buffer.from(syncState.token, 'utf-8').toString('base64');
      }
    }
    fs.writeFileSync(syncStatePath(), JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (e) {
    console.error('同步状态保存失败', e);
  }
}

function loadSyncState() {
  try {
    const raw = fs.readFileSync(syncStatePath(), 'utf-8');
    const s = JSON.parse(raw);
    syncState.serverUrl = s.serverUrl || '';
    syncState.lastPulledAt = s.lastPulledAt || 0;
    syncState.lastPushedAt = s.lastPushedAt || 0;
    if (s.tokenEncrypted) {
      if (s.tokenEncrypted.startsWith('plain:')) {
        syncState.token = Buffer.from(s.tokenEncrypted.slice(6), 'base64').toString('utf-8');
      } else if (safeStorage.isEncryptionAvailable()) {
        syncState.token = safeStorage.decryptString(Buffer.from(s.tokenEncrypted, 'base64'));
      }
    }
  } catch (e) {
    // 首次运行或无状态，忽略
  }
}

// settings 被本地修改：更新同步游标（theme 是设备本地偏好，不随此同步）
function touchSettings() {
  const now = Date.now();
  data.settingsMeta.updatedAt = now;
  data.settingsMeta.localModifiedAt = now;
}

// 提取本地修改的变更（用 localModifiedAt，客户端时间轴，避免与服务端时间混用）
function buildLocalChanges(since) {
  const changes = []
    .concat(sync.extractLocalChanges(data.categories, sync.ENTITY_TYPES.CATEGORY, since))
    .concat(sync.extractLocalChanges(data.events, sync.ENTITY_TYPES.EVENT, since))
    .concat(sync.extractLocalChanges(data.todos, sync.ENTITY_TYPES.TODO, since));
  // settings 作为单条 SETTING 记录同步（只同步共享偏好：紧急阈值 / 默认提醒）
  if (data.settingsMeta && data.settingsMeta.localModifiedAt > since) {
    changes.push({
      entityType: sync.ENTITY_TYPES.SETTING,
      id: SETTINGS_ID,
      deleted: false,
      updatedAt: data.settingsMeta.updatedAt,
      data: {
        id: SETTINGS_ID,
        urgentThresholdHours: data.settings.urgentThresholdHours,
        defaultRemindBefore: data.settings.defaultRemindBefore,
      },
    });
  }
  return changes;
}

// 记录业务内容指纹（忽略同步元字段），用于判断「本地修改是否被远程内容替换」
function recordContentKey(rec) {
  const o = Object.assign({}, rec);
  delete o.updatedAt;
  delete o.localModifiedAt;
  delete o.entityType;
  delete o.deleted;
  delete o.id;
  return JSON.stringify(o);
}

// 把远程变更 LWW 合并进本地数据（含软删除墓碑），并检测「本地修改被远程覆盖」的冲突
function applyRemoteChanges(changes) {
  const map = new Map();
  sync.recordsToMap(data.categories, sync.ENTITY_TYPES.CATEGORY).forEach(function (v, k) { map.set(k, v); });
  sync.recordsToMap(data.events, sync.ENTITY_TYPES.EVENT).forEach(function (v, k) { map.set(k, v); });
  sync.recordsToMap(data.todos, sync.ENTITY_TYPES.TODO).forEach(function (v, k) { map.set(k, v); });

  // 合并前快照「本地已修改（localModifiedAt>0）」记录的指纹，合并后比对，
  // 若内容被远程版本替换即视为冲突（用户本地编辑被别的设备覆盖）。
  const dirty = new Map();
  map.forEach(function (rec, key) {
    if ((rec.localModifiedAt || 0) > 0 && !rec.deleted) {
      dirty.set(key, { contentKey: recordContentKey(rec), title: rec.title || '' });
    }
  });

  sync.mergeChanges(map, changes);
  data.categories = sync.liveRecords(map, sync.ENTITY_TYPES.CATEGORY);
  data.events = sync.liveRecords(map, sync.ENTITY_TYPES.EVENT);
  data.todos = sync.liveRecords(map, sync.ENTITY_TYPES.TODO);

  const conflicts = [];
  dirty.forEach(function (before, key) {
    const after = map.get(key);
    if (!after || after.deleted) return; // 墓碑删除是正常删除，不提示
    if (recordContentKey(after) !== before.contentKey) {
      conflicts.push({ entityType: after.entityType, id: after.id, title: after.title || before.title || '' });
    }
  });

  // settings：若服务端有更新的设置记录则采纳（仅共享字段，theme 保持本地）
  const settingsRecs = sync.liveRecords(map, sync.ENTITY_TYPES.SETTING);
  const remoteSettings = settingsRecs[0];
  if (remoteSettings) {
    const remoteUpdated = sync.recordTime(remoteSettings);
    if (remoteUpdated > (data.settingsMeta.updatedAt || 0)) {
      if (remoteSettings.urgentThresholdHours != null) data.settings.urgentThresholdHours = remoteSettings.urgentThresholdHours;
      if (remoteSettings.defaultRemindBefore != null) data.settings.defaultRemindBefore = remoteSettings.defaultRemindBefore;
      data.settingsMeta.updatedAt = remoteUpdated;
    }
  }

  if (conflicts.length > 0) {
    notifyConflict(conflicts);
  }
}

// 通知渲染进程存在同步冲突（本地修改被远程覆盖）
function notifyConflict(conflicts) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('sync-conflicts', conflicts);
  }
}

async function syncRequest(method, path, body) {
  const res = await fetch(syncState.serverUrl + path, {
    method: method,
    headers: Object.assign(
      { 'Authorization': 'Bearer ' + syncState.token },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

function notifyRendererRefresh() {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('sync-data-updated');
  }
}

async function syncPull() {
  if (!syncAuthed()) throw new Error('未配置同步服务器');
  const json = await syncRequest('GET', '/api/sync?since=' + syncState.lastPulledAt);
  applyRemoteChanges(json.changes || []);
  if (json.serverTime != null) syncState.lastPulledAt = json.serverTime;
  persistData();
  persistSyncState();
  notifyRendererRefresh();
  return { pulled: (json.changes || []).length };
}

async function syncPush() {
  if (!syncAuthed()) throw new Error('未配置同步服务器');
  const changes = buildLocalChanges(syncState.lastPushedAt);
  if (changes.length > 0) {
    await syncRequest('POST', '/api/sync', { changes: changes });
  }
  syncState.lastPushedAt = Date.now();
  persistSyncState();
  return { pushed: changes.length };
}

// 统一同步：先推后拉（本地修改先上服务器，再拉其他设备的变更）
async function syncNow() {
  if (!syncAuthed()) throw new Error('未配置同步服务器');
  const pushed = await syncPush();
  const pulled = await syncPull();
  return { pushed: pushed.pushed, pulled: pulled.pulled };
}

// 自动推送：本地数据变更后防抖触发（仅已登录），让桌面端修改无需手动点「立即同步」
let autoPushTimer = null;
function scheduleAutoPush() {
  if (!syncAuthed()) return;
  clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(function () {
    syncPush().catch(function (e) { console.error('自动同步推送失败', e); });
  }, 2000);
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
  // 导入/恢复的数据标记为「本地修改」，使下次同步能上传（否则 extractLocalChanges 会因
  // 缺少 localModifiedAt 而跳过，导致导入的数据永远停留在本地）。
  const now = Date.now();
  [data.categories, data.events, data.todos].forEach(function (arr) {
    arr.forEach(function (r) {
      if (!r.updatedAt) r.updatedAt = now;
      r.localModifiedAt = now;
    });
  });
  data.settingsMeta = { updatedAt: now, localModifiedAt: now };
  persistData();
  scheduleAutoPush();
  return null;
}

function registerIpc() {
  ipcMain.handle('data:load', function () { return publicData(); });

  ipcMain.handle('data:statsHistory', function () {
    return { statsHistory: data.statsHistory || [] };
  });

  ipcMain.handle('data:save', function (e, payload) {
    if (payload && typeof payload === 'object') {
      // 防御性校验：只接受形状正确的字段，损坏/异常 payload 不污染内存数据
      if (Array.isArray(payload.categories)) data.categories = payload.categories;
      if (Array.isArray(payload.events)) data.events = payload.events;
      if (Array.isArray(payload.todos)) data.todos = payload.todos;
      if (payload.settings && typeof payload.settings === 'object') {
        const merged = Object.assign(defaultData().settings, payload.settings);
        if (JSON.stringify(merged) !== JSON.stringify(data.settings)) {
          data.settings = merged;
          touchSettings(); // 共享偏好（阈值/默认提醒）变更也参与同步
        }
      }
    }
    scheduleSave();
    scheduleAutoPush(); // 本地数据变更后自动推送（已登录时）
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

  // ---------- 同步 IPC ----------
  ipcMain.handle('sync:login', async function (e, opts) {
    opts = opts || {};
    if (!opts.serverUrl || !opts.username || !opts.password) {
      throw new Error('请填写服务器地址、用户名和密码');
    }
    syncState.serverUrl = String(opts.serverUrl).replace(/\/+$/, '');
    const path = opts.register ? '/api/auth/register' : '/api/auth/login';
    const json = await syncRequest('POST', path, { username: opts.username, password: opts.password });
    syncState.token = json.token;
    syncState.lastPulledAt = 0; // 登录后下次同步从全量开始
    syncState.lastPushedAt = 0;
    persistSyncState();
    return { token: json.token, user: json.user };
  });

  ipcMain.handle('sync:pull', function () { return syncPull(); });
  ipcMain.handle('sync:push', function () { return syncPush(); });
  ipcMain.handle('sync:now', function () { return syncNow(); });

  ipcMain.handle('sync:status', function () {
    return {
      serverUrl: syncState.serverUrl,
      loggedIn: !!syncState.token,
      lastPulledAt: syncState.lastPulledAt,
      lastPushedAt: syncState.lastPushedAt,
    };
  });

  ipcMain.handle('sync:logout', function () {
    syncState = { serverUrl: '', token: '', lastPulledAt: 0, lastPushedAt: 0 };
    persistSyncState();
    return true;
  });
}

// ---------- 全局快速捕捉（GTD 收件箱） ----------
// 注册系统级快捷键，随时随地唤起「快速捕捉」弹窗，把一闪而过的想法先丢进收件箱。
function registerQuickCapture() {
  try {
    const ok = globalShortcut.register('CommandOrControl+Shift+N', function () {
      showMainWindow();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('quick-capture');
      }
    });
    if (!ok) console.error('快速捕捉快捷键注册失败（可能已被其他程序占用）');
  } catch (e) {
    console.error('快速捕捉快捷键注册异常', e);
  }
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
  loadSyncState(); // 恢复上次的同步登录态与游标（token 已加密持久化）
  registerIpc();
  createWindow();
  createTray();
  registerQuickCapture(); // 全局快速捕捉快捷键
  checkReminders(); // 启动即查一次
  setInterval(checkReminders, REMINDER_INTERVAL);
  // 启动自动同步：已登录时稍作延迟（等渲染层加载完），先推后拉
  if (syncAuthed()) {
    setTimeout(function () {
      syncNow().catch(function (e) { console.error('启动自动同步失败', e); });
    }, 3000);
  }
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', function () { isQuitting = true; });

app.on('will-quit', function () { globalShortcut.unregisterAll(); });

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin' && !recovering) app.quit();
});
