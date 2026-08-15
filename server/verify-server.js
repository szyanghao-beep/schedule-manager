/*
 * verify-server.js — 后端集成验证脚本（node verify-server.js）
 * 用内置 fetch 实测：健康检查、注册、登录、增量推送/拉取、软删除墓碑。
 */
'use strict';

const { createDb } = require('./src/db.js');
const { createApp } = require('./src/app.js');

const db = createDb(':memory:');
const app = createApp(db, 'test-secret');

async function main() {
  const server = app.listen(0);
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const j = async (res) => res.json();
  const post = (path, body, token) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  const get = (path, token) => fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } };

  console.log('== 1. 健康检查 ==');
  const health = await (await fetch(base + '/health')).json();
  check('GET /health -> ok', health.ok === true);

  console.log('== 2. 注册 / 登录 ==');
  const reg = await (await post('/api/auth/register', { username: 'alice', password: 'secret123' })).json();
  check('注册成功返回 token', !!reg.token && reg.user.username === 'alice');
  const regDup = await post('/api/auth/register', { username: 'alice', password: 'secret123' });
  check('重复注册返回 409', regDup.status === 409);
  const loginBad = await post('/api/auth/login', { username: 'alice', password: 'wrong' });
  check('错误密码返回 401', loginBad.status === 401);
  const login = await (await post('/api/auth/login', { username: 'alice', password: 'secret123' })).json();
  check('登录成功', !!login.token);
  const token = login.token;

  console.log('== 3. 增量推送 / 拉取 ==');
  const unauth = await get('/api/sync?since=0');
  check('未登录拉取返回 401', unauth.status === 401);

  const push1 = await post('/api/sync', {
    changes: [
      { entityType: 'todo', id: 't1', deleted: false, updatedAt: 1, data: { id: 't1', title: '写报告' } },
      { entityType: 'todo', id: 't2', deleted: false, updatedAt: 2, data: { id: 't2', title: '买菜' } },
    ],
  }, token);
  const push1Json = await j(push1);
  check('首次推送成功', push1.status === 200 && push1Json.serverTime > 0);

  const pull1 = await (await get('/api/sync?since=0', token)).json();
  check('拉取到 2 条记录', pull1.changes.length === 2);
  const t1 = pull1.changes.find((c) => c.id === 't1');
  check('服务端时间仲裁：updatedAt 已被盖为服务端时间', t1 && t1.updatedAt >= push1Json.serverTime - 1);

  console.log('== 4. 增量更新 + 软删除墓碑 ==');
  const since = pull1.serverTime;
  await post('/api/sync', {
    changes: [
      { entityType: 'todo', id: 't1', deleted: false, updatedAt: 100, data: { id: 't1', title: '写报告(改)' } },
      { entityType: 'todo', id: 't2', deleted: true, updatedAt: 101, data: { id: 't2', title: '买菜' } },
    ],
  }, token);

  const pull2 = await (await get('/api/sync?since=' + since, token)).json();
  check('增量拉取只返回 2 条新变更', pull2.changes.length === 2);
  const t1b = pull2.changes.find((c) => c.id === 't1');
  const t2b = pull2.changes.find((c) => c.id === 't2');
  check('t1 内容已更新', t1b && t1b.data.title === '写报告(改)');
  check('t2 为软删除墓碑', t2b && t2b.deleted === true);

  const pullAll = await (await get('/api/sync?since=0', token)).json();
  check('全量拉取仍含墓碑（不物理删除）', pullAll.changes.some((c) => c.id === 't2' && c.deleted === true));

  console.log('== 5. 多用户数据隔离 ==');
  const reg2 = await (await post('/api/auth/register', { username: 'bob', password: 'secret456' })).json();
  const pullBob = await (await get('/api/sync?since=0', reg2.token)).json();
  check('bob 看不到 alice 的数据', pullBob.changes.length === 0);

  server.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
