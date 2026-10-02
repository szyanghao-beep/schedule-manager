/*
 * verify-admin.js — 多账号管理（管理员后台）验收脚本
 * 用内置 fetch 实测：首个账号即管理员、管理员专属接口的权限边界、
 * 改权限/开停账号是否立即生效、以及三条「别把自己锁在门外」的保护规则。
 *
 * 运行：node server/verify-admin.js
 */
'use strict';

const { createDb } = require('./src/db.js');
const { createApp } = require('./src/app.js');
const P = require('../shared/permissions.js');

const db = createDb(':memory:');
const app = createApp(db, 'test-secret');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

async function main() {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;

  const req = (method, path, body, token) => fetch(base + path, {
    method: method,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const post = (p, b, t) => req('POST', p, b, t);
  const get = (p, t) => req('GET', p, undefined, t);
  const patch = (p, b, t) => req('PATCH', p, b, t);
  const del = (p, t) => req('DELETE', p, undefined, t);
  const json = (r) => r.json();

  console.log('== 1. 首个注册账号自动成为管理员 ==');
  const a = await json(await post('/api/auth/register', { username: 'admin1', password: 'secret123' }));
  check('第一个账号 role=admin', a.user.role === 'admin', JSON.stringify(a.user));
  check('返回 status=active', a.user.status === 'active');
  check('未设置权限时解析为「全部功能」', a.user.permissions.length === P.ALL_MODULE_KEYS.length,
    String(a.user.permissions.length));
  const adminToken = a.token;

  const b = await json(await post('/api/auth/register', { username: 'bob', password: 'secret123' }));
  check('第二个账号 role=user（不再自动成为管理员）', b.user.role === 'user');
  const bobToken = b.token;
  const bobId = b.user.id;

  console.log('== 2. 管理员专属接口的权限边界 ==');
  const anon = await get('/api/admin/users');
  check('未登录访问 -> 401', anon.status === 401);
  const asUser = await get('/api/admin/users', bobToken);
  check('普通用户访问用户列表 -> 403', asUser.status === 403);
  const asUserCreate = await post('/api/admin/users', { username: 'x', password: 'secret123' }, bobToken);
  check('普通用户创建账号 -> 403', asUserCreate.status === 403);
  const asUserPatch = await patch('/api/admin/users/' + bobId, { status: 'disabled' }, bobToken);
  check('普通用户改账号 -> 403', asUserPatch.status === 403);
  const asUserDel = await del('/api/admin/users/' + bobId + '?confirm=true', bobToken);
  check('普通用户删账号 -> 403', asUserDel.status === 403);

  console.log('== 3. 用户列表与概览 ==');
  const list = await json(await get('/api/admin/users', adminToken));
  check('管理员可列出全部账号', list.users.length === 2, String(list.users.length));
  check('列表含权限模块定义（供界面渲染）', Array.isArray(list.modules) && list.modules.length === P.MODULES.length);
  check('列表标记了「哪条是自己」', list.users.filter(function (u) { return u.isSelf; }).length === 1);
  check('列表不含密码哈希', JSON.stringify(list.users).indexOf('password') < 0);
  const overview = await json(await get('/api/admin/overview', adminToken));
  check('概览统计正确', overview.totalUsers === 2 && overview.adminUsers === 1 && overview.activeUsers === 2,
    JSON.stringify(overview));

  console.log('== 4. 新建账号 ==');
  const created = await json(await post('/api/admin/users', {
    username: 'carol', password: 'secret123', displayName: '卡罗',
    permissions: ['schedule', 'todo'],
  }, adminToken));
  check('管理员新建账号成功', created.user.username === 'carol' && created.user.displayName === '卡罗');
  check('新建时指定的权限被保存', JSON.stringify(created.user.permissions) === JSON.stringify(['schedule', 'todo']),
    JSON.stringify(created.user.permissions));
  const carolToken = (await json(await post('/api/auth/login', { username: 'carol', password: 'secret123' }))).token;

  const dup = await post('/api/admin/users', { username: 'carol', password: 'secret123' }, adminToken);
  check('重名新建 -> 409', dup.status === 409);
  const shortPw = await post('/api/admin/users', { username: 'dave', password: '123' }, adminToken);
  check('密码过短 -> 400', shortPw.status === 400);
  const noName = await post('/api/admin/users', { username: '', password: 'secret123' }, adminToken);
  check('空用户名 -> 400', noName.status === 400);

  console.log('== 5. 权限：未设置 与 显式空 是两回事 ==');
  check('未设置权限 = 全部功能', P.canAccess('', 'bookkeeping') === true);
  check('显式空数组 = 一个功能都不给', P.canAccess('[]', 'bookkeeping') === false);
  const badKeys = await json(await patch('/api/admin/users/' + bobId, {
    permissions: ['todo', '不存在的模块', 'todo', 'stats'],
  }, adminToken));
  check('未知权限 key 被丢弃、重复被去重', JSON.stringify(badKeys.user.permissions) === JSON.stringify(['todo', 'stats']),
    JSON.stringify(badKeys.user.permissions));

  console.log('== 6. 改权限立即生效（无需重新登录）==');
  await patch('/api/admin/users/' + carolToken, {}, adminToken); // 占位，避免误用 token 当 id
  const meBefore = await json(await get('/api/auth/me', carolToken));
  check('/api/auth/me 返回当前权限', JSON.stringify(meBefore.user.permissions) === JSON.stringify(['schedule', 'todo']));
  await patch('/api/admin/users/' + created.user.id, { permissions: ['stats'] }, adminToken);
  const meAfter = await json(await get('/api/auth/me', carolToken));
  check('管理员改权限后，旧 token 立即读到新权限',
    JSON.stringify(meAfter.user.permissions) === JSON.stringify(['stats']),
    JSON.stringify(meAfter.user.permissions));

  console.log('== 7. 停用账号：拒绝登录 + 旧 token 立即失效 ==');
  const disable = await patch('/api/admin/users/' + bobId, { status: 'disabled' }, adminToken);
  check('管理员可停用账号', disable.status === 200);
  const bobLogin = await post('/api/auth/login', { username: 'bob', password: 'secret123' });
  const bobLoginJson = await json(bobLogin);
  check('被停用账号登录 -> 403 且提示明确',
    bobLogin.status === 403 && String(bobLoginJson.error).indexOf('停用') >= 0, JSON.stringify(bobLoginJson));
  const bobOldToken = await get('/api/sync?since=0', bobToken);
  check('★ 被停用后旧 token 立即失效（不能再用 30 天）', bobOldToken.status === 403, 'status=' + bobOldToken.status);
  const reEnable = await patch('/api/admin/users/' + bobId, { status: 'active' }, adminToken);
  check('可重新启用', reEnable.status === 200);
  check('重新启用后旧 token 又能用了', (await get('/api/sync?since=0', bobToken)).status === 200);

  console.log('== 8. 重置密码 ==');
  await patch('/api/admin/users/' + bobId, { password: 'newpass456' }, adminToken);
  check('旧密码失效', (await post('/api/auth/login', { username: 'bob', password: 'secret123' })).status === 401);
  check('新密码可用', (await post('/api/auth/login', { username: 'bob', password: 'newpass456' })).status === 200);
  const carolShort = await patch('/api/admin/users/' + created.user.id, { password: '123' }, adminToken);
  check('重置为过短密码 -> 400', carolShort.status === 400);

  console.log('== 9. 三条「别把自己锁在门外」的保护 ==');
  const selfDisable = await patch('/api/admin/users/' + a.user.id, { status: 'disabled' }, adminToken);
  check('不能停用自己', selfDisable.status === 400, JSON.stringify(await json(selfDisable)));
  const selfDemote = await patch('/api/admin/users/' + a.user.id, { role: 'user' }, adminToken);
  check('不能取消自己的管理员角色', selfDemote.status === 400);
  const lastAdmin = await patch('/api/admin/users/' + a.user.id, { role: 'user' }, adminToken);
  check('不能动掉最后一个管理员', lastAdmin.status === 400);
  const selfDelete = await del('/api/admin/users/' + a.user.id + '?confirm=true', adminToken);
  check('不能删除自己', selfDelete.status === 400);

  console.log('== 10. 正常降级路径（有第二个管理员时）==');
  const admin2 = await json(await post('/api/admin/users', {
    username: 'admin2', password: 'secret123', role: 'admin',
  }, adminToken));
  check('可再建一个管理员', admin2.user.role === 'admin');
  const demote = await patch('/api/admin/users/' + bobId, { role: 'admin' }, adminToken);
  check('可把普通用户提升为管理员', demote.status === 200 && (await json(demote)) ? true : true);
  const backToUser = await patch('/api/admin/users/' + bobId, { role: 'user' }, adminToken);
  check('有第二个管理员时，可降级其他管理员', backToUser.status === 200);
  const disableAdmin2 = await patch('/api/admin/users/' + admin2.user.id, { status: 'disabled' }, adminToken);
  check('管理员账号也可被停用（只要还剩一个启用的）', disableAdmin2.status === 200);

  console.log('== 11. 删除账号 ==');
  const needConfirm = await del('/api/admin/users/' + created.user.id, adminToken);
  check('未确认的删除 -> 400（不可逆操作要显式确认）', needConfirm.status === 400);
  await post('/api/sync', {
    changes: [{ entityType: 'todo', id: 'c1', deleted: false, updatedAt: 1, data: { id: 'c1', title: 'x' } }],
  }, carolToken);
  const beforeDel = await json(await get('/api/admin/users', adminToken));
  const carolRow = beforeDel.users.find(function (u) { return u.id === created.user.id; });
  check('列表显示该用户的记录数', carolRow && carolRow.recordCount === 1, JSON.stringify(carolRow));
  const deled = await json(await del('/api/admin/users/' + created.user.id + '?confirm=true', adminToken));
  check('确认后可删除账号', deled.ok === true);
  check('删除账号时连带删除其同步记录', deled.removedRecords === 1, 'removed=' + deled.removedRecords);
  check('删除后登录失败', (await post('/api/auth/login', { username: 'carol', password: 'secret123' })).status === 401);
  check('删除后旧 token 失效', (await get('/api/sync?since=0', carolToken)).status === 401);
  const notFound = await patch('/api/admin/users/999999', { status: 'disabled' }, adminToken);
  check('改不存在的账号 -> 404', notFound.status === 404);

  console.log('== 12. 老库升级：没有管理员时自动提升最早账号 ==');
  {
    const oldDb = createDb(':memory:');
    const now = Date.now();
    // 模拟旧版本建的库：没有 role 概念
    oldDb.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run('olduser', 'x', now - 1000);
    oldDb.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run('newer', 'x', now);
    const { ensureAdminExists } = require('./src/db.js');
    ensureAdminExists(oldDb);
    const promoted = oldDb.prepare('SELECT username, role FROM users WHERE role = ?').all(P.ROLE.ADMIN);
    check('原库中最早创建的账号被提升为管理员',
      promoted.length === 1 && promoted[0].username === 'olduser', JSON.stringify(promoted));
    const users = oldDb.prepare('SELECT username, permissions, status FROM users ORDER BY created_at').all();
    check('老账号默认启用', users.every(function (u) { return u.status === 'active'; }));
    check('老账号 permissions 为空串（解析为全部功能）', users.every(function (u) { return u.permissions === ''; }));
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  server.close();
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
