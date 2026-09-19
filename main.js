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
const nodemailer = require('nodemailer');
const { buildDailyDigest, shouldSendDailyEmail } = require('./shared/digest.js');
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
let syncState = { serverUrl: '', token: '', lastPulledAt: 0, lastPushedAt: 0 }; // 同步配置与游标
let emailSecret = { password: '' }; // SMTP 授权码/密码（仅内存 + 加密落盘）
let emailSending = false; // 发送中防重入（避免 30s 轮询期间重复发送）
let aiSecret = { apiKey: '' }; // AI API key（仅内存 + 加密落盘）
let syncServer = null;      // 内嵌同步服务器 http.Server 实例（null=未运行）
let syncServerDb = null;    // node:sqlite 数据库（服务器关闭时 close）
let syncServerState = { enabled: false, port: 8787, running: false, error: '' }; // 内嵌服务器开关与状态

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
    accounts: data.accounts || [],
    transactions: data.transactions || [],
    bookkeepingCategories: data.bookkeepingCategories || [],
    budgets: data.budgets || [],
    memorials: data.memorials || [],
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
  })) return;
  const digest = buildDailyDigest(data, now);
  const today = Utils.toDateStr(now);
  emailSending = true;
  sendMail({ to: er.to, subject: digest.subject, text: digest.text, html: digest.html })
    .then(function () {
      data.emailLastSentDate = today;
      scheduleSave();
      if (Notification.isSupported()) {
        new Notification({ title: '日程管理', body: '每日待办邮件已发送' }).show();
      }
    })
    .catch(function (e) {
      console.error('每日邮件发送失败', e);
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
  data.notified = {};
  data.snoozed = {};
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
  } catch (e) { /* 默认未启用 */ }
}

function persistSyncServerState() {
  try {
    fs.writeFileSync(syncServerFilePath(), JSON.stringify({ enabled: syncServerState.enabled, port: syncServerState.port }, null, 2), 'utf-8');
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
  setInterval(checkReminders, REMINDER_INTERVAL);
  setInterval(checkEmailReminder, REMINDER_INTERVAL);
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
