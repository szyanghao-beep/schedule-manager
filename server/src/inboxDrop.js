/*
 * inboxDrop.js — 局域网收集直传端点（免登录，配对码保护）
 *
 * 场景：手机端离线收集待办/想法；回到与电脑同一网络时手动点「同步到电脑」，
 * 把本地未同步条目 POST 到本端点，直接并入桌面端收件箱（无需账号登录）。
 *
 * 安全：请求头 X-Pairing-Code 必须与电脑端派生的 6 位配对码一致，
 *       防止同一局域网内陌生设备随意写入。
 * 幂等：去重交由 onInboxDrop 回调按条目 id 完成，重复投递不会产生重复条目。
 */
'use strict';

const crypto = require('crypto');

// 从同步密钥派生稳定的 6 位配对码（同一密钥恒定，无需额外存储/配置）
function derivePairingCode(secret) {
  const h = crypto.createHmac('sha256', String(secret || ''))
    .update('inbox-pairing-v1')
    .digest('hex');
  const num = parseInt(h.slice(0, 8), 16) % 1000000;
  return String(num).padStart(6, '0');
}

function registerInboxDropRoute(app, options) {
  options = options || {};

  app.post('/api/inbox-drop', function (req, res) {
    // 未启用：如独立部署的 server 未配置回调
    if (typeof options.onInboxDrop !== 'function') {
      return res.status(503).json({ error: '该服务未启用「局域网收集接收」' });
    }
    if (!options.pairingCode) {
      return res.status(503).json({ error: '未配置配对码' });
    }
    const code = String(req.headers['x-pairing-code'] || '').trim();
    if (code !== options.pairingCode) {
      return res.status(401).json({ error: '配对码不正确' });
    }
    const items = req.body && req.body.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items 必须为数组' });
    }
    if (items.length > 500) {
      return res.status(413).json({ error: '单次最多投递 500 条' });
    }

    let result;
    try {
      result = options.onInboxDrop(items) || {};
    } catch (e) {
      console.error('[inbox-drop] 处理失败', e);
      return res.status(500).json({ error: '接收失败：' + (e.message || e) });
    }
    res.json({
      ok: true,
      accepted: result.accepted || 0,
      duplicated: result.duplicated || 0,
      total: result.total != null ? result.total : null,
    });
  });
}

module.exports = { derivePairingCode, registerInboxDropRoute };
