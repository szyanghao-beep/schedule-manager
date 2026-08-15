/**
 * syncClient.js — 同步编排（拉取 / 推送 / 自动同步 / 状态订阅）。
 *
 * 复用 shared/sync.js 的纯函数完成核心合并逻辑：
 *   - 推送：把 store 的 journal（本地未确认变更）POST 给服务端，成功后 pruneJournalAfterPush；
 *   - 拉取：GET /api/sync?since=lastSyncAt，返回 changes 用 mergeChanges 合并（LWW），
 *     并推进 lastSyncAt（只允许在拉取成功后推进，避免漏掉服务端其他设备的变更）；
 *   - 登录后首次 since=0 即全量拉取；每次本地增删改自动防抖推送（800ms）。
 *
 * 同步状态（idle / syncing / error）通过 subscribe / getStatus 供「我的」页展示。
 */
const api = require('./api');

const listeners = new Set();
let status = { state: 'idle', inFlight: false, lastError: null };

function getStatus() {
  return status;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(patch) {
  status = Object.assign({}, status, patch);
  listeners.forEach((fn) => fn());
}

let store = null;
let autoPushTimer = null;

// 完整同步一轮：先推送本地未确认变更，再增量拉取合并
async function syncNow() {
  if (!store) return;
  if (status.inFlight) return; // 防止重入
  if (!store.getToken()) {
    setStatus({ state: 'error', lastError: '未登录' });
    return;
  }
  setStatus({ state: 'syncing', inFlight: true, lastError: null });
  try {
    const base = store.getServerUrl();
    const token = store.getToken();

    // 1) 推送本地变更
    const journal = store.getJournal();
    if (journal.length > 0) {
      const pushRes = await api.push(base, token, journal);
      store.pruneJournalAfterPush(pushRes.serverTime);
    }

    // 2) 增量拉取（首次 lastSyncAt=0 即全量）
    const pullRes = await api.pull(base, token, store.getLastSyncAt());
    store.applyPull(pullRes.changes, pullRes.serverTime);

    setStatus({ state: 'idle', inFlight: false, lastError: null });
  } catch (e) {
    setStatus({
      state: 'error',
      inFlight: false,
      lastError: e && e.message ? e.message : String(e),
    });
  }
}

// 每次本地变更后自动推送（防抖，避免连续编辑时频繁发请求）。
// 离线时变更留在 journal，网络恢复后手动「立即同步」或下次启动自动同步即可补推。
function startAutoPush(s) {
  store = s;
  s.subscribe(() => {
    if (!s.getToken()) return;
    if (s.getJournal().length === 0) return;
    if (autoPushTimer) clearTimeout(autoPushTimer);
    autoPushTimer = setTimeout(() => {
      syncNow();
    }, 800);
  });
}

module.exports = {
  syncNow,
  startAutoPush,
  subscribe,
  getStatus,
};
