/**
 * api.js — 后端 REST 客户端（fetch 实现，无第三方依赖）。
 *
 * 后端 API 契约：
 *   POST /api/auth/register  body {username, password}          -> {token, user:{id, username}}
 *   POST /api/auth/login     body {username, password}          -> {token, user:{id, username}}
 *   GET  /api/sync?since=<毫秒时间戳>  Header Authorization: Bearer <token>
 *                                                               -> {changes:[{entityType,id,deleted,updatedAt,data}], serverTime}
 *   POST /api/sync           body {changes:[...]} 需 auth header -> {serverTime}
 *
 * 服务器地址可配置（登录页填写），默认 http://<电脑局域网IP>:8787。
 * 注意：真机填电脑局域网 IP（同一 Wi-Fi）；安卓模拟器访问宿主机用 http://10.0.2.2:8787。
 */

const shared = require('./shared');

// 默认服务器地址：留空，强制用户在登录页填写真实地址。
// 原先预置 'http://192.168.1.100:8787' 这类示例 IP 会误导用户照抄，
// 曾出现填成 192.168.1.6 而真实网段是 192.168.0.x 导致连不上。
const DEFAULT_SERVER_URL = '';

const REQUEST_TIMEOUT_MS = 15000;

// 服务器地址归一化复用 shared/utils.js，保证与桌面端容错完全一致
const normalizeBaseUrl = shared.utils.normalizeServerUrl;

// 通用请求：JSON 收发 + 超时（AbortController）
async function request(baseUrl, path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('请先填写电脑端地址（格式 IP:端口，可用「自动查找电脑」）');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      body = null;
    }
    if (!res.ok) {
      const msg = (body && (body.error || body.message)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return body;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('请求超时，请检查服务器地址与网络');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token };
}

// 注册
function register(baseUrl, username, password) {
  return request(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

// 登录
function login(baseUrl, username, password) {
  return request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

// 增量拉取：since 为上次同步时间戳（首次传 0 = 全量）
function pull(baseUrl, token, since) {
  return request(baseUrl, '/api/sync?since=' + encodeURIComponent(since || 0), {
    method: 'GET',
    headers: authHeaders(token),
  });
}

// 推送本地变更（记录级增量 + LWW，服务端仲裁）
function push(baseUrl, token, changes) {
  return request(baseUrl, '/api/sync', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ changes }),
  });
}

module.exports = {
  DEFAULT_SERVER_URL,
  normalizeBaseUrl,
  register,
  login,
  pull,
  push,
};
