/*
 * verify-e2e.js — 后端端到端验证（真实文件 DB + 重启持久化 + HTTP 全链路）
 * 覆盖：注册/登录、多实体增量推送、增量拉取、软删除墓碑、服务重启后数据持久化。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('./src/db.js');
const { createApp } = require('./src/app.js');

const dbPath = path.join(os.tmpdir(), 'schedule-e2e-' + Date.now() + '.db');

async function startServer() {
  const db = createDb(dbPath);
  const app = createApp(db, 'e2e-secret');
  const server = app.listen(0);
  return { db, server, base: 'http://127.0.0.1:' + server.address().port };
}

function close(server) { return new Promise(function (r) { server.close(r); }); }

async function main() {
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } };

  console.log('== 第一次启动 ==');
  const s1 = await startServer();
  const reg = await (await fetch(s1.base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e', password: 'e2epass' }),
  })).json();
  check('注册成功', !!reg.token);
  const token = reg.token;

  const pushRes = await fetch(s1.base + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ changes: [
      { entityType: 'event', id: 'ev1', deleted: false, updatedAt: 1, data: { id: 'ev1', title: '会议' } },
      { entityType: 'todo', id: 'td1', deleted: false, updatedAt: 2, data: { id: 'td1', title: '买菜' } },
      { entityType: 'category', id: 'cat1', deleted: false, updatedAt: 3, data: { id: 'cat1', name: '工作' } },
    ] }),
  });
  check('多实体推送成功', pushRes.status === 200);
  await close(s1.server);
  s1.db.close();

  console.log('== 第二次启动（验证持久化）==');
  const s2 = await startServer();
  const pull = await (await fetch(s2.base + '/api/sync?since=0', { headers: { Authorization: 'Bearer ' + token } })).json();
  check('重启后数据持久化（3 条）', pull.changes.length === 3);
  check('event/todo/category 三类齐全', ['event', 'todo', 'category'].every(function (t) { return pull.changes.some(function (c) { return c.entityType === t; }); }));

  const login = await (await fetch(s2.base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e', password: 'e2epass' }),
  })).json();
  check('重启后登录仍有效', !!login.token);

  await fetch(s2.base + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ changes: [
      { entityType: 'todo', id: 'td1', deleted: true, updatedAt: 99, data: { id: 'td1', title: '买菜' } },
    ] }),
  });
  const pull2 = await (await fetch(s2.base + '/api/sync?since=0', { headers: { Authorization: 'Bearer ' + token } })).json();
  const td1 = pull2.changes.find(function (c) { return c.id === 'td1'; });
  check('软删除墓碑持久化', td1 && td1.deleted === true);

  await close(s2.server);
  s2.db.close();
  try { fs.unlinkSync(dbPath); } catch (e) {}
  ['-wal', '-shm'].forEach(function (s) { try { fs.unlinkSync(dbPath + s); } catch (e) {} });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
