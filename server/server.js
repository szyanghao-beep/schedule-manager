/*
 * server.js — 后端入口
 * 启动 HTTP 服务，加载 SQLite，注册认证与同步路由。
 *
 * 环境变量：
 *   PORT     监听端口，默认 8787
 *   SECRET   JWT 签名密钥（生产务必改成强随机值）
 *   DB_PATH  SQLite 数据库文件路径，默认 server/data.db
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { createDb } = require('./src/db.js');
const { createApp } = require('./src/app.js');

// node:sqlite 依赖 Node >= 22.5（内置模块），版本过低直接启动会报错，这里提前给出友好提示。
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error('[server] 本后端使用 Node 内置 node:sqlite，要求 Node >= 22.5，当前 ' + process.versions.node);
  console.error('[server] 请升级 Node 到 22.5 及以上后重试。');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 8787;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

// JWT 签名密钥：优先环境变量；未设置时自动生成随机值并持久化到 server/.secret，
// 避免「公开默认密钥可被伪造 token」的安全隐患，同时保留零配置本地启动体验。
function resolveSecret() {
  if (process.env.SECRET && process.env.SECRET !== 'change-me-in-production-use-a-long-random-string') {
    return process.env.SECRET;
  }
  const secretPath = path.join(__dirname, '.secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf-8').trim();
    if (existing) return existing;
  } catch (e) { /* 首次运行 */ }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch (e) { /* 写失败仍用内存值 */ }
  console.warn('[server] 未设置 SECRET，已自动生成随机密钥并保存到 server/.secret（生产建议用环境变量注入强随机值）');
  return generated;
}

const SECRET = resolveSecret();

const db = createDb(DB_PATH);
const app = createApp(db, SECRET);

app.listen(PORT, '0.0.0.0', function () {
  console.log('日程管理同步服务已启动');
  console.log('  监听: http://0.0.0.0:' + PORT);
  console.log('  数据库: ' + DB_PATH);
});
