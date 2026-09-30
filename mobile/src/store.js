/**
 * store.js — 本地数据层（内存 Map + AsyncStorage 持久化）。
 *
 * 职责：
 *   - 维护记录 Map（key = entityType:id，含 deleted 墓碑）与待推送变更 journal；
 *   - 提供日程/待办的增删改查与完成勾选；
 *   - 每次变更防抖写入 AsyncStorage（{token, serverUrl, user, lastSyncAt, journal, records}）；
 *   - 暴露 getSnapshot/subscribe 供 useSyncExternalStore 订阅刷新；
 *   - 同步相关：applyPull（拉取合并 + 推进 lastSyncAt + 清理已确认 journal）、
 *     pruneJournalAfterPush（推送成功后采纳服务器时间）。
 *
 * 变更语义与 shared/sync.js 完全一致：记录级增量 + LWW（updatedAt 新者胜，墓碑优先）。
 * 说明：推送用「显式 journal」而非 extractChanges(records, since)，
 * 避免本地时钟超前时同一变更被反复推送（服务端会把 updatedAt 重写为服务器时间）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import shared from './shared';

const { utils, sync } = shared;

const STORAGE_KEY = 'schedule_mobile_state_v1';
const PERSIST_DEBOUNCE_MS = 300;

const state = {
  map: new Map(), // entityType:id -> record（含 deleted 墓碑）
  journal: [], // 待推送变更 [{entityType,id,deleted,updatedAt,data}]
  token: null,
  serverUrl: '',
  user: null,
  lastSyncAt: 0,
  version: 0, // 变更版本号（useSyncExternalStore 快照）
  loaded: false,
  listeners: new Set(),
  persistTimer: null,
  // 手机端「收集」箱：离线随手记的待办/想法，攒着，回到电脑旁手动直传到电脑收件箱
  localInbox: [], // [{ id, title, createdAt, synced }]
  inboxServer: { url: '', code: '' }, // 收集直传配置（免登录，仅需地址 + 配对码）
};

// ---------------- 订阅 ----------------
function getSnapshot() {
  return state.version;
}

function subscribe(fn) {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}

function notify() {
  state.version += 1;
  state.listeners.forEach((fn) => fn());
  schedulePersist();
}

// ---------------- 持久化 ----------------
function schedulePersist() {
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
}

async function persistNow() {
  try {
    const payload = {
      token: state.token,
      serverUrl: state.serverUrl,
      user: state.user,
      lastSyncAt: state.lastSyncAt,
      journal: state.journal,
      records: Array.from(state.map.values()),
      localInbox: state.localInbox,
      inboxServer: state.inboxServer,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[store] persist failed', e);
  }
}

async function load() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      state.token = s.token || null;
      state.serverUrl = s.serverUrl || '';
      state.user = s.user || null;
      state.lastSyncAt = s.lastSyncAt || 0;
      state.journal = Array.isArray(s.journal) ? s.journal : [];
      state.localInbox = Array.isArray(s.localInbox) ? s.localInbox : [];
      state.inboxServer = {
        url: (s.inboxServer && s.inboxServer.url) || '',
        code: (s.inboxServer && s.inboxServer.code) || '',
      };
      state.map = new Map();
      (Array.isArray(s.records) ? s.records : []).forEach((r) => {
        if (r && r.entityType && r.id != null) state.map.set(r.entityType + ':' + r.id, r);
      });
    }
  } catch (e) {
    console.warn('[store] load failed', e);
  }
  state.loaded = true;
  notify();
}

function isLoaded() {
  return state.loaded;
}

// ---------------- 会话 ----------------
// 登录/注册成功：切换账号，清空本地数据，等待首次全量拉取（since=0）
function setSession({ token, serverUrl, user }) {
  state.token = token || null;
  // 归一化后保存（去空白/尾斜杠、自动补 http://），后续同步与收集直传共用同一地址
  state.serverUrl = shared.utils.normalizeServerUrl(serverUrl) || '';
  state.user = user || null;
  state.lastSyncAt = 0;
  state.journal = [];
  state.map = new Map();
  notify();
}

function clearSession() {
  state.token = null;
  state.user = null;
  // 保留 serverUrl：退出登录后再登录时表单可预填，无需重新手输电脑 IP
  state.lastSyncAt = 0;
  state.journal = [];
  state.map = new Map();
  notify();
}

function getToken() {
  return state.token;
}

function getUser() {
  return state.user;
}

function getServerUrl() {
  return state.serverUrl;
}

function getLastSyncAt() {
  return state.lastSyncAt;
}

function getJournal() {
  return state.journal.slice();
}

// ---------------- 查询 ----------------
function getById(entityType, id) {
  return state.map.get(entityType + ':' + id);
}

function getRecords(entityType) {
  return sync.liveRecords(state.map, entityType);
}

function getCategories() {
  return sync.liveRecords(state.map, sync.ENTITY_TYPES.CATEGORY);
}

function getSettings() {
  const list = sync.liveRecords(state.map, sync.ENTITY_TYPES.SETTING);
  return list[0] || null;
}

// ---------------- 变更核心 ----------------
// 本地变更统一入口：压缩同 key 旧 journal 条目 -> 追加新 change -> LWW 合并进 map -> 通知
function _mutate(entityType, record) {
  state.journal = state.journal.filter((ch) => !(ch.entityType === entityType && ch.id === record.id));
  const change = sync.toChange(record, entityType);
  state.journal.push(change);
  sync.mergeChanges(state.map, [change]);
  notify();
}

function _create(entityType, fields) {
  const now = Date.now();
  const rec = Object.assign({ id: utils.genId(), createdAt: now, updatedAt: now }, fields);
  _mutate(entityType, rec);
  return rec;
}

function _update(entityType, id, patch) {
  const old = getById(entityType, id);
  if (!old) return null;
  // updatedAt 单调递增，避免本地时钟回拨导致新编辑被服务端 LWW 误判为旧编辑
  const rec = Object.assign({}, old, patch, { updatedAt: Math.max(Date.now(), (old.updatedAt || 0) + 1) });
  _mutate(entityType, rec);
  return rec;
}

// 软删除：写入 deleted 墓碑（LWW 语义下墓碑优先，防止旧副本复活）
function _remove(entityType, id) {
  const old = getById(entityType, id);
  if (!old) return;
  _mutate(entityType, { id, deleted: true, updatedAt: Math.max(Date.now(), (old.updatedAt || 0) + 1) });
}

// ---------------- 日程 ----------------
function createEvent(input) {
  return _create(sync.ENTITY_TYPES.EVENT, Object.assign({ status: 'pending', exceptions: {} }, input));
}

function updateEvent(id, patch) {
  return _update(sync.ENTITY_TYPES.EVENT, id, patch);
}

function deleteEvent(id) {
  _remove(sync.ENTITY_TYPES.EVENT, id);
}

// 仅删除重复日程的某一次实例：写入 exceptions[occurrenceKey]=true（expandOccurrences 会跳过）
function deleteEventOccurrence(id, occurrenceKey) {
  const ev = getById(sync.ENTITY_TYPES.EVENT, id);
  if (!ev) return;
  const exceptions = Object.assign({}, ev.exceptions || {});
  exceptions[occurrenceKey] = true;
  _update(sync.ENTITY_TYPES.EVENT, id, { exceptions });
}

function toggleEventDone(id) {
  const ev = getById(sync.ENTITY_TYPES.EVENT, id);
  if (!ev) return;
  _update(sync.ENTITY_TYPES.EVENT, id, { status: ev.status === 'done' ? 'pending' : 'done' });
}

// ---------------- 待办 ----------------
function createTodo(input) {
  return _create(sync.ENTITY_TYPES.TODO, Object.assign({ status: 'pending' }, input));
}

function updateTodo(id, patch) {
  return _update(sync.ENTITY_TYPES.TODO, id, patch);
}

function deleteTodo(id) {
  _remove(sync.ENTITY_TYPES.TODO, id);
}

function toggleTodoDone(id) {
  const t = getById(sync.ENTITY_TYPES.TODO, id);
  if (!t) return;
  const done = t.status === 'done';
  _update(sync.ENTITY_TYPES.TODO, id, {
    status: done ? 'pending' : 'done',
    completedAt: done ? null : Date.now(),
  });
}

// ---------------- 客户商机 ----------------
// 与桌面端 store 的客户语义保持一致：
//   - 金额是「流水」（预估可反复调整 / 落单一次性确认 / 赢单后追加增购），当前值由流水派生
//   - 阶段变更留痕（stageHistory），走 shared 的 changeStage
//   - 记录跟进时「下次跟进时间」会生成一条普通待办（deadline = 下次跟进时间），
//     于是手机上记的跟进，回到桌面端就自动出现在待办/规划/提醒里
const CU = shared.customer;

function createCustomer(input) {
  const now = Date.now();
  return _create(sync.ENTITY_TYPES.CUSTOMER, Object.assign({
    stage: 'lead', contact: '', phone: '', owner: '', remark: '',
    amountHistory: [],
    stageHistory: [{ stage: 'lead', at: now }],
  }, input));
}

function updateCustomer(id, patch) {
  const old = getById(sync.ENTITY_TYPES.CUSTOMER, id);
  if (!old) return null;
  if (patch && patch.stage && patch.stage !== old.stage) {
    // 阶段变更必须留痕，否则「每段停留多久」就看不出来了
    const changed = CU.changeStage(old, patch.stage, Date.now());
    const rest = Object.assign({}, patch);
    delete rest.stage;
    return _update(sync.ENTITY_TYPES.CUSTOMER, id, Object.assign(changed, rest));
  }
  return _update(sync.ENTITY_TYPES.CUSTOMER, id, patch);
}

function deleteCustomer(id) {
  const c = getById(sync.ENTITY_TYPES.CUSTOMER, id);
  if (!c) return;
  _remove(sync.ENTITY_TYPES.CUSTOMER, id);
  // 级联软删该客户的跟进记录与未完成的跟进待办（与桌面端一致）
  getRecords(sync.ENTITY_TYPES.FOLLOWUP).forEach(function (f) {
    if (f.customerId === id) _remove(sync.ENTITY_TYPES.FOLLOWUP, f.id);
  });
  getRecords(sync.ENTITY_TYPES.TODO).forEach(function (t) {
    if (t.customerId === id && t.followupTag && t.status !== 'done') {
      _remove(sync.ENTITY_TYPES.TODO, t.id);
    }
  });
}

// 金额：预估可多次、落单仅一次、增购需已赢单（统一由 shared.customer.addAmount 裁决）
function addCustomerAmount(id, entry) {
  const c = getById(sync.ENTITY_TYPES.CUSTOMER, id);
  if (!c) return null;
  if (entry && entry.kind === 'upsell' && !CU.canUpsell(c)) return null; // 未赢单不能增购
  const updated = CU.addAmount(c, entry || {});
  if (updated === c) return null; // 被拒绝（非法值 / 重复落单）
  const patch = Object.assign({}, updated);
  delete patch.id;
  return _update(sync.ENTITY_TYPES.CUSTOMER, id, patch);
}

function getFollowups(customerId) {
  const list = getRecords(sync.ENTITY_TYPES.FOLLOWUP);
  if (!customerId) return list;
  return list.filter(function (f) { return f.customerId === customerId; });
}

// 记录跟进：写入跟进记录，并按「下次跟进时间」生成/更新一条跟进待办
function recordFollowup(customerId, data) {
  const c = getById(sync.ENTITY_TYPES.CUSTOMER, customerId);
  if (!c) return null;
  const now = Date.now();
  const d = data || {};

  const fu = _create(sync.ENTITY_TYPES.FOLLOWUP, {
    customerId: customerId,
    at: d.at != null ? d.at : now,
    method: d.method || 'phone',
    content: d.content ? String(d.content).slice(0, 2000) : '',
    nextAt: d.nextAt != null ? d.nextAt : null,
    nextPlan: d.nextPlan ? String(d.nextPlan).slice(0, 500) : '',
  });

  let todo = null;
  if (fu.nextAt != null) {
    // 同一客户只保留一条未完成的跟进待办，重复记录跟进是「更新」而不是堆积
    const existing = getRecords(sync.ENTITY_TYPES.TODO).find(function (t) {
      return t.customerId === customerId && t.followupTag && t.status !== 'done';
    });
    const built = CU.buildFollowupTodo(c, fu, { now: now });
    if (existing) {
      const patch = Object.assign({}, built);
      delete patch.id;
      todo = _update(sync.ENTITY_TYPES.TODO, existing.id, patch);
    } else {
      const created = Object.assign({}, built);
      delete created.id; // _create 会生成 id
      todo = _create(sync.ENTITY_TYPES.TODO, created);
    }
    if (todo) _update(sync.ENTITY_TYPES.FOLLOWUP, fu.id, { todoId: todo.id });
  }

  return { followup: fu, todo: todo };
}

function updateFollowup(id, patch) {
  return _update(sync.ENTITY_TYPES.FOLLOWUP, id, patch);
}

function deleteFollowup(id) {
  _remove(sync.ENTITY_TYPES.FOLLOWUP, id);
}

// ---------------- 同步 ----------------
// 拉取结果合并：mergeChanges(LWW) + 推进 lastSyncAt + 清理已被服务端确认的 journal 条目。
// 若某条本地变更服务端还没有（或时间更旧），保留在 journal 里等待下次重推。
function applyPull(changes, serverTime) {
  sync.mergeChanges(state.map, changes || []);
  if (serverTime != null && serverTime > state.lastSyncAt) state.lastSyncAt = serverTime;
  state.journal = state.journal.filter((ch) => {
    const rec = state.map.get(ch.entityType + ':' + ch.id);
    return !rec || sync.recordTime(rec) < ch.updatedAt;
  });
  notify();
}

// 推送成功后：删除 updatedAt <= serverTime 的条目（服务端已接受），
// 并把对应本地记录时间采纳为服务器时间，避免本地时钟偏差破坏后续 LWW 仲裁。
// 仅当记录未被更新的本地编辑覆盖时才改写（记录 updatedAt 与条目一致时）。
function pruneJournalAfterPush(serverTime) {
  if (serverTime == null) return;
  const removed = [];
  state.journal = state.journal.filter((ch) => {
    if (ch.updatedAt <= serverTime) {
      removed.push(ch);
      return false;
    }
    return true;
  });
  removed.forEach((ch) => {
    const rec = state.map.get(ch.entityType + ':' + ch.id);
    if (rec && rec.updatedAt === ch.updatedAt) rec.updatedAt = serverTime;
  });
  if (removed.length) notify();
}

// ---------------- 收集箱（手机端离线收集 → 手动直传电脑收件箱） ----------------
// 设计：收集时只写本地（离线可用、纯手动不联网）；回到电脑旁点「同步到电脑」，
// 把未同步（synced=false）的条目 POST 给电脑，成功后标记已同步（幂等，重复点不会重复导入）。
function getLocalInbox() {
  return state.localInbox.slice();
}

function getPendingInbox() {
  return state.localInbox.filter((it) => !it.synced);
}

function getPendingInboxCount() {
  return state.localInbox.filter((it) => !it.synced).length;
}

function addInboxItem(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return null;
  const item = {
    id: utils.genId(),
    title: t.slice(0, 500),
    createdAt: Date.now(),
    synced: false,
  };
  state.localInbox.unshift(item); // 最新的在最上面
  notify();
  return item;
}

function updateInboxItem(id, title) {
  const it = state.localInbox.find((x) => x.id === id);
  if (!it) return;
  it.title = String(title).slice(0, 500);
  it.synced = false; // 改过就要重新传一次
  notify();
}

function removeInboxItem(id) {
  const before = state.localInbox.length;
  state.localInbox = state.localInbox.filter((it) => it.id !== id);
  if (state.localInbox.length !== before) notify();
}

function markInboxSynced(ids) {
  const set = new Set(ids || []);
  let changed = false;
  state.localInbox.forEach((it) => {
    if (set.has(it.id) && !it.synced) {
      it.synced = true;
      changed = true;
    }
  });
  if (changed) notify();
}

function clearSyncedInbox() {
  const before = state.localInbox.length;
  state.localInbox = state.localInbox.filter((it) => !it.synced);
  if (state.localInbox.length !== before) notify();
}

function getInboxServer() {
  return { url: state.inboxServer.url, code: state.inboxServer.code };
}

function setInboxServer(url, code) {
  state.inboxServer = {
    url: String(url == null ? '' : url).trim().replace(/\/+$/, ''),
    code: String(code == null ? '' : code).trim(),
  };
  notify();
}

export default {
  getSnapshot,
  subscribe,
  load,
  isLoaded,
  setSession,
  clearSession,
  getToken,
  getUser,
  getServerUrl,
  getLastSyncAt,
  getJournal,
  getById,
  getRecords,
  getCategories,
  getSettings,
  createEvent,
  updateEvent,
  deleteEvent,
  deleteEventOccurrence,
  toggleEventDone,
  createTodo,
  updateTodo,
  deleteTodo,
  toggleTodoDone,
  // 客户商机
  createCustomer,
  updateCustomer,
  deleteCustomer,
  addCustomerAmount,
  getFollowups,
  recordFollowup,
  updateFollowup,
  deleteFollowup,
  applyPull,
  pruneJournalAfterPush,
  // 收集箱
  getLocalInbox,
  getPendingInbox,
  getPendingInboxCount,
  addInboxItem,
  updateInboxItem,
  removeInboxItem,
  markInboxSynced,
  clearSyncedInbox,
  getInboxServer,
  setInboxServer,
};
