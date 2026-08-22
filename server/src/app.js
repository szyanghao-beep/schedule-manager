/*
 * app.js — Express 应用组装
 */
'use strict';

const express = require('express');
const cors = require('cors');
const { registerAuthRoutes, authenticate } = require('./auth.js');
const { registerSyncRoutes } = require('./syncRoutes.js');

function createApp(db, secret) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' })); // 同步 payload 无需 10mb，收紧防大请求体 DoS

  app.get('/health', function (req, res) {
    res.json({ ok: true, time: Date.now() });
  });

  registerAuthRoutes(app, db, secret);
  registerSyncRoutes(app, db, authenticate(secret));

  // 统一错误处理
  app.use(function (err, req, res, next) {
    console.error('[server] 未捕获错误:', err);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}

module.exports = { createApp };
