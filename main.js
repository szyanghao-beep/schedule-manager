/*
 * main.js — Electron 主进程
 * 职责：窗口管理、JSON 文件持久化、系统弹窗通知、定时提醒扫描、导入导出对话框、IPC。
 * 数据存储于 app.getPath('userData')，不污染源码目录。
 */
const { app, BrowserWindow, ipcMain, Notification, dialog, Tray, Menu, nativeImage, safeStorage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Utils = require('./shared/utils.js');
const constants = require('./shared/constants.js');
const { DATA_VERSION, migrateData } = require('./shared/migrate.js');
const sync = require('./shared/sync.js');
const inboxUtil = require('./shared/inbox.js');
const Permissions = require('./shared/permissions.js');
const nodemailer = require('nodemailer');
const { buildDailyDigest, shouldSendDailyEmail, dailyEmailGaveUp } = require('./shared/digest.js');
const LunarUtil = require('./shared/lunar.js');
const aiIndex = require('./ai/index.js');
const { derivePairingCode } = require('./server/src/inboxDrop.js');

// 测试/冒烟隔离：设置 SCHEDULE_USER_DATA_DIR 可覆盖用户数据目录，避免污染真实数据。
// 生产运行不设此变量，行为不变。必须在首次 app.getPath('userData') 前设置。
if (process.env.SCHEDULE_USER_DATA_DIR) {
  app.setPath('userData', process.env.SCHEDULE_USER_DATA_DIR);
}

const DATA_FILE = 'data.json';
const BACKUP_DIR = 'backup';
const MAX_BACKUPS = 10;
const PRESYNC_DIR = 'presync';   // 同步前快照（单独目录 + 单独轮换，避免被日常备份挤掉）
const MAX_PRESYNC = 20;
const REMINDER_INTERVAL = 30 * 1000; // 每 30s 扫描一次提醒
const SYNC_STATE_FILE = 'sync-state.json'; // 同步登录态与游标（独立于 data.json）
const EMAIL_SECRET_FILE = 'email-secret.json'; // SMTP 密码（safeStorage 加密，独立于 data.json）
const AI_SECRET_FILE = 'ai-secret.json'; // AI API key（safeStorage 加密，独立于 data.json）
const SETTINGS_ID = 'settings'; // 同步的 settings 记录 id（共享偏好：四象限阈值/默认提醒）
const SYNC_SERVER_FILE = 'sync-server.json'; // 内嵌同步服务器开关/端口（独立于 data.json）

let mainWindow = null;
let data = null;      // 完整数据（含 notified，内部用）
let saveTimer = null;
let recovering = false; // 渲染进程崩溃重建中（抑制 window-all-closed 触发退出）
let lastCrashAt = 0;    // 上次渲染进程崩溃时间（10s 内不重复重建，防崩溃循环）
let tray = null;        // 系统托盘
let isQuitting = false; // 真正退出中（关闭窗口不再拦截为最小化）
let trayHintShown = false; // 首次最小化到托盘的提示只弹一次
// 同步配置与游标。
// 多账号管理（v2.3.5）起还保存当前登录账号的 userId/role/permissions：
// 渲染层据此决定「是否显示用户管理入口」「隐藏哪些无权限的功能模块」。
// 权限一律以服务端为准（登录与 /api/auth/me 都会回传），本地只做展示层过滤 ——
// 真正的拦截在服务端，客户端隐藏只是体验层面的事。
let syncState = {
  serverUrl: '', token: '', lastPulledAt: 0, lastPushedAt: 0,
  userId: null, role: 'user', permissions: null, displayName: '',
};
let emailSecret = { password: '' }; // SMTP 授权码/密码（仅内存 + 加密落盘）
let emailSending = false; // 发送中防重入（避免 30s 轮询期间重复发送）
let aiSecret = { apiKey: '' }; // AI API key（仅内存 + 加密落盘）
let syncServer = null;      // 内嵌同步服务器 http.Server 实例（null=未运行）
let syncServerDb = null;    // node:sqlite 数据库（服务器关闭时 close）
let syncServerState = { enabled: false, port: 8787, running: false, error: '', lastIps: [] }; // 内嵌服务器开关与状态

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
    settings: {
      defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system',
      emailReminder: { enabled: false, time: '08:00', to: '' }, // 每日邮件摘要开关/时间/收件人
      emailSmtp: { host: '', port: 465, secure: true, user: '', fromName: '' }, // SMTP 服务器配置（密码另存）
      ai: { enabled: false, provider: 'ollama', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }, // AI 自然语言（API key 另存）
      calendar: Object.assign({}, constants.CALENDAR_DEFAULTS), // 农历/节气/节假日/休息日影响规划开关
      bookkeeping: Object.assign({}, constants.BOOKKEEPING_DEFAULTS), // 记账默认账户/币种
      holidayData: {}, // 自定义节假日覆盖（'YYYY-MM-DD' -> { name, isWork }），新年度手动导入（A5）
    },
    settingsMeta: { updatedAt: 0, localModifiedAt: 0 }, // settings 同步游标（theme 为设备本地偏好不同步）
    statsHistory: [], // 每日四象限分布快照：{ date, q1..q4, total }
    accounts: [], // 2.3.0 记账账户
    transactions: [], // 2.3.0 收支流水
    bookkeepingCategories: [], // 2.3.0 记账分类（独立于日程分类）
    budgets: [], // 2.3.0 预算
    memorials: [], // 2.3.0 生日/纪念日
    customers: [], // 2.3.2 客户商机（含金额流水 amountHistory / 阶段留痕 stageHistory）
    followups: [], // 2.3.2 跟进记录（每次跟进 + 下次跟进时间）
    notified: {}, // key(occurrence) -> 通知时间戳，用于去重
    snoozed: {}, // key -> { kind, id, title, at }，稍后提醒（到点重弹）
    emailLastSentDate: '', // 每日邮件上次发送日期（YYYY-MM-DD），用于当天去重
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
    // 深度合并 email 子对象，避免旧数据缺字段时丢失默认值
    data.settings.emailReminder = Object.assign(defaultData().settings.emailReminder, data.settings.emailReminder || {});
    data.settings.emailSmtp = Object.assign(defaultData().settings.emailSmtp, data.settings.emailSmtp || {});
    data.settings.ai = Object.assign(defaultData().settings.ai, data.settings.ai || {});
    data.settings.calendar = Object.assign(defaultData().settings.calendar, data.settings.calendar || {});
    data.settings.bookkeeping = Object.assign(defaultData().settings.bookkeeping, data.settings.bookkeeping || {});
    if (!data.settings.holidayData || typeof data.settings.holidayData !== 'object' || Array.isArray(data.settings.holidayData)) {
      data.settings.holidayData = {};
    }
    if (typeof data.emailLastSentDate !== 'string') data.emailLastSentDate = '';
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
    fs.copyFileSync(dataFilePath(), path.join(bdir, 'data-' + backupStamp() + '.json'));
    // 只保留最近 MAX_BACKUPS 份
    const files = fs.readdirSync(bdir).filter(function (f) {
      return f.endsWith('.json') && f.indexOf('data-') === 0;
    }).sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(bdir, files.shift()));
    }
  } catch (e) {
    console.error('备份失败', e);
  }
}

// 备份文件名时间戳：精确到秒 + 毫秒尾数
// 只精确到分钟时，同一分钟内的多次保存会**互相覆盖**同一个备份文件
// （同步紧接着一次编辑时，就可能把「编辑前」的那份覆盖掉，回滚点丢失）。
function backupStamp() {
  const d = new Date();
  const p = function (n, w) { return String(n).padStart(w || 2, '0'); };
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3);
}

// 同步前快照：**每次真正发起同步之前**先把当前 data.json 原样存一份。
//
// 为什么单独做（而不是只靠 persistData 里的备份）：
//   1. persistData 的备份是「写盘前顺手存一份」，写盘时机很多（每次编辑都会触发），
//      10 份轮换很容易把「同步前那一刻」的状态挤掉；同步是唯一能删数据的操作，
//      它的回滚点必须独立保留。
//   2. 同步失败/被护栏拦下时，用户最需要的就是「同步前那一份」。
// 单独目录 + 单独轮换（20 份），所以不会被日常备份挤掉。
function snapshotBeforeSync(reason) {
  try {
    const src = dataFilePath();
    if (!fs.existsSync(src)) return null; // 还没落过盘，没什么可快照
    const dir = path.join(backupDir(), PRESYNC_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const name = 'presync-' + backupStamp() + (reason ? '-' + reason : '') + '.json';
    const dest = path.join(dir, name);
    fs.copyFileSync(src, dest);
    const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).sort();
    while (files.length > MAX_PRESYNC) {
      fs.unlinkSync(path.join(dir, files.shift()));
    }
    return dest;
  } catch (e) {
    console.error('同步前快照失败', e);
    return null;
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
    accounts: data.accounts || [],
    transactions: data.transactions || [],
    bookkeepingCategories: data.bookkeepingCategories || [],
    budgets: data.budgets || [],
    memorials: data.memorials || [],
    customers: data.customers || [],
    followups: data.followups || [],
  };
}

// ---------- 提醒 ----------
function buildReminderBody(kind, item, occ, mode, remindBefore) {
  if (mode === 'at') {
    const anchor = kind === 'todo' ? item.deadline : item.startTime;
    return '指定时间提醒' + (anchor != null ? ' · ' + Utils.toDateTimeStr(anchor) : '');
  }
  const advance = Utils.formatRemind(remindBefore != null ? remindBefore : item.remindBefore);
  if (kind === 'todo') return '截止于 ' + Utils.toDateTimeStr(occ.startTime) + ' · ' + advance;
  const time = item.allDay ? '全天' : '开始于 ' + Utils.toDateTimeStr(occ.startTime);
  return time + ' · ' + advance;
}

function showNotification(kind, item, occ, mode, remindBefore) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: item.title, body: buildReminderBody(kind, item, occ, mode, remindBefore) });
  n.on('click', function () {
    showMainWindow();
    // 点击通知 -> 通知渲染进程定位并弹出操作条（完成 / 稍后）
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('reminder-action', { entityType: kind, id: item.id, title: item.title });
    }
  });
  n.show();
  // 通知渲染进程高亮/刷新
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('reminder', { id: item.id, key: occ.key });
  }
}

// ---------- 纪念日提醒（A4） ----------
// 按「下一次发生日期」提前 remindBeforeDays 天提醒一次（农历生日经 lunarDateToSolar 换算）。
function showMemorialNotification(m, occ) {
  if (!Notification.isSupported()) return;
  const kindLabel = constants.MEMORIAL_KIND_LABEL[m.kind] || '纪念日';
  const remain = LunarUtil.countdownDays(occ.ts, Date.now());
  const parts = [kindLabel];
  if (m.name) parts.push(m.name);
  if (occ.age != null) parts.push(occ.age + ' 岁');
  parts.push(remain > 0 ? '还有 ' + remain + ' 天' : '就在今天');
  const n = new Notification({ title: '纪念日提醒', body: parts.join(' · ') });
  n.on('click', function () { showMainWindow(); });
  n.show();
}

function checkMemorialReminders(now) {
  if (!Array.isArray(data.memorials)) return;
  const DAY = 24 * 3600 * 1000;
  data.memorials.forEach(function (m) {
    if (!m || m.deleted) return;
    const advance = Number(m.remindBeforeDays);
    if (!isFinite(advance) || advance <= 0) return; // 0 或未设置 = 不提醒
    const occ = LunarUtil.nextMemorialOccurrence(m, now);
    if (!occ) return;
    const remindAt = occ.ts - advance * DAY;
    // 提醒窗口：[occ.ts - advance 天, occ.ts + 1 天)；每年每纪念日只提醒一次（按发生日期去重）
    if (now >= remindAt && now < occ.ts + DAY) {
      const key = 'memorial:' + m.id + ':' + occ.ts;
      if (!data.notified[key]) {
        data.notified[key] = now;
        showMemorialNotification(m, occ);
        scheduleSave();
      }
    }
  });
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

    // 提前量提醒（reminds 数组，兼容旧 remindBefore；相对截止/开始时间）
    const reminds = Utils.effectiveReminds(item);
    if (reminds.length && entry.startTime != null) {
      // 归一化：待办用 deadline 作为基准时间展开重复
      const norm = {
        id: item.id, startTime: entry.startTime, endTime: entry.endTime,
        repeat: item.repeat, allDay: item.allDay, exceptions: item.exceptions,
      };
      const maxBefore = Math.max.apply(null, reminds); // 展开窗口取最远提前量
      Utils.expandOccurrences(norm, { from: now, to: now + maxBefore * 60 * 1000 + 60 * 1000 }).forEach(function (occ) {
        reminds.forEach(function (remindBefore) {
          const remindAt = occ.startTime - remindBefore * 60 * 1000;
          const key = occ.key + ':' + remindBefore; // 去重键含提前量，避免同一实例多条提醒互相覆盖
          if (now >= remindAt && now < occ.startTime && !data.notified[key]) {
            data.notified[key] = now;
            showNotification(entry.kind, item, occ, null, remindBefore);
            scheduleSave();
          }
        });
      });
    }

    // 指定时间点提醒（remindAt，绝对时间戳）；错过后 24h 内补发，超时则丢弃
    const at = item.remindAt;
    if (at != null) {
      const key = item.id + '@at:' + at;
      if (now >= at && now < at + 24 * 3600 * 1000 && !data.notified[key]) {
        data.notified[key] = now;
        showNotification(entry.kind, item, { key: key, startTime: at }, 'at');
        scheduleSave();
      }
    }
  });

  // 纪念日提前提醒（A4）
  checkMemorialReminders(now);

  // 稍后提醒（snooze）：到点重新弹出一次
  const snoozed = data.snoozed || {};
  Object.keys(snoozed).forEach(function (key) {
    const s = snoozed[key];
    if (s && now >= s.at) {
      if (Notification.isSupported()) {
        const n = new Notification({ title: s.title || '稍后提醒', body: '稍后提醒 · ' + (s.kind === 'todo' ? '待办' : '日程') });
        n.on('click', function () {
          showMainWindow();
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('reminder-action', { entityType: s.kind, id: s.id, title: s.title });
          }
        });
        n.show();
      }
      delete snoozed[key];
      scheduleSave();
    }
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

// 清掉登录态（保留 serverUrl，便于重新登录时预填）。角色/权限一并清空，
// 否则退出登录后界面还会残留「用户管理」入口。
function clearSyncAuth() {
  syncState.token = '';
  syncState.userId = null;
  syncState.role = 'user';
  syncState.permissions = null;
  syncState.displayName = '';
  syncState.lastPulledAt = 0;
  syncState.lastPushedAt = 0;
  persistSyncState();
}

// 记录当前登录账号（服务端回传的权威信息）
function setSyncUser(user) {
  if (!user) return;
  syncState.userId = user.id != null ? user.id : null;
  syncState.role = Permissions.normalizeRole(user.role);
  // permissions 为数组时按设置来；未设置（null/''）解析为「全部功能」
  syncState.permissions = Permissions.resolvePermissions(
    user.permissions != null ? user.permissions : user.permissionsRaw
  );
  syncState.displayName = user.displayName || '';
}

// 当前账号是否管理员（未登录时按普通用户处理）
function syncIsAdmin() {
  return Permissions.isAdmin({ role: syncState.role });
}

// 归一化同步服务器地址（复用 shared 单一实现，与手机端容错保持一致）
function normalizeServerUrl(raw) {
  return Utils.normalizeServerUrl(raw);
}

// 持久化同步登录态与游标（token 用系统安全存储加密，避免明文落盘）
function persistSyncState() {
  try {
    const toStore = {
      serverUrl: syncState.serverUrl,
      lastPulledAt: syncState.lastPulledAt,
      lastPushedAt: syncState.lastPushedAt,
      // 角色/权限作为「离线缓存」落盘，便于启动瞬间就能正确渲染导航；
      // 但每次登录与 /api/auth/me 都会用服务端的权威值覆盖它。
      userId: syncState.userId,
      role: syncState.role,
      permissions: syncState.permissions,
      displayName: syncState.displayName,
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
    syncState.userId = s.userId != null ? s.userId : null;
    syncState.role = Permissions.normalizeRole(s.role);
    // 只有确实存过权限才覆盖；老版本的状态文件没这个字段，保持 null（= 全部功能）
    syncState.permissions = s.permissions === undefined ? null : s.permissions;
    syncState.displayName = s.displayName || '';
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

// ---------- 邮件提醒 ----------
function emailSecretPath() { return path.join(app.getPath('userData'), EMAIL_SECRET_FILE); }

// SMTP 密码用系统安全存储加密落盘（独立于 data.json，避免随数据导出/同步泄露）
function persistEmailSecret() {
  try {
    const toStore = { passwordEncrypted: '' };
    if (emailSecret.password) {
      if (safeStorage.isEncryptionAvailable()) {
        toStore.passwordEncrypted = safeStorage.encryptString(emailSecret.password).toString('base64');
      } else {
        toStore.passwordEncrypted = 'plain:' + Buffer.from(emailSecret.password, 'utf-8').toString('base64');
      }
    }
    fs.writeFileSync(emailSecretPath(), JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (e) {
    console.error('邮件密钥保存失败', e);
  }
}

function loadEmailSecret() {
  try {
    const raw = fs.readFileSync(emailSecretPath(), 'utf-8');
    const s = JSON.parse(raw);
    if (s.passwordEncrypted) {
      if (s.passwordEncrypted.startsWith('plain:')) {
        emailSecret.password = Buffer.from(s.passwordEncrypted.slice(6), 'base64').toString('utf-8');
      } else if (safeStorage.isEncryptionAvailable()) {
        emailSecret.password = safeStorage.decryptString(Buffer.from(s.passwordEncrypted, 'base64'));
      }
    }
  } catch (e) {
    // 首次运行或无密码，忽略
  }
}

// ---------- AI 密钥 ----------
function aiSecretPath() { return path.join(app.getPath('userData'), AI_SECRET_FILE); }

function persistAiSecret() {
  try {
    const toStore = { apiKeyEncrypted: '' };
    if (aiSecret.apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        toStore.apiKeyEncrypted = safeStorage.encryptString(aiSecret.apiKey).toString('base64');
      } else {
        toStore.apiKeyEncrypted = 'plain:' + Buffer.from(aiSecret.apiKey, 'utf-8').toString('base64');
      }
    }
    fs.writeFileSync(aiSecretPath(), JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (e) {
    console.error('AI 密钥保存失败', e);
  }
}

function loadAiSecret() {
  try {
    const raw = fs.readFileSync(aiSecretPath(), 'utf-8');
    const s = JSON.parse(raw);
    if (s.apiKeyEncrypted) {
      if (s.apiKeyEncrypted.startsWith('plain:')) {
        aiSecret.apiKey = Buffer.from(s.apiKeyEncrypted.slice(6), 'base64').toString('utf-8');
      } else if (safeStorage.isEncryptionAvailable()) {
        aiSecret.apiKey = safeStorage.decryptString(Buffer.from(s.apiKeyEncrypted, 'base64'));
      }
    }
  } catch (e) {
    // 首次运行或无 key，忽略
  }
}

function emailStatus() {
  const er = data.settings.emailReminder || {};
  const smtp = data.settings.emailSmtp || {};
  return {
    enabled: !!er.enabled,
    time: er.time || '08:00',
    to: er.to || '',
    host: smtp.host || '',
    port: smtp.port != null ? smtp.port : 465,
    secure: smtp.secure !== false,
    user: smtp.user || '',
    fromName: smtp.fromName || '',
    hasPassword: !!emailSecret.password,
    lastSentDate: data.emailLastSentDate || '',
    // 失败信息：让设置页能回答「每日邮件为什么没收到」。
    // 此前失败只写 console.error，打包后没有控制台，用户完全看不到原因。
    failCount: Number(er.failCount) || 0,
    failDate: er.failDate || '',
    lastError: er.lastError || '',
    lastErrorAt: er.lastErrorAt || 0,
    gaveUpToday: dailyEmailGaveUp({
      now: Date.now(), failCount: er.failCount, failDate: er.failDate,
    }),
  };
}

function smtpTransport() {
  const smtp = data.settings.emailSmtp || {};
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 465,
    secure: smtp.secure !== false,
    auth: { user: smtp.user, pass: emailSecret.password },
  });
}

async function sendMail(opts) {
  const smtp = data.settings.emailSmtp || {};
  const fromName = smtp.fromName || '日程管理';
  const transport = smtpTransport();
  await transport.sendMail({
    from: '"' + fromName + '" <' + smtp.user + '>',
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

// 每日邮件：到达配置时间且当天未发送过时，发送待办摘要
function checkEmailReminder() {
  if (!data) return;
  const er = data.settings && data.settings.emailReminder;
  const smtp = data.settings && data.settings.emailSmtp;
  const now = Date.now();
  if (!shouldSendDailyEmail({
    enabled: er && er.enabled,
    to: er && er.to,
    host: smtp && smtp.host,
    user: smtp && smtp.user,
    hasPassword: !!emailSecret.password,
    time: er && er.time,
    now: now,
    lastSentDate: data.emailLastSentDate,
    sending: emailSending,
    // 失败退避：避免认证失败后每 30 秒重撞一次 SMTP（一天约 2880 次，
    // 既刷日志也可能被服务商判定异常而锁号）
    failCount: er && er.failCount,
    failDate: er && er.failDate,
    lastAttemptAt: er && er.lastAttemptAt,
  })) return;

  const digest = buildDailyDigest(data, now);
  const today = Utils.toDateStr(now);
  emailSending = true;

  // 记一次尝试（失败信息落库，设置页能看到「为什么没收到邮件」）
  function markAttempt(err) {
    if (!data.settings.emailReminder) data.settings.emailReminder = {};
    const e = data.settings.emailReminder;
    if ((e.failDate || '') !== today) { e.failCount = 0; e.failDate = today; }
    e.failCount = (Number(e.failCount) || 0) + 1;
    e.lastAttemptAt = Date.now();
    if (err) {
      e.lastError = String((err && err.message) || err).slice(0, 300);
      e.lastErrorAt = Date.now();
    } else {
      e.lastError = '';
      e.lastErrorAt = 0;
    }
    scheduleSave();
    return e;
  }

  sendMail({ to: er.to, subject: digest.subject, text: digest.text, html: digest.html })
    .then(function () {
      data.emailLastSentDate = today;
      markAttempt(null); // 成功后清掉失败记录
      if (Notification.isSupported()) {
        new Notification({ title: '日程管理', body: '每日待办邮件已发送' }).show();
      }
    })
    .catch(function (e) {
      const erNow = markAttempt(e);
      console.error('每日邮件发送失败（第 ' + erNow.failCount + ' 次）', e);
      // 当天放弃时明确告知用户 —— 否则每日邮件一直不来，而失败只在控制台（打包后没有），
      // 用户根本无从知道原因。
      if (dailyEmailGaveUp({
        now: Date.now(),
        failCount: erNow.failCount,
        failDate: erNow.failDate,
      })) {
        const msg = '每日邮件今天已停止重试，请到「设置 → 邮件提醒」检查配置。原因：' +
          String((e && e.message) || e);
        console.error(msg);
        if (Notification.isSupported()) {
          new Notification({ title: '日程管理 · 每日邮件发送失败', body: msg }).show();
        }
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('email-reminder-failed', { message: msg });
        }
      }
    })
    .finally(function () { emailSending = false; });
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
    .concat(sync.extractLocalChanges(data.todos, sync.ENTITY_TYPES.TODO, since))
    .concat(sync.extractLocalChanges(data.customers || [], sync.ENTITY_TYPES.CUSTOMER, since))
    .concat(sync.extractLocalChanges(data.followups || [], sync.ENTITY_TYPES.FOLLOWUP, since));
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
  // 本批的推送游标 = 这批记录里最大的 localModifiedAt（见 sync.maxLocalModifiedAt）。
  // 推送成功后游标只能推进到这里，不能推到 Date.now()：推送在途时用户又改的那一条，
  // 时间戳比「推送完成时刻」早，用 Date.now() 会让它永远推不上去（别的设备看不到）。
  let cursor = 0;
  SYNC_ENTITIES.forEach(function (e) {
    const t = sync.maxLocalModifiedAt(data[e.field] || [], since);
    if (t > cursor) cursor = t;
  });
  if (data.settingsMeta) {
    const st = Number(data.settingsMeta.localModifiedAt) || 0;
    if (st > since && st > cursor) cursor = st;
  }
  return { changes: changes, cursor: cursor };
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

// 参与同步的实体（字段名 <-> 实体类型）。集中一处，避免推送/合并/校验三处各写一份而漏项。
const SYNC_ENTITIES = [
  { field: 'categories', type: sync.ENTITY_TYPES.CATEGORY },
  { field: 'events', type: sync.ENTITY_TYPES.EVENT },
  { field: 'todos', type: sync.ENTITY_TYPES.TODO },
  { field: 'customers', type: sync.ENTITY_TYPES.CUSTOMER },
  { field: 'followups', type: sync.ENTITY_TYPES.FOLLOWUP },
];

// 把远程变更 LWW 合并进本地数据（含软删除墓碑），并检测「本地修改被远程覆盖」的冲突。
//
// 返回值：true = 已采纳；false = **被护栏拦下、本地数据原样未动**。
//
// 护栏（为什么必须有）：同步是唯一能「删掉」本地数据的通道 —— 一旦合并逻辑有 bug
// （例如记录缺 id 时挤到同一个 key、或某处漏了字段），用户的数据就会被静默抹掉。
// 所以合并后先校验「记录数的减少是否能被抵达的墓碑解释」，解释不了就整批放弃。
function applyRemoteChanges(changes) {
  // 合并前快照「本地已修改（localModifiedAt>0）」记录的指纹，合并后比对，
  // 若内容被远程版本替换即视为冲突（用户本地编辑被别的设备覆盖）。
  const dirty = new Map();

  // 真正的合并与护栏都在 shared 里（同一份逻辑被单测覆盖，主进程不许另写一遍）。
  // allowTypes 里带上 setting：它不是数组集合（是个对象），所以不在 SYNC_ENTITIES 里，
  // 但确实要靠同步在两个端之间传（紧急阈值等），见下面的 settings 合并分支。
  const result = sync.mergeWithGuardrail(data, SYNC_ENTITIES, changes, {
    allowTypes: [sync.ENTITY_TYPES.SETTING],
    onBeforeMerge: function (preMap) {
      preMap.forEach(function (rec, key) {
        if ((rec.localModifiedAt || 0) > 0 && !rec.deleted) {
          dirty.set(key, { contentKey: recordContentKey(rec), title: rec.title || '' });
        }
      });
    },
  });
  const map = result.map;

  if (result.ignoredChanges > 0) {
    // 本端不认识的实体类型：忽略但必须留痕（可能是另一个版本/别的实现推来的，
    // 也可能是脏数据 —— 静默忽略会让问题查不出来）
    console.warn('[sync] 忽略了 ' + result.ignoredChanges + ' 条本端不处理的实体变更：' +
      result.ignoredTypes.join(', '));
  }

  if (!result.ok) {
    const violations = result.violations.map(function (v) {
      const ent = SYNC_ENTITIES.filter(function (e) { return e.type === v.entityType; })[0];
      return Object.assign({ field: (ent && ent.field) || v.entityType }, v);
    });
    console.error('[sync] ⚠ 检测到可疑的数据减少，已放弃本次合并以保护本地数据：' +
      JSON.stringify(violations));
    notifySyncAborted(violations);
    return false;
  }

  data.categories = sync.liveRecords(map, sync.ENTITY_TYPES.CATEGORY);
  data.events = sync.liveRecords(map, sync.ENTITY_TYPES.EVENT);
  data.todos = sync.liveRecords(map, sync.ENTITY_TYPES.TODO);
  data.customers = sync.liveRecords(map, sync.ENTITY_TYPES.CUSTOMER);
  data.followups = sync.liveRecords(map, sync.ENTITY_TYPES.FOLLOWUP);

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
  return true;
}

// 同步被护栏拦下 → 通知界面（用户必须知道「同步没生效」而不是以为成功了）
function notifySyncAborted(violations) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('sync-aborted', {
      violations: violations,
      at: Date.now(),
      // 一并告诉用户快照在哪：同步被拦下时最需要的就是「同步前那一份」
      snapshot: path.join(backupDir(), PRESYNC_DIR),
    });
  }
}

// 通知渲染进程存在同步冲突（本地修改被远程覆盖）
function notifyConflict(conflicts) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('sync-conflicts', conflicts);
  }
}

async function syncRequest(method, path, body) {
  // 登录/注册走的是「凭据校验」端点：它的 401 意思是「用户名或密码错误」，
  // 与会话过期完全是两回事，处理方式必须区分开。
  const isAuthCall = path.indexOf('/api/auth/login') === 0 || path.indexOf('/api/auth/register') === 0;

  let res;
  try {
    res = await fetch(syncState.serverUrl + path, {
      method: method,
      headers: Object.assign(
        { 'Authorization': 'Bearer ' + syncState.token },
        body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // 网络层失败（地址写错、服务没开、不在同一网络）。
    // 这里必须给出可操作的信息，并把本机真实局域网地址列出来 ——
    // 「手输 IP 写错网段」是最高频的原因（例如本机是 192.168.0.x 却填了 192.168.1.x）。
    const ips = localNetworkIps();
    const hint = ips.length
      ? ('本机局域网地址是 ' + ips.map(function (ip) { return 'http://' + ip + ':8787'; }).join(' 或 '))
      : '本机未检测到局域网地址（请确认已连 WiFi 或网线）';
    throw new Error(
      '连不上服务器 ' + syncState.serverUrl + '。请依次确认：' +
      '① 地址没写错（' + hint + '）；' +
      '② 目标电脑上的「本机同步服务」已启用；' +
      '③ 你与目标电脑在同一网络。'
    );
  }

  const json = await res.json().catch(function () { return {}; });
  if (res.status === 401) {
    if (isAuthCall) {
      // 关键：不要把「密码错」伪装成「登录已失效」。
      // 否则用户明明还没登录成功，却被告知「登录已失效，请重新登录」，完全被误导。
      throw new Error(json.error || '用户名或密码错误');
    }
    // token 失效（常见于「改了服务器地址，指向另一台服务器」或服务端重置）
    // 清掉本地登录态，让界面回到登录表单，而不是反复抛 HTTP 401 让用户无从下手
    clearSyncAuth();
    throw new Error('登录已失效，请在设置中重新登录（服务器：' + syncState.serverUrl + '）');
  }
  if (res.status === 403) {
    // 登录时 403 = 账号被管理员停用；同步时 403 同义。都原样透出服务端的说明。
    if (isAuthCall) throw new Error(json.error || '账号已被管理员停用，请联系管理员');
    clearSyncAuth();
    throw new Error(json.error || '账号已被停用，请联系管理员');
  }
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

  // ★ 快照放在这里（而不是 syncNow 里）：合并远程变更 = 唯一能删掉本地数据的动作，
  //   而能走到合并的入口不止一个（立即同步、渲染层单独调 sync:pull、启动自动同步）。
  //   放在真正的合并入口上，任何入口都绕不过它。
  snapshotBeforeSync('pull');

  let pulled = 0;
  let guard = 0;
  for (;;) {
    const json = await syncRequest('GET', '/api/sync?since=' + syncState.lastPulledAt);
    const changes = json.changes || [];
    if (changes.length) {
      const ok = applyRemoteChanges(changes);
      if (!ok) {
        // 护栏拦下（数据可疑减少）→ 不推进游标，本地数据保持原样，等用户处理
        persistData();
        persistSyncState();
        return { pulled: pulled, aborted: true };
      }
      pulled += changes.length;
      // 游标推进到**本批最后一条的 updatedAt**（规则在 shared/sync.nextPullCursor，
      // 有单测）。不能用 serverTime：分页拉取时它是服务端全局最新时间，
      // 会让两页之间的记录被永久跳过（前端再也拉不到它们）。
      syncState.lastPulledAt = sync.nextPullCursor(syncState.lastPulledAt, changes);
    }
    // 服务端还有更多 → 继续拉；返回空批也停，避免空转
    if (!json.hasMore || changes.length === 0) break;
    guard += 1;
    if (guard >= 50) break; // 防御：服务端 hasMore 异常时不要无限循环
  }

  persistData();
  persistSyncState();
  notifyRendererRefresh();
  return { pulled: pulled, aborted: false };
}

async function syncPush() {
  if (!syncAuthed()) throw new Error('未配置同步服务器');
  const built = buildLocalChanges(syncState.lastPushedAt);
  const changes = built.changes;
  if (changes.length > 0) {
    await syncRequest('POST', '/api/sync', { changes: changes });
    // 游标只推进到本批真正推上去的最大 localModifiedAt（**不是** Date.now()）：
    // 推送在途时用户又改的条目时间戳更早，用 Date.now() 会把它标成"已推送"，
    // 那笔修改就永远同步不出去了。
    if (built.cursor > syncState.lastPushedAt) syncState.lastPushedAt = built.cursor;
  }
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
  data.settings.emailReminder = Object.assign(defaultData().settings.emailReminder, data.settings.emailReminder || {});
  data.settings.emailSmtp = Object.assign(defaultData().settings.emailSmtp, data.settings.emailSmtp || {});
  data.settings.ai = Object.assign(defaultData().settings.ai, data.settings.ai || {});
  data.settings.calendar = Object.assign(defaultData().settings.calendar, data.settings.calendar || {});
  data.settings.bookkeeping = Object.assign(defaultData().settings.bookkeeping, data.settings.bookkeeping || {});
  data.statsHistory = Array.isArray(parsed.statsHistory) ? parsed.statsHistory : [];
  data.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  data.transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
  data.bookkeepingCategories = Array.isArray(parsed.bookkeepingCategories) ? parsed.bookkeepingCategories : [];
  data.budgets = Array.isArray(parsed.budgets) ? parsed.budgets : [];
  data.memorials = Array.isArray(parsed.memorials) ? parsed.memorials : [];
  // 客户与跟进记录同样必须纳入导入/恢复（2.3.2 新增的集合）。
  // 曾漏掉这两项：导入或恢复备份会**静默丢掉全部客户数据**。
  data.customers = Array.isArray(parsed.customers) ? parsed.customers : [];
  data.followups = Array.isArray(parsed.followups) ? parsed.followups : [];
  data.notified = {};
  data.snoozed = {};
  data.version = DATA_VERSION;
  // 导入/恢复的数据标记为「本地修改」，使下次同步能上传（否则 extractLocalChanges 会因
  // 缺少 localModifiedAt 而跳过，导致导入的数据永远停留在本地）。
  const now = Date.now();
  // ⚠️ 这个列表必须覆盖所有「会参与同步」的集合，否则导入的数据不会上传。
  [data.categories, data.events, data.todos, data.customers, data.followups].forEach(function (arr) {
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

// ---------- 内嵌同步服务器（本机作为同步中心） ----------
// 在 Electron 主进程内直接运行 Express + node:sqlite 后端：桌面 App 启动即成为同步中心，
// 安卓端连本机 8787 端口即可互通，无需单独安装 Node 或手动启动 server/。
// 依赖（express/cors/bcryptjs/jsonwebtoken）已作为根依赖打入安装包，server/src 源码随包携带。

function syncServerFilePath() { return path.join(app.getPath('userData'), SYNC_SERVER_FILE); }
function syncServerDbPath() { return path.join(app.getPath('userData'), 'sync-server.db'); }
function syncServerSecretPath() { return path.join(app.getPath('userData'), 'sync-server.secret'); }

function loadSyncServerState() {
  try {
    const s = JSON.parse(fs.readFileSync(syncServerFilePath(), 'utf-8'));
    syncServerState.enabled = !!s.enabled;
    syncServerState.port = Number(s.port) || 8787;
    syncServerState.lastIps = Array.isArray(s.lastIps) ? s.lastIps.slice() : [];
  } catch (e) { /* 默认未启用 */ }
}

// ---------- 局域网地址变化检测 ----------
// 为什么需要：同步地址跟着**安装主机**走。换电脑、换路由器、DHCP 重新分配，
// 网段和 IP 都会变；写死或「存下来就不管」的地址迟早失效。
//
// 处理策略（不静默改配置）：
//   1. 若已保存的服务器地址指向**本机自己**（当前 IP 或历史 IP）→ 改用回环地址
//      127.0.0.1。回环永远指向本机，从此不受网段变化影响；同时明确告知用户。
//   2. 若指向的是别人的机器 → 绝不动它（可能真的是团队里另一台同步服务器）。
//   3. 只要本机 IP 变了，就通知界面，方便用户去更新手机端/其它设备上填的地址。
let lanNotice = null; // 最近一次地址变化提示（供界面展示）

function checkLanAddressChange(trigger) {
  const ips = localNetworkIps();
  const prev = syncServerState.lastIps || [];
  const sortedNow = ips.slice().sort().join(',');
  const sortedPrev = prev.slice().sort().join(',');
  const changed = prev.length > 0 && sortedNow !== sortedPrev;
  const knownSelfIps = prev.concat(ips); // 历史 + 当前都算「自己」

  let repaired = null;
  if (syncState.serverUrl && Utils.isSelfServerUrl(syncState.serverUrl, knownSelfIps)
      && !Utils.isLoopbackHost(Utils.hostOf(syncState.serverUrl))) {
    const loop = Utils.loopbackUrl(syncServerState.port);
    const old = syncState.serverUrl;
    syncState.serverUrl = loop;
    // 换了地址 → 重置游标做一次全量对齐（与 sync:set-server 一致）
    syncState.lastPulledAt = 0;
    syncState.lastPushedAt = 0;
    persistSyncState();
    repaired = { from: old, to: loop };
    console.log('[lan] 已保存的服务器地址指向本机自己，改用回环地址（不受网段变化影响）：' + old + ' -> ' + loop);
  }

  syncServerState.lastIps = ips;
  persistSyncServerState();

  if (changed || repaired) {
    lanNotice = {
      at: Date.now(),
      trigger: trigger || 'startup',
      previousIps: prev,
      currentIps: ips,
      repaired: repaired,
    };
    if (changed) {
      console.log('[lan] 本机局域网地址发生变化：' + (prev.join(',') || '(无)') + ' -> ' + (ips.join(',') || '(无)'));
    }
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('lan-address-changed', lanNotice);
    }
  }
  return lanNotice;
}

function persistSyncServerState() {
  try {
    fs.writeFileSync(syncServerFilePath(), JSON.stringify({
      enabled: syncServerState.enabled,
      port: syncServerState.port,
      // 记录上次见到的本机 IP：用于判断「换网络/换主机后地址变了」，
      // 并识别「已保存的服务器地址其实指向本机自己」→ 改用回环地址
      lastIps: syncServerState.lastIps || [],
    }, null, 2), 'utf-8');
  } catch (e) { console.error('[sync-server] 状态保存失败', e); }
}

// 与独立 server 一致：优先环境变量 SECRET，否则从 userData 读取/生成并持久化。
function resolveSyncServerSecret() {
  if (process.env.SECRET && process.env.SECRET !== 'change-me-in-production-use-a-long-random-string') {
    return process.env.SECRET;
  }
  const p = syncServerSecretPath();
  try {
    const existing = fs.readFileSync(p, 'utf-8').trim();
    if (existing) return existing;
  } catch (e) { /* 首次运行 */ }
  const generated = require('crypto').randomBytes(32).toString('hex');
  try { fs.writeFileSync(p, generated, { mode: 0o600 }); } catch (e) { /* 用内存值 */ }
  return generated;
}

// 本机局域网 IPv4 列表（供手机端填写服务器地址，省去用户自己查 IP）
function localNetworkIps() {
  const out = [];
  try {
    const ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(function (name) {
      (ifaces[name] || []).forEach(function (info) {
        if (info && info.family === 'IPv4' && !info.internal) out.push(info.address);
      });
    });
  } catch (e) { /* 忽略 */ }
  return out;
}

// 接收手机端「局域网收集直传」的条目：按 id 去重后并入待办。
// 关键：deadline = null 且未完成 —— 正好是电脑端「收件箱（未整理）」的定义，
// 因此条目会立刻出现在收件箱等待整理，无需额外状态字段。
function handleInboxDrop(items) {
  const res = inboxUtil.mergeInboxItems(data.todos, items, Date.now());
  data.todos = res.todos;
  if (res.accepted > 0) {
    persistData();
    notifyRendererRefresh();
  }
  return {
    accepted: res.accepted,
    duplicated: res.duplicated,
    invalid: res.invalid,
    total: data.todos.length,
  };
}

function syncServerStatusPayload() {
  let pairingCode = '';
  try { pairingCode = derivePairingCode(resolveSyncServerSecret()); } catch (e) { /* 忽略 */ }
  return {
    enabled: syncServerState.enabled,
    running: syncServerState.running,
    port: syncServerState.port,
    url: syncServerState.running ? ('http://127.0.0.1:' + syncServerState.port) : '',
    ips: localNetworkIps(),   // 局域网 IP列表，供手机端填服务器地址
    pairingCode: pairingCode, // 手机端「收集直传」需要的配对码
    error: syncServerState.error || '',
  };
}

function startSyncServer() {
  if (syncServer) return syncServerStatusPayload(); // 已在运行
  try {
    const { createApp } = require('./server/src/app.js');
    const { createDb } = require('./server/src/db.js');
    syncServerDb = createDb(syncServerDbPath());
    const serverApp = createApp(syncServerDb, resolveSyncServerSecret(), {
      pairingCode: derivePairingCode(resolveSyncServerSecret()),
      onInboxDrop: handleInboxDrop, // 手机端局域网收集直传 → 直接并入本机收件箱
      // /health 里带上版本：多台电脑都装了本程序时，
      // 能一眼看出「哪台跑的是哪一版」，排查问题不用猜（此前该字段一直是空的）
      version: app.getVersion(),
    });
    syncServer = serverApp.listen(syncServerState.port, '0.0.0.0', function () {
      syncServerState.running = true;
      syncServerState.error = '';
      console.log('[sync-server] 本机同步服务已启动 http://0.0.0.0:' + syncServerState.port);
    });
    syncServer.on('error', function (err) {
      syncServerState.running = false;
      syncServerState.error = (err && err.message) ? err.message : String(err);
      console.error('[sync-server] 启动失败', syncServerState.error);
      try { if (syncServerDb) syncServerDb.close(); } catch (e) { /* 忽略 */ }
      syncServerDb = null;
      syncServer = null;
    });
    return syncServerStatusPayload();
  } catch (e) {
    syncServerState.running = false;
    syncServerState.error = e.message || String(e);
    return syncServerStatusPayload();
  }
}

function stopSyncServer() {
  if (syncServer) { try { syncServer.close(); } catch (e) { /* 忽略 */ } syncServer = null; }
  if (syncServerDb) { try { syncServerDb.close(); } catch (e) { /* 忽略 */ } syncServerDb = null; }
  syncServerState.running = false;
  return syncServerStatusPayload();
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
      if (Array.isArray(payload.accounts)) data.accounts = payload.accounts;
      if (Array.isArray(payload.transactions)) data.transactions = payload.transactions;
      if (Array.isArray(payload.bookkeepingCategories)) data.bookkeepingCategories = payload.bookkeepingCategories;
      if (Array.isArray(payload.budgets)) data.budgets = payload.budgets;
      if (Array.isArray(payload.memorials)) data.memorials = payload.memorials;
      if (Array.isArray(payload.customers)) data.customers = payload.customers;
      if (Array.isArray(payload.followups)) data.followups = payload.followups;
      if (payload.settings && typeof payload.settings === 'object') {
        const merged = Object.assign(defaultData().settings, payload.settings);
        merged.emailReminder = Object.assign(defaultData().settings.emailReminder, payload.settings.emailReminder || {});
        merged.emailSmtp = Object.assign(defaultData().settings.emailSmtp, payload.settings.emailSmtp || {});
        merged.ai = Object.assign(defaultData().settings.ai, payload.settings.ai || {});
        merged.calendar = Object.assign(defaultData().settings.calendar, payload.settings.calendar || {});
        merged.bookkeeping = Object.assign(defaultData().settings.bookkeeping, payload.settings.bookkeeping || {});
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

  // 稍后提醒：把某条记录延迟 minutes 分钟后再弹一次通知（桌面端）
  ipcMain.handle('reminder:snooze', function (e, opts) {
    opts = opts || {};
    const minutes = Number(opts.minutes) || 10;
    const id = String(opts.id || '');
    if (!id) return false;
    let kind = 'event';
    let rec = data.events.find(function (x) { return x.id === id; });
    if (!rec) { rec = data.todos.find(function (x) { return x.id === id; }); kind = 'todo'; }
    if (!data.snoozed) data.snoozed = {};
    const at = Date.now() + minutes * 60 * 1000;
    data.snoozed[id + '@snooze:' + at] = { kind: kind, id: id, title: rec ? rec.title : '提醒', at: at };
    scheduleSave();
    return true;
  });

  // ---------- 邮件提醒 IPC ----------
  ipcMain.handle('email:save-settings', function (e, opts) {
    opts = opts || {};
    data.settings.emailReminder = Object.assign(
      defaultData().settings.emailReminder, data.settings.emailReminder || {}, opts.reminder || {}
    );
    data.settings.emailSmtp = Object.assign(
      defaultData().settings.emailSmtp, data.settings.emailSmtp || {}, opts.smtp || {}
    );
    // 密码仅当用户输入了新值时更新（留空表示保持原密码）
    if (typeof opts.password === 'string' && opts.password !== '') {
      emailSecret.password = opts.password;
      persistEmailSecret();
    }
    scheduleSave();
    return emailStatus();
  });

  ipcMain.handle('email:test', async function (e, opts) {
    opts = opts || {};
    const smtp = data.settings.emailSmtp || {};
    const to = opts.to || (data.settings.emailReminder && data.settings.emailReminder.to);
    if (!smtp.host || !smtp.user || !emailSecret.password) {
      throw new Error('请先填写 SMTP 主机、用户名和密码');
    }
    if (!to) throw new Error('请填写收件邮箱');
    await sendMail({
      to: to,
      subject: '日程管理 · 测试邮件',
      text: '这是一封测试邮件，说明 SMTP 配置正确。',
      html: '<p style="font-family:sans-serif">这是一封测试邮件，说明 SMTP 配置正确。</p>',
    });
    return true;
  });

  ipcMain.handle('email:status', function () { return emailStatus(); });

  // ---------- AI（自然语言快速捕捉）IPC ----------
  function aiStatus() {
    const ai = data.settings.ai || {};
    return {
      enabled: !!ai.enabled,
      provider: ai.provider || 'ollama',
      endpoint: ai.endpoint || '',
      model: ai.model || '',
      hasApiKey: !!aiSecret.apiKey,
    };
  }

  ipcMain.handle('ai:save-settings', function (e, opts) {
    opts = opts || {};
    data.settings.ai = Object.assign(defaultData().settings.ai, data.settings.ai || {}, opts.ai || {});
    // API key 仅当用户输入了新值时更新（留空表示保持原 key）
    if (typeof opts.apiKey === 'string' && opts.apiKey !== '') {
      aiSecret.apiKey = opts.apiKey;
      persistAiSecret();
    }
    scheduleSave();
    return aiStatus();
  });

  ipcMain.handle('ai:status', function () { return aiStatus(); });

  ipcMain.handle('ai:parse', function (e, opts) {
    opts = opts || {};
    const ai = data.settings.ai || {};
    const categories = (data.categories || []).map(function (c) { return c.name; }).filter(Boolean);
    return aiIndex.parseQuickCapture(String(opts.text || ''), {
      ai: ai,
      apiKey: aiSecret.apiKey,
      categories: categories,
      now: opts.now != null ? opts.now : Date.now(),
    });
  });

  ipcMain.handle('ai:test', async function () {
    const ai = data.settings.ai || {};
    if (!ai.endpoint || !ai.model) throw new Error('请先填写 endpoint 和模型名');
    return aiIndex.testConnection(ai, aiSecret.apiKey);
  });

  // ---------- 同步 IPC ----------
  ipcMain.handle('sync:login', async function (e, opts) {
    opts = opts || {};
    if (!opts.serverUrl || !opts.username || !opts.password) {
      throw new Error('请填写服务器地址、用户名和密码');
    }
    syncState.serverUrl = normalizeServerUrl(opts.serverUrl);
    if (!syncState.serverUrl) throw new Error('请填写服务器地址');
    const path = opts.register ? '/api/auth/register' : '/api/auth/login';
    const json = await syncRequest('POST', path, { username: opts.username, password: opts.password });
    syncState.token = json.token;
    setSyncUser(json.user);
    syncState.lastPulledAt = 0; // 登录后下次同步从全量开始
    syncState.lastPushedAt = 0;
    persistSyncState();
    return { token: json.token, user: json.user };
  });

  ipcMain.handle('sync:pull', function () { return syncPull(); });
  ipcMain.handle('sync:push', function () { return syncPush(); });
  ipcMain.handle('sync:now', function () { return syncNow(); });

  // 刷新当前账号资料（角色/权限）。管理员改了某人的权限后，该用户点「刷新」即可生效，
  // 无需退出重登 —— 服务端本来也是每次请求回库校验的，这里只是把结果同步到界面。
  ipcMain.handle('sync:me', async function () {
    if (!syncAuthed()) throw new Error('未登录');
    const json = await syncRequest('GET', '/api/auth/me');
    setSyncUser(json.user);
    persistSyncState();
    return { user: json.user, role: syncState.role, permissions: syncState.permissions };
  });

  // ---------- 管理员接口（仅 role=admin 可用；服务端还会再校验一次）----------
  // 客户端这层的 isAdmin 判断只是「早点给出友好提示」，不是安全边界。
  function requireAdminLocal() {
    if (!syncAuthed()) throw new Error('请先登录同步账号');
    if (!syncIsAdmin()) throw new Error('需要管理员权限');
  }

  ipcMain.handle('admin:overview', async function () {
    requireAdminLocal();
    return syncRequest('GET', '/api/admin/overview');
  });

  ipcMain.handle('admin:list-users', async function () {
    requireAdminLocal();
    return syncRequest('GET', '/api/admin/users');
  });

  ipcMain.handle('admin:create-user', async function (e, payload) {
    requireAdminLocal();
    return syncRequest('POST', '/api/admin/users', payload || {});
  });

  ipcMain.handle('admin:update-user', async function (e, id, patch) {
    requireAdminLocal();
    // 对象被改回管理员（提升自己/他人）会改变权限判定，刷新一次本地缓存
    const json = await syncRequest('PATCH', '/api/admin/users/' + encodeURIComponent(id), patch || {});
    if (syncState.userId != null && Number(id) === Number(syncState.userId)) {
      setSyncUser(json.user);
      persistSyncState();
    }
    return json;
  });

  ipcMain.handle('admin:delete-user', async function (e, id) {
    requireAdminLocal();
    // 服务端要求显式确认（删除会连带清掉该用户的同步记录，不可逆）
    return syncRequest('DELETE', '/api/admin/users/' + encodeURIComponent(id) + '?confirm=true');
  });

  // 修改同步服务器地址（保留登录态，无需退出重登）
  ipcMain.handle('sync:set-server', function (e, serverUrl) {
    const u = normalizeServerUrl(serverUrl);
    if (!u) throw new Error('请填写服务器地址');
    if (u === syncState.serverUrl) return { serverUrl: u, changed: false };
    syncState.serverUrl = u;
    // 换了地址（可能是另一台服务器）→ 重置同步游标，下次同步做全量对齐，避免漏数据
    syncState.lastPulledAt = 0;
    syncState.lastPushedAt = 0;
    persistSyncState();
    return { serverUrl: u, changed: true };
  });

  ipcMain.handle('sync:status', function () {
    return {
      serverUrl: syncState.serverUrl,
      loggedIn: !!syncState.token,
      lastPulledAt: syncState.lastPulledAt,
      lastPushedAt: syncState.lastPushedAt,
      // 多账号：渲染层据此决定是否显示「用户管理」、隐藏哪些无权限的功能模块。
      // 未登录时按普通用户 + 全部功能处理（纯本地使用不该被权限限制）。
      userId: syncState.userId,
      username: syncState.displayName || '',
      role: syncState.token ? Permissions.normalizeRole(syncState.role) : Permissions.ROLE.USER,
      isAdmin: syncState.token ? syncIsAdmin() : false,
      permissions: Permissions.resolvePermissions(syncState.permissions),
    };
  });

  ipcMain.handle('sync:logout', function () {
    // 保留 serverUrl：退出登录后重新登录时表单可预填，无需再手输 IP
    // （曾经整块重置导致用户每次换网络/重登都要重新回忆地址）
    clearSyncAuth();
    return true;
  });

  // 内嵌同步服务器（本机作为同步中心）
  ipcMain.handle('sync-server:status', function () { return syncServerStatusPayload(); });
  ipcMain.handle('sync-server:start', function () {
    syncServerState.enabled = true;
    persistSyncServerState();
    return startSyncServer();
  });
  ipcMain.handle('sync-server:stop', function () {
    syncServerState.enabled = false;
    persistSyncServerState();
    return stopSyncServer();
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
  loadSyncServerState(); // 恢复内嵌同步服务器开关
  if (syncServerState.enabled) startSyncServer(); // 已启用则自动启动本机同步服务
  loadEmailSecret(); // 恢复 SMTP 密码（已加密持久化）
  loadAiSecret(); // 恢复 AI API key（已加密持久化）
  registerIpc();
  createWindow();
  createTray();
  registerQuickCapture(); // 全局快速捕捉快捷键
  checkReminders(); // 启动即查一次
  checkEmailReminder(); // 启动即查一次每日邮件
  // 检查本机局域网地址是否变了（换网络/换主机后网段会变）。
  // 若已保存的同步地址其实指向本机自己 → 自动改用回环地址，从此不受网段变化影响。
  // 放在 createWindow 之后：需要窗口就绪才能把提示推给界面。
  checkLanAddressChange('startup');
  setInterval(checkReminders, REMINDER_INTERVAL);
  setInterval(checkEmailReminder, REMINDER_INTERVAL);
  // 运行期间也可能换网络（切 WiFi、插网线），定期复查；os.networkInterfaces 很轻，60 秒一次足够
  setInterval(function () { checkLanAddressChange('interval'); }, 60 * 1000);
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

app.on('will-quit', function () { globalShortcut.unregisterAll(); stopSyncServer(); });

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin' && !recovering) app.quit();
});
