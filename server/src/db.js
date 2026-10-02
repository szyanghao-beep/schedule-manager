/*
 * db.js — SQLite 初始化与表结构（使用 Node 内置 node:sqlite，零编译依赖）
 * 表：
 *   users   用户表（用户名 + bcrypt 密码哈希 + 角色/状态/权限）
 *   records 同步记录表，主键 (user_id, entity_type, entity_id)，
 *           每条记录存 JSON 全文 + 软删除标志 + 服务端仲裁时间戳
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const { ROLE, STATUS } = require('../../shared/permissions.js');

// 给已存在的库补列（幂等）。旧库没有这些列，直接 ALTER 而不是重建表 —— 不能动现有数据。
function ensureColumns(db, table, columns) {
  const existing = db.prepare('PRAGMA table_info(' + table + ')').all()
    .map(function (c) { return c.name; });
  columns.forEach(function (col) {
    if (existing.indexOf(col.name) < 0) {
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col.name + ' ' + col.def);
    }
  });
}

function createDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      permissions TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      last_login_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
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
  ensureColumns(db, 'records', [
    { name: 'client_updated_at', def: 'INTEGER NOT NULL DEFAULT 0' },
  ]);
  // 迁移：角色/状态/权限/显示名/最近登录（v2.3.5 多账号管理新增）。
  // permissions 默认空串 = 「未设置」，按全部功能处理（见 shared/permissions.js）。
  ensureColumns(db, 'users', [
    { name: 'role', def: "TEXT NOT NULL DEFAULT 'user'" },
    { name: 'status', def: "TEXT NOT NULL DEFAULT 'active'" },
    { name: 'permissions', def: "TEXT NOT NULL DEFAULT ''" },
    { name: 'display_name', def: "TEXT NOT NULL DEFAULT ''" },
    { name: 'last_login_at', def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'updated_at', def: 'INTEGER NOT NULL DEFAULT 0' },
  ]);

  ensureAdminExists(db);
  return db;
}

// 保证至少有一个管理员。两种情况：
//   1. 全新库：第一个注册的用户会成为管理员（见 auth.js），这里无需动作；
//   2. 老库（只有普通用户）：把**最早创建**的那个账号提升为管理员，
//      否则升级后没有任何人能进入用户管理，等于把自己锁在门外。
function ensureAdminExists(db) {
  const admin = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get(ROLE.ADMIN);
  if (admin) return;
  const first = db.prepare('SELECT id, username FROM users ORDER BY created_at ASC, id ASC LIMIT 1').get();
  if (!first) return;
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
    .run(ROLE.ADMIN, Date.now(), first.id);
  console.log('[db] 已将最早创建的账号「' + first.username + '」设为管理员（原库中没有管理员）');
}

module.exports = { createDb, ensureAdminExists };

