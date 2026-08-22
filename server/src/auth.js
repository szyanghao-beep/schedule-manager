/*
 * auth.js — 注册 / 登录 / JWT 鉴权中间件 / 内存限流
 *
 * 安全要点：
 *   - bcrypt 使用异步版本（hash / compare），避免同步阻塞事件循环被 DoS；
 *   - 注册 / 登录端点加内存限流，减缓暴力破解与高频请求（单进程够用，多进程需换共享存储）。
 */
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    ).run(username, hash, Date.now());

    const user = { id: info.lastInsertRowid, username: username };
    res.json({ token: signToken(user, secret), user: user });
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
    const user = { id: row.id, username: row.username };
    res.json({ token: signToken(user, secret), user: user });
  });
}

// JWT 鉴权中间件
function authenticate(secret) {
  return function (req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      const payload = jwt.verify(token, secret);
      req.user = { id: payload.uid, username: payload.username };
      next();
    } catch (e) {
      res.status(401).json({ error: '登录已过期，请重新登录' });
    }
  };
}

module.exports = { registerAuthRoutes, authenticate, rateLimit };
