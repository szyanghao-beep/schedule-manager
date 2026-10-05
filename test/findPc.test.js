/*
 * findPc.test.js — 「自动查找电脑」的扫描逻辑测试
 *
 * 这是解决「网段随安装主机变化」的关键一环：用户不必知道电脑 IP。
 * 测试方式：**真的起一个后端**，再让扫描去把它找出来（不是 mock）。
 * 为了不依赖真实局域网环境，扫描范围收窄到 127.0.0.x 的一小段。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { createDb } = require(path.join(__dirname, '..', 'server', 'src', 'db.js'));
const { createApp } = require(path.join(__dirname, '..', 'server', 'src', 'app.js'));
const { findPc, probe } = require(path.join(__dirname, '..', 'mobile', 'src', 'findPc.js'));

function startServer(version) {
  const db = createDb(':memory:');
  const app = createApp(db, 'test-secret', { version: version || '' });
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port, db: db });
    });
  });
}

test('probe：认出「这是我们的服务」并带回版本；非本应用的服务不算命中', async function (t) {
  const s = await startServer('2.3.9');
  t.after(function () { s.server.close(); });

  const good = await probe('http://127.0.0.1:' + s.port, 800);
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.app, 'schedule-manager');
  assert.strictEqual(good.version, '2.3.9', '应带回版本，便于判断是不是同一套');

  // 起一个「不是我们」的服务：占着端口但 /health 没有 app 字段
  const express = require('express');
  const other = express();
  other.get('/health', function (req, res) { res.json({ ok: true }); });
  const otherServer = await new Promise(function (resolve) {
    const sv = other.listen(0, '127.0.0.1', function () { resolve(sv); });
  });
  t.after(function () { otherServer.close(); });

  const foreign = await probe('http://127.0.0.1:' + otherServer.address().port, 800);
  assert.strictEqual(foreign.ok, false, '别的程序占着端口不能算命中（否则会连错服务）');
  assert.strictEqual(foreign.wrongApp, true, '应能区分「不是我们的服务」与「连不上」');

  const dead = await probe('http://127.0.0.1:1', 500);
  assert.strictEqual(dead.ok, false);
});

test('★ findPc：能在网段里把电脑找出来（真的起服务再扫描）', async function (t) {
  const s = await startServer('2.3.9');
  t.after(function () { s.server.close(); });

  const progress = [];
  const res = await findPc({
    prefixes: ['127.0.0'],
    range: { start: 1, end: 12 },
    port: s.port,
    timeoutMs: 600,
    concurrency: 12,
    onProgress: function (p) { progress.push(p.scanned); },
  });

  // 服务监听在 127.0.0.1，扫描范围 127.0.0.1~12 → 必然命中 127.0.0.1
  assert.strictEqual(res.reason, 'ok', JSON.stringify(res));
  assert.strictEqual(res.url, 'http://127.0.0.1:' + s.port);
  assert.ok(progress.length > 0, '应有进度回调');
});

test('findPc：找不到时返回 not-found 而不是抛错，并报出扫了多少', async function (t) {
  const s = await startServer();
  t.after(function () { s.server.close(); });
  // 端口故意写错 → 同段内没有我们的服务
  const res = await findPc({
    prefixes: ['127.0.0'],
    range: { start: 1, end: 6 },
    port: s.port + 1,
    timeoutMs: 400,
    concurrency: 6,
  });
  assert.strictEqual(res.url, null);
  assert.strictEqual(res.reason, 'not-found');
  assert.strictEqual(res.scanned, 6, '应把 6 个候选都试过');
  assert.strictEqual(res.total, 6);
});

test('★ findPc：优先扫「上次成功连过的网段」', async function () {
  const sharedUtils = require(path.join(__dirname, '..', 'shared', 'utils.js'));
  const prefixes = sharedUtils.scanPrefixes('http://192.168.0.106:8787');
  assert.strictEqual(prefixes[0], '192.168.0', '上次成功的网段排最前，最可能命中');
  assert.ok(prefixes.indexOf('192.168.1') >= 0, '常见网段作为换网络后的兜底');
});
