/**
 * inboxDrop.js — 「收集直传」客户端（免登录、局域网直传电脑收件箱）。
 *
 * 场景：手机端离线收集待办/想法；回到与电脑同一网络时，点「同步到电脑」，
 * 把未同步条目 POST 到电脑端内嵌同步服务器的 /api/inbox-drop 端点，
 * 凭配对码校验，直接进入电脑「收件箱」等待整理。不走账号登录体系。
 */

const REQUEST_TIMEOUT_MS = 15000;
const PING_TIMEOUT_MS = 5000;

function normalizeUrl(url) {
  return String(url == null ? '' : url).trim().replace(/\/+$/, '');
}

/**
 * 投递条目到电脑。
 * @param {string} serverUrl   电脑端地址，如 http://192.168.1.5:8787
 * @param {string} pairingCode 电脑端设置页显示的 6 位收集口令
 * @param {Array}  items       [{ id, title, createdAt }]
 * @returns {Promise<{accepted:number, duplicated:number, total:number|null}>}
 */
async function dropToPc(serverUrl, pairingCode, items) {
  const base = normalizeUrl(serverUrl);
  if (!base) throw new Error('请先填写电脑端地址');
  if (!pairingCode) throw new Error('请先填写收集口令');
  if (!Array.isArray(items) || items.length === 0) {
    return { accepted: 0, duplicated: 0, total: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(base + '/api/inbox-drop', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Pairing-Code': String(pairingCode).trim(),
      },
      body: JSON.stringify({
        items: items.map((it) => ({
          id: it.id,
          title: it.title,
          createdAt: it.createdAt,
        })),
      }),
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      body = null;
    }
    if (!res.ok) {
      const msg = (body && body.error) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return body || { accepted: 0, duplicated: 0, total: null };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('连接超时：请确认电脑已启用「本机同步服务」，且手机与电脑在同一 WiFi');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 同步前先探测连通性，给出更明确的错误提示（地址错 / 没连同一 WiFi / 电脑没开服务）
async function ping(serverUrl) {
  const base = normalizeUrl(serverUrl);
  if (!base) throw new Error('请先填写电脑端地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(base + '/health', { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  } catch (e) {
    throw new Error('连不上电脑：请检查①电脑已启用「本机同步服务」②手机与电脑连同一个 WiFi③地址与口令是否正确');
  } finally {
    clearTimeout(timer);
  }
}

export default { dropToPc, ping, normalizeUrl };
