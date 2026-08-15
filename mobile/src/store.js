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
  state.serverUrl = serverUrl || '';
  state.user = user || null;
  state.lastSyncAt = 0;
  state.journal = [];
  state.map = new Map();
  notify();
}

function clearSession() {
  state.token = null;
  state.user = null;
  state.serverUrl = '';
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
  const rec = Object.assign({}, old, patch, { updatedAt: Date.now() });
  _mutate(entityType, rec);
  return rec;
}

// 软删除：写入 deleted 墓碑（LWW 语义下墓碑优先，防止旧副本复活）
function _remove(entityType, id) {
  if (!getById(entityType, id)) return;
  _mutate(entityType, { id, deleted: true, updatedAt: Date.now() });
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
  applyPull,
  pruneJournalAfterPush,
};
