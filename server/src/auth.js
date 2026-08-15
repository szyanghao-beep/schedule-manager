/*
 * auth.js — 注册 / 登录 / JWT 鉴权中间件
 */
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function signToken(user, secret) {
  return jwt.sign({ uid: user.id, username: user.username }, secret, { expiresIn: '30d' });
}

function registerAuthRoutes(app, db, secret) {
  // 注册
  app.post('/api/auth/register', function (req, res) {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: '用户名已存在' });

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    ).run(username, hash, Date.now());

    const user = { id: info.lastInsertRowid, username: username };
    res.json({ token: signToken(user, secret), user: user });
  });

  // 登录
  app.post('/api/auth/login', function (req, res) {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
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

module.exports = { registerAuthRoutes, authenticate };
