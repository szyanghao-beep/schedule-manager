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
const { createDb } = require('./src/db.js');
const { createApp } = require('./src/app.js');

const PORT = Number(process.env.PORT) || 8787;
const SECRET = process.env.SECRET || 'change-me-in-production-use-a-long-random-string';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

const db = createDb(DB_PATH);
const app = createApp(db, SECRET);

app.listen(PORT, '0.0.0.0', function () {
  console.log('日程管理同步服务已启动');
  console.log('  监听: http://0.0.0.0:' + PORT);
  console.log('  数据库: ' + DB_PATH);
});
