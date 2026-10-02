/*
 * adminRoutes.js — 管理员账号管理接口（多账号后台）
 *
 * 全部端点要求「已登录 + 角色为管理员」，且角色以数据库为准（见 auth.js）。
 *
 * 三条防「把自己锁在门外」的硬性规则（都有对应测试）：
 *   1. 不能停用/删除自己 —— 否则一按就把自己踢出去；
 *   2. 不能停用/降级/删除**最后一个管理员** —— 否则再没人能进用户管理，
 *      只能去服务器上改数据库才能救回来；
 *   3. 不能删掉只剩下自己的情况（同上，由规则 2 覆盖）。
 *
 * 另：删除用户会连带删除其全部同步记录（records.user_id），这是不可逆操作，
 * 所以接口要求显式传 confirm=true，避免误点。
 */
'use strict';

const bcrypt = require('bcryptjs');
const P = require('../../shared/permissions.js');
const { publicUser } = require('./auth.js');

function nowMs() { return Date.now(); }

function adminCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?').get(P.ROLE.ADMIN).n;
}

function activeAdminCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ? AND status = ?')
    .get(P.ROLE.ADMIN, P.STATUS.ACTIVE).n;
}

function getUserRow(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function recordCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?').get(userId).n;
}

function registerAdminRoutes(app, db, authenticate, requireAdmin) {
  const guard = [authenticate, requireAdmin];

  // 概览：给管理页顶部统计用
  app.get('/api/admin/overview', guard, function (req, res) {
    const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const active = db.prepare('SELECT COUNT(*) AS n FROM users WHERE status = ?').get(P.STATUS.ACTIVE).n;
    const records = db.prepare('SELECT COUNT(*) AS n FROM records').get().n;
    res.json({
      totalUsers: total,
      activeUsers: active,
      disabledUsers: total - active,
      adminUsers: adminCount(db),
      totalRecords: records,
    });
  });

  // 用户列表
  app.get('/api/admin/users', guard, function (req, res) {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC, id ASC').all();
    const users = rows.map(function (row) {
      const u = publicUser(row);
      u.recordCount = recordCount(db, row.id);
      u.isSelf = row.id === req.user.id;
      return u;
    });
    res.json({
      users: users,
      modules: P.MODULES, // 供界面渲染权限勾选框，避免前端硬编码
      me: req.user.id,
    });
  });

  // 新建用户
  app.post('/api/admin/users', guard, async function (req, res) {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username) return res.status(400).json({ error: '请填写用户名' });
    if (username.length > 64) return res.status(400).json({ error: '用户名过长' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const role = P.normalizeRole(body.role);
    const status = P.normalizeStatus(body.status);
    // 未传 permissions → 存 '' 表示「未设置 = 全部功能」
    const perm = body.permissions == null ? '' : P.serializePermissions(body.permissions);
    const hash = await bcrypt.hash(password, 10);
    const now = nowMs();
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, created_at, role, status, permissions, display_name, last_login_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(username, hash, now, role, status, perm, String(body.displayName || '').trim(), 0, now);

    res.json({ user: publicUser(getUserRow(db, info.lastInsertRowid)) });
  });

  // 修改用户（显示名 / 角色 / 状态 / 权限 / 重置密码）
  app.patch('/api/admin/users/:id', guard, async function (req, res) {
    const id = Number(req.params.id);
    const row = getUserRow(db, id);
    if (!row) return res.status(404).json({ error: '用户不存在' });
    const body = req.body || {};
    const self = id === req.user.id;

    const nextRole = body.role != null ? P.normalizeRole(body.role) : P.normalizeRole(row.role);
    const nextStatus = body.status != null ? P.normalizeStatus(body.status) : P.normalizeStatus(row.status);

    // 规则 1：不能停用自己（避免一按就把自己踢出去）
    if (self && nextStatus !== P.STATUS.ACTIVE) {
      return res.status(400).json({ error: '不能停用当前登录的账号' });
    }
    // 规则 2：不能把自己降级 —— 同上
    if (self && nextRole !== P.ROLE.ADMIN && P.normalizeRole(row.role) === P.ROLE.ADMIN) {
      return res.status(400).json({ error: '不能取消自己的管理员角色' });
    }
    // 规则 2（续）：不能动掉最后一个可用管理员
    const wasActiveAdmin = P.normalizeRole(row.role) === P.ROLE.ADMIN && P.normalizeStatus(row.status) === P.STATUS.ACTIVE;
    const willBeActiveAdmin = nextRole === P.ROLE.ADMIN && nextStatus === P.STATUS.ACTIVE;
    if (wasActiveAdmin && !willBeActiveAdmin && activeAdminCount(db) <= 1) {
      return res.status(400).json({ error: '系统必须保留至少一个启用状态的管理员' });
    }

    const fields = [];
    const values = [];
    function set(col, val) { fields.push(col + ' = ?'); values.push(val); }

    if (body.displayName != null) set('display_name', String(body.displayName).trim());
    if (body.role != null) set('role', nextRole);
    if (body.status != null) set('status', nextStatus);
    if (body.permissions != null) set('permissions', P.serializePermissions(body.permissions));
    if (body.password != null) {
      const pw = String(body.password);
      if (pw.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
      set('password_hash', await bcrypt.hash(pw, 10));
    }
    if (!fields.length) return res.status(400).json({ error: '没有需要修改的内容' });

    set('updated_at', nowMs());
    values.push(id);
    // 注意：node:sqlite 的 Statement.run 是原生方法，必须保持 this 绑定 ——
    // 用 .apply(null, values) 会抛 "Illegal invocation"，必须用展开语法调用。
    db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);

    res.json({ user: publicUser(getUserRow(db, id)) });
  });

  // 删除用户（连带删除其同步记录，不可逆，需显式确认）
  app.delete('/api/admin/users/:id', guard, function (req, res) {
    const id = Number(req.params.id);
    const row = getUserRow(db, id);
    if (!row) return res.status(404).json({ error: '用户不存在' });
    if (id === req.user.id) return res.status(400).json({ error: '不能删除当前登录的账号' });
    if (String(req.query.confirm || '') !== 'true') {
      return res.status(400).json({ error: '删除不可逆，需显式确认' });
    }
    const isAdminRow = P.normalizeRole(row.role) === P.ROLE.ADMIN;
    if (isAdminRow && adminCount(db) <= 1) {
      return res.status(400).json({ error: '系统必须保留至少一个管理员' });
    }

    const removed = recordCount(db, id);
    db.prepare('DELETE FROM records WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true, removedRecords: removed });
  });

  // 当前登录用户的资料（客户端刷新角色/权限用；改了权限后无需重新登录）
  app.get('/api/auth/me', authenticate, function (req, res) {
    res.json({ user: req.user });
  });
}

module.exports = { registerAdminRoutes };
