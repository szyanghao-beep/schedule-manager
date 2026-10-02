/*
 * app.js — Express 应用组装
 */
'use strict';

const express = require('express');
const cors = require('cors');
const { registerAuthRoutes, authenticate, requireAdmin } = require('./auth.js');
const { registerSyncRoutes } = require('./syncRoutes.js');
const { registerInboxDropRoute } = require('./inboxDrop.js');
const { registerAdminRoutes } = require('./adminRoutes.js');

/**
 * @param db      node:sqlite 数据库
 * @param secret  JWT 密钥
 * @param options { pairingCode?, onInboxDrop? } —— 可选：局域网收集直传（免登录）
 *                onInboxDrop(items) 由宿主（桌面端主进程）提供，负责去重并写入收件箱
 */
function createApp(db, secret, options) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' })); // 同步 payload 无需 10mb，收紧防大请求体 DoS

  app.get('/health', function (req, res) {
    res.json({ ok: true, time: Date.now() });
  });

  registerAuthRoutes(app, db, secret);
  // 鉴权中间件带上 db：每次请求回库核对账号状态与角色，
  // 这样「停用账号/改角色」立即生效，不用等旧 token 过期
  const auth = authenticate(secret, db);
  registerSyncRoutes(app, db, auth);
  registerAdminRoutes(app, db, auth, requireAdmin);
  registerInboxDropRoute(app, options || {});

  // 统一错误处理
  app.use(function (err, req, res, next) {
    console.error('[server] 未捕获错误:', err);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}

module.exports = { createApp };
