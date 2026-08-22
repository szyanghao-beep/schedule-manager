/*
 * db.js — SQLite 初始化与表结构（使用 Node 内置 node:sqlite，零编译依赖）
 * 表：
 *   users   用户表（用户名 + bcrypt 密码哈希）
 *   records 同步记录表，主键 (user_id, entity_type, entity_id)，
 *           每条记录存 JSON 全文 + 软删除标志 + 服务端仲裁时间戳
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');

function createDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      user_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      client_updated_at INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL,
      PRIMARY KEY (user_id, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_records_user_time ON records(user_id, updated_at);
  `);
  // 迁移：旧库的 records 表无 client_updated_at 列（LWW 仲裁改为客户端时间后新增），补列。
  const cols = db.prepare("PRAGMA table_info(records)").all();
  const hasClientUpdatedAt = cols.some(function (c) { return c.name === 'client_updated_at'; });
  if (!hasClientUpdatedAt) {
    db.exec('ALTER TABLE records ADD COLUMN client_updated_at INTEGER NOT NULL DEFAULT 0');
  }
  return db;
}

module.exports = { createDb };
