/**
 * notifications.js — 本地通知（@notifee）。
 *
 * 职责：
 *   - 请求通知权限（Android 13+ 需要 POST_NOTIFICATIONS 运行时授权）；
 *   - 依据待办 deadline 与日程 startTime 的 remindBefore 重排未来 7 天的本地提醒；
 *   - 数据变更后防抖重排；退出登录清空数据后自动清空提醒。
 *
 * 防御式实现：若 @notifee 原生模块未正确链接（如本地未 npm install），
 * 所有调用均在 try/catch 内降级为 no-op，不影响其它功能。
 */
import notifee, { TriggerType, AndroidImportance } from '@notifee/react-native';
import store from './store';
import shared from './shared';

const { utils, sync } = shared;
const HORIZON_DAYS = 7;

let rescheduleTimer = null;

function available() {
  return !!(notifee && notifee.requestPermission);
}

// 请求通知权限；返回是否已授权
export async function ensurePermission() {
  if (!available()) return false;
  try {
    const settings = await notifee.requestPermission();
    // authorizationStatus：0 未授权 / 1 已授权 / 2 临时授权
    return settings && settings.authorizationStatus >= 1;
  } catch (e) {
    console.warn('[notify] 权限请求失败', e);
    return false;
  }
}

async function ensureChannel() {
  if (!available()) return;
  try {
    await notifee.createChannel({
      id: 'reminders',
      name: '日程与待办提醒',
      importance: AndroidImportance.HIGH,
    });
  } catch (e) {
    // 频道已存在时忽略
  }
}

// 清空既有「已显示 + 已排程」通知，避免重排时累积/重复
async function cancelAll() {
  if (!available()) return;
  try {
    if (typeof notifee.getTriggerNotificationIds === 'function') {
      const ids = await notifee.getTriggerNotificationIds();
      if (ids && ids.length) await notifee.cancelTriggerNotifications(ids);
    }
  } catch (e) { /* 忽略 */ }
  try { await notifee.cancelAllNotifications(); } catch (e) { /* 忽略 */ }
}

function trigger(item) {
  if (!available()) return;
  notifee
    .createTriggerNotification(
      { id: item.id, title: item.title || '提醒', body: item.body || '', android: { channelId: 'reminders' } },
      { type: TriggerType.TIMESTAMP, timestamp: item.at }
    )
    .catch(function (e) { console.warn('[notify] 创建提醒失败', item.id, e); });
}

// 重排全部本地提醒（未来 7 天）
export async function scheduleReminders() {
  if (!available()) return;
  try {
    await cancelAll();
    await ensureChannel();

    const now = Date.now();
    const horizon = now + HORIZON_DAYS * 24 * 3600 * 1000;

    // 待办：deadline - remindBefore
    store.getRecords(sync.ENTITY_TYPES.TODO).forEach(function (t) {
      if (t.status === 'done' || t.deadline == null || !t.remindBefore) return;
      const remindAt = t.deadline - t.remindBefore * 60000;
      if (remindAt <= now || t.deadline > horizon) return;
      trigger({ id: 'todo:' + t.id, title: t.title, body: '截止于 ' + utils.toDateTimeStr(t.deadline), at: remindAt });
    });

    // 日程：每个重复实例 startTime - remindBefore（限未来 7 天）
    store.getRecords(sync.ENTITY_TYPES.EVENT).forEach(function (e) {
      if (!e.remindBefore) return;
      utils.expandOccurrences(e, { from: now, to: horizon, limit: 100 }).forEach(function (occ) {
        const remindAt = occ.startTime - e.remindBefore * 60000;
        if (remindAt <= now) return;
        const body = e.allDay ? '全天 · ' + utils.toDateStr(occ.startTime) : '开始于 ' + utils.toDateTimeStr(occ.startTime);
        trigger({ id: 'event:' + occ.key, title: e.title, body: body, at: remindAt });
      });
    });
  } catch (e) {
    console.warn('[notify] 排程失败', e);
  }
}

// 初始化：请求权限 + 首次排程 + 监听数据变化防抖重排
export function init() {
  ensurePermission().then(function (ok) {
    if (ok) scheduleReminders();
  });
  store.subscribe(function () {
    if (rescheduleTimer) clearTimeout(rescheduleTimer);
    rescheduleTimer = setTimeout(function () { scheduleReminders(); }, 2000);
  });
}
