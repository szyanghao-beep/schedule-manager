/*
 * auth.js — 注册 / 登录 / JWT 鉴权 / 管理员校验 / 内存限流
 *
 * 安全要点：
 *   - bcrypt 使用异步版本（hash / compare），避免同步阻塞事件循环被 DoS；
 *   - 注册 / 登录端点加内存限流，减缓暴力破解与高频请求（单进程够用，多进程需换共享存储）；
 *   - **鉴权时每次都回库查账号当前状态**：只有这样才能让「停用账号」立即生效。
 *     若只信 token 里的内容，被停用的人凭旧 token 还能用 30 天（token 有效期）。
 *   - 角色同样以库里为准，不从 token 取，避免改了角色后旧 token 仍带管理员权限。
 */
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const P = require('../../shared/permissions.js');

// token 只放 uid/username；角色与权限一律回库取（权威且可即时变更）
function signToken(user, secret) {
  return jwt.sign({ uid: user.id, username: user.username }, secret, { expiresIn: '30d' });
}

// 简单内存限流：按 IP + 端点计数，滑动窗口（windowMs 内最多 max 次）。
// 定期清理过期键，避免长期运行内存增长。
const attempts = new Map();
function rateLimit(windowMs, max) {
  return function (req, res, next) {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count += 1;
      if (entry.count > max) {
        return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      }
    }
    // 键过多时清理过期项
    if (attempts.size > 10000) {
      for (const [k, v] of attempts) {
        if (now > v.resetAt) attempts.delete(k);
      }
    }
    next();
  };
}

// 账号行 -> 对外安全形状（绝不含密码哈希）
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || '',
    role: P.normalizeRole(row.role),
    status: P.normalizeStatus(row.status),
    // 注意：'' 表示未设置 → 解析为全部模块；客户端据此决定显示哪些功能
    permissions: P.resolvePermissions(row.permissions),
    permissionsRaw: row.permissions == null ? '' : row.permissions,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || 0,
  };
}

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function registerAuthRoutes(app, db, secret) {
  // 注册
  app.post('/api/auth/register', rateLimit(60 * 1000, 20), async function (req, res) {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (username.length > 64) return res.status(400).json({ error: '用户名过长' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: '用户名已存在' });

    // 第一个注册的账号自动成为管理员，后续注册的一律是普通用户。
    // 已是空库之外的库（含老库）由 db.ensureAdminExists 保证有管理员。
    const isFirst = countUsers(db) === 0;
    const hash = await bcrypt.hash(password, 10);
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, created_at, role, status, permissions, display_name, last_login_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      username, hash, now,
      isFirst ? P.ROLE.ADMIN : P.ROLE.USER,
      P.STATUS.ACTIVE,
      '', // 未设置 = 全部功能
      '', 0, now
    );

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ token: signToken(row, secret), user: publicUser(row) });
  });

  // 登录
  app.post('/api/auth/login', rateLimit(60 * 1000, 20), async function (req, res) {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row) return res.status(401).json({ error: '用户名或密码错误' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

    // 被停用的账号明确拒绝，并给出可操作的提示（而不是让用户以为是密码错了）
    if (P.normalizeStatus(row.status) !== P.STATUS.ACTIVE) {
      return res.status(403).json({ error: '账号已被管理员停用，请联系管理员' });
    }

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    res.json({ token: signToken(fresh, secret), user: publicUser(fresh) });
  });
}

// JWT 鉴权中间件：验签 + **回库核对账号现状**
function authenticate(secret, db) {
  return function (req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: '未登录' });
    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!row) return res.status(401).json({ error: '账号不存在，请重新登录' });
    if (P.normalizeStatus(row.status) !== P.STATUS.ACTIVE) {
      return res.status(403).json({ error: '账号已被管理员停用，请联系管理员' });
    }
    req.user = publicUser(row);
    req.userRow = row;
    next();
  };
}

// 仅管理员可访问（角色以库为准，不由 token 决定）
function requireAdmin(req, res, next) {
  if (!P.isAdmin(req.user)) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

module.exports = { registerAuthRoutes, authenticate, requireAdmin, rateLimit, publicUser };
