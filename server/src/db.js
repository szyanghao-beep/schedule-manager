/*
 * db.js — SQLite 初始化与表结构（使用 Node 内置 node:sqlite，零编译依赖）
 * 表：
 *   users   用户表（用户名 + bcrypt 密码哈希 + 角色/状态/权限）
 *   records 同步记录表，主键 (user_id, entity_type, entity_id)，
 *           每条记录存 JSON 全文 + 软删除标志 + 服务端仲裁时间戳
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const P = require('../../shared/permissions.js');

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
  ensureSuperAdmin(db);
  return db;
}

// 内置超级管理员的密码：默认用 shared/permissions.js 里的默认值，
// 可用环境变量 SUPER_ADMIN_PASSWORD 覆盖（推荐，因为默认值是公开的弱口令）。
function superAdminPassword() {
  const fromEnv = String(process.env.SUPER_ADMIN_PASSWORD || '').trim();
  return fromEnv || P.DEFAULT_SUPER_ADMIN_PASSWORD;
}

// 保证内置超级管理员存在（账号名固定为 admin，权限最高）。
//
// 三种情况：
//   1. 不存在 → 用配置的密码创建，role=super、启用、权限不受限制；
//   2. 存在但不是 super（例如老版本里被人注册了同名账号）→ 提升为 super，
//      并把密码重置为配置的密码，保证「承诺的凭据一定能登进去」，同时打印醒目日志；
//   3. 已经是 super → **不动密码**（用户可能已经改过），需要强制重置时设 SUPER_ADMIN_RESET=1。
function ensureSuperAdmin(db) {
  const username = P.SUPER_ADMIN_USERNAME;
  const password = superAdminPassword();
  const now = Date.now();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!row) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO users (username, password_hash, created_at, role, status, permissions, display_name, last_login_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(username, hash, now, P.ROLE.SUPER, P.STATUS.ACTIVE, '', '超级管理员', 0, now);
    console.log('[db] 已创建内置超级管理员「' + username + '」（role=super，权限最高）');
    warnIfDefaultPassword(password);
    return;
  }

  const role = P.normalizeRole(row.role);
  const status = P.normalizeStatus(row.status);
  const wantReset = String(process.env.SUPER_ADMIN_RESET || '') === '1';

  if (role !== P.ROLE.SUPER) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET role = ?, status = ?, password_hash = ?, updated_at = ? WHERE id = ?')
      .run(P.ROLE.SUPER, P.STATUS.ACTIVE, hash, now, row.id);
    console.log('[db] ⚠ 名为「' + username + '」的账号原本不是超级管理员，已提升为 super ' +
      '并把密码重置为配置的超级管理员密码（原密码已失效）');
    warnIfDefaultPassword(password);
    return;
  }

  if (status !== P.STATUS.ACTIVE) {
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
      .run(P.STATUS.ACTIVE, now, row.id);
    console.log('[db] 内置超级管理员「' + username + '」原本被停用，已恢复启用（否则无人能进后台）');
  }
  if (wantReset) {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), now, row.id);
    console.log('[db] 已按 SUPER_ADMIN_RESET=1 重置内置超级管理员密码');
  }
  warnIfDefaultPassword(password);
}

// 仍在使用默认弱口令时打印醒目告警（本仓库是公开仓库，默认密码等于公开凭据）
function warnIfDefaultPassword(password) {
  if (password !== P.DEFAULT_SUPER_ADMIN_PASSWORD) return;
  console.warn(
    '\n' + '='.repeat(72) + '\n' +
    '[安全警告] 内置超级管理员仍在使用默认密码「' + P.DEFAULT_SUPER_ADMIN_PASSWORD + '」。\n' +
    '           本仓库是公开仓库，默认密码等同于公开凭据；同步服务监听局域网，\n' +
    '           同网段任何人都能凭它取得最高权限、读写或删除所有人的数据。\n' +
    '           请立刻在「用户管理 → 改密码」里修改，或设置环境变量 SUPER_ADMIN_PASSWORD 后重启。\n' +
    '           需要把已改过的密码重置回配置值时，设 SUPER_ADMIN_RESET=1 重启一次。\n' +
    '='.repeat(72) + '\n'
  );
}

// 供概览接口判断「超级管理员是否仍在使用默认密码」（用于在管理页顶部告警）。
// 只在管理员请求概览时调用，所以同步 bcrypt 比较的开销可以接受。
function superAdminUsesDefaultPassword(db) {
  const row = db.prepare('SELECT password_hash FROM users WHERE username = ?')
    .get(P.SUPER_ADMIN_USERNAME);
  if (!row) return false;
  try {
    return bcrypt.compareSync(superAdminPassword(), row.password_hash);
  } catch (e) {
    return false;
  }
}

// 保证至少有一个管理员。两种情况：
//   1. 全新库：第一个注册的用户会成为管理员（见 auth.js），这里无需动作；
//   2. 老库（只有普通用户）：把**最早创建**的那个账号提升为管理员，
//      否则升级后没有任何人能进入用户管理，等于把自己锁在门外。
function ensureAdminExists(db) {
  const admin = db.prepare('SELECT id FROM users WHERE role IN (?, ?) LIMIT 1').get(P.ROLE.ADMIN, P.ROLE.SUPER);
  if (admin) return;
  const first = db.prepare('SELECT id, username FROM users ORDER BY created_at ASC, id ASC LIMIT 1').get();
  if (!first) return;
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
    .run(P.ROLE.ADMIN, Date.now(), first.id);
  console.log('[db] 已将最早创建的账号「' + first.username + '」设为管理员（原库中没有管理员）');
}

module.exports = { createDb, ensureAdminExists, ensureSuperAdmin, superAdminUsesDefaultPassword, superAdminPassword };

