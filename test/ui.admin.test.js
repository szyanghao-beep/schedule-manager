/*
 * ui.admin.test.js — 用户管理（管理员后台）界面测试
 *
 * 覆盖真实痛点：
 *   - 管理员与普通用户的界面必须**分开**：普通用户看不到、也切不进「用户管理」
 *   - 管理员能改权限 / 开停账号，且**确实把参数发给了服务端**（不是只改了界面）
 *   - 服务端的保护规则要在界面上提前禁掉（不能停用自己、不能动最后一个管理员）
 *   - 按权限隐藏无权限的功能模块
 *
 * 关于登录态：用桩的 __sync() 改「主进程那边的状态机」，再走真实的 App.refreshAccess()
 * 重新计算导航显隐 —— 这样测的是真实链路，而不是把 syncStatus 整个替换掉（那样会
 * 绕过 isAdmin 的推导，测不出问题）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const helpers = require('./ui.helpers.js');
const { setupUi, flush, FIXED_NOW } = helpers;

const P = require('../shared/permissions.js');
const DAY = 86400000;

// 以指定登录态启动（默认管理员），并让界面按该状态重算一次
async function setupAs(patch) {
  const h = await setupUi({ now: FIXED_NOW });
  h.api.__sync(Object.assign({ loggedIn: true, role: 'admin', username: '管理员甲' }, patch || {}));
  await h.App.refreshAccess();
  return h;
}

function sampleUsers() {
  return [
    {
      id: 1, username: 'admin1', displayName: '管理员甲', role: 'admin', status: 'active',
      permissions: P.ALL_MODULE_KEYS.slice(), createdAt: FIXED_NOW - 10 * DAY,
      lastLoginAt: FIXED_NOW, recordCount: 12, isSelf: true,
    },
    {
      id: 2, username: 'bob', displayName: '', role: 'user', status: 'active',
      permissions: ['schedule', 'todo'], createdAt: FIXED_NOW - DAY,
      lastLoginAt: FIXED_NOW - 3600 * 1000, recordCount: 3, isSelf: false,
    },
    {
      id: 3, username: 'carol', displayName: '', role: 'user', status: 'disabled',
      permissions: [], createdAt: FIXED_NOW, lastLoginAt: 0, recordCount: 0, isSelf: false,
    },
  ];
}

async function openAdmin(h, users) {
  h.api.__state.admin.users = users || sampleUsers();
  h.renderView('admin');
  await flush();
  return h.view('admin');
}

function cardOf(h, root, username) {
  return h.qsa('.card', root).find(function (c) { return c.textContent.indexOf(username) >= 0; });
}

test('用户管理 · 管理员可见入口并渲染账号列表与统计', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  assert.strictEqual(h.qs('.nav-item-admin').hidden, false, '管理员的「用户管理」入口应可见');

  const root = await openAdmin(h);
  assert.ok(root.innerHTML.length > 200, '应渲染出内容');

  assert.deepStrictEqual(h.texts('.stat-label', root), ['账号总数', '启用中', '管理员', '同步记录']);
  assert.deepStrictEqual(h.texts('.stat-value', root), ['3', '2', '1', '15'],
    '实际：' + JSON.stringify(h.texts('.stat-value', root)));

  assert.ok(h.texts('.item-title', root).indexOf('admin1（管理员甲）') >= 0,
    JSON.stringify(h.texts('.item-title', root)));
  assert.ok(h.texts('.badge', root).indexOf('管理员') >= 0);
  assert.ok(h.texts('.badge', root).indexOf('已停用') >= 0);
  assert.ok(h.texts('.badge', root).indexOf('当前登录') >= 0, '自己那行要有标记');
});

test('用户管理 · 权限摘要按账号显示（未设置=全部功能、空=无功能权限）', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  const root = await openAdmin(h);
  const metas = h.texts('.item-meta', root);
  assert.ok(metas.some(function (s) { return s === '功能权限：全部功能'; }), JSON.stringify(metas));
  assert.ok(metas.some(function (s) { return s === '功能权限：日程、待办'; }), JSON.stringify(metas));
  assert.ok(metas.some(function (s) { return s === '功能权限：无功能权限'; }), JSON.stringify(metas));
});

test('★ 用户管理 · 不能停用/降级/删除自己（按钮提前禁用，不必靠报错才知道）', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  const root = await openAdmin(h);
  const selfCard = cardOf(h, root, 'admin1');
  assert.ok(selfCard, '应能找到自己那一行');

  ['停用账号', '取消管理员', '删除'].forEach(function (label) {
    const btn = h.allByText('button', label, selfCard)[0];
    assert.ok(btn, '自己那行应有「' + label + '」按钮');
    assert.strictEqual(btn.disabled, true, '「' + label + '」对当前登录账号应禁用');
    assert.ok(btn.title, '禁用时要给出原因（title）');
  });
});

test('★ 用户管理 · 管理员保护的界面表现', async function (t) {
  // 两个启用管理员 → 可以停用「别人」
  const two = sampleUsers();
  two.push({
    id: 4, username: 'admin9', displayName: '', role: 'admin', status: 'active',
    permissions: [], createdAt: FIXED_NOW, lastLoginAt: 0, recordCount: 0, isSelf: false,
  });
  const h = await setupAs();
  t.after(function () { h.close(); });
  const root = await openAdmin(h, two);
  const card9 = cardOf(h, root, 'admin9');
  assert.ok(card9, '应能找到 admin9');
  assert.strictEqual(h.allByText('button', '停用账号', card9)[0].disabled, false,
    '有两个启用管理员时可以停用其中一个');
  assert.strictEqual(h.allByText('button', '取消管理员', card9)[0].disabled, false);

  // 防御性分支：列表里若「唯一启用的管理员」不是自己，也要禁用。
  // 说明：正常数据下这条走不到 —— 能打开本页的人自己必然是启用管理员，
  // 而列表包含全部账号。这里显式构造出来，是为了保证该分支一旦被触发行为正确；
  // 「系统必须保留至少一个启用管理员」的真正保证在服务端（server/verify-admin.js）。
  const h2 = await setupAs();
  t.after(function () { h2.close(); });
  const onlyOther = [
    { id: 9, username: 'admin9', displayName: '', role: 'admin', status: 'active',
      permissions: [], createdAt: FIXED_NOW, lastLoginAt: 0, recordCount: 0, isSelf: false },
    { id: 2, username: 'bob', displayName: '', role: 'user', status: 'active',
      permissions: [], createdAt: FIXED_NOW, lastLoginAt: 0, recordCount: 0, isSelf: false },
  ];
  const root2 = await openAdmin(h2, onlyOther);
  const card9b = cardOf(h2, root2, 'admin9');
  assert.strictEqual(h2.allByText('button', '停用账号', card9b)[0].disabled, true,
    '唯一启用的管理员（非自己）也不能被停用');
  assert.strictEqual(h2.allByText('button', '取消管理员', card9b)[0].disabled, true);
  assert.strictEqual(h2.allByText('button', '删除', card9b)[0].disabled, true);
});

test('用户管理 · 勾选并保存权限：参数确实发给服务端且只含勾选项', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  const root = await openAdmin(h);
  h.clickText('button', '设置权限', cardOf(h, root, 'bob'));

  // ⚠️ render() 是整体重建 DOM：点击后旧卡片节点已脱离文档，
  //    必须重新取，否则查到的是过期节点（会得到 0 个勾选框）。
  const bobCard = cardOf(h, h.view('admin'), 'bob');
  assert.strictEqual(h.qsa('.perm-item input[type=checkbox]', bobCard).length, P.MODULES.length,
    '应列出全部功能模块');
  assert.strictEqual(h.qsa('.perm-item input[type=checkbox]', bobCard)
    .filter(function (b) { return b.checked; }).length, 2, 'bob 原本只有两个模块');

  // 全不选 → 只勾「统计」→ 保存（「全不选」只改勾选态，不重建 DOM）
  h.clickText('button', '全不选', bobCard);
  const names = h.texts('.perm-item-name', bobCard);
  const statIdx = names.indexOf('统计');
  assert.ok(statIdx >= 0, '应有「统计」模块：' + JSON.stringify(names));
  h.qsa('.perm-item input[type=checkbox]', bobCard)[statIdx].checked = true;
  h.clickText('button', '保存权限', bobCard);
  await flush();

  const args = h.api.__lastArgs('adminUpdateUser');
  assert.ok(args, '应调用了 adminUpdateUser');
  assert.strictEqual(args[0], 2, '应对 bob(id=2) 生效，实际：' + JSON.stringify(args));
  assert.deepStrictEqual(args[1], { permissions: ['stats'] },
    '只应提交勾选项，实际：' + JSON.stringify(args[1]));
});

test('用户管理 · 开停账号与重置密码的按钮行为', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  let root = await openAdmin(h);
  const carolCard = cardOf(h, root, 'carol');
  assert.ok(h.allByText('button', '启用账号', carolCard).length > 0,
    '已停用的账号按钮应显示「启用账号」');
  h.clickText('button', '启用账号', carolCard);
  await flush();
  let args = h.api.__lastArgs('adminUpdateUser');
  assert.strictEqual(args[0], 3);
  assert.deepStrictEqual(args[1], { status: 'active' });

  // 重置密码：先试过短的（应就地拦下、不发请求），再试合法的
  root = h.view('admin');
  h.clickText('button', '重置密码', cardOf(h, root, 'bob'));
  assert.strictEqual(h.text('#modal-root .modal-title'), '重置密码');
  const pwInput = h.qs('#modal-root input[type=password]');
  pwInput.value = '123';
  h.clickText('button', '保存', h.qs('#modal-root .modal-footer'));
  await flush();
  assert.ok(h.toasts().some(function (s) { return s.indexOf('至少 6 位') >= 0; }),
    '过短密码应就地拦下：' + JSON.stringify(h.toasts()));
  assert.strictEqual(h.api.__count('adminUpdateUser'), 1, '校验不通过时不应再发请求');

  pwInput.value = 'newpass456';
  h.clickText('button', '保存', h.qs('#modal-root .modal-footer'));
  await flush();
  args = h.api.__lastArgs('adminUpdateUser');
  assert.strictEqual(args[0], 2);
  assert.deepStrictEqual(args[1], { password: 'newpass456' });
});

test('用户管理 · 删除需要确认，文案说明会连带删除数据且不可恢复', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  const root = await openAdmin(h);
  h.clickText('button', '删除', cardOf(h, root, 'bob'));
  const body = h.qs('#modal-root .modal-body');
  assert.ok(body, '应弹出确认框');
  assert.ok(body.textContent.indexOf('3') >= 0, '应提示该账号有 3 条数据会被一起删除：' + body.textContent);
  assert.ok(body.textContent.indexOf('无法恢复') >= 0, '应明确不可恢复');
  assert.ok(body.textContent.indexOf('停用') >= 0, '应提示「只是不想让对方用」可以改成停用');

  h.clickText('button', '确认删除', h.qs('#modal-root .modal-footer'));
  await flush();
  assert.strictEqual(h.api.__lastArgs('adminDeleteUser')[0], 2);
});

test('★ 普通用户看不到也进不了用户管理，且按权限隐藏未授权模块', async function (t) {
  const h = await setupAs({ role: 'user', permissions: ['todo', 'stats'] });
  t.after(function () { h.close(); });

  assert.strictEqual(h.qs('.nav-item-admin').hidden, true, '普通用户的「用户管理」入口必须隐藏');

  const visible = h.qsa('.nav-item').filter(function (b) { return !b.hidden; })
    .map(function (b) { return b.dataset.view; });
  assert.deepStrictEqual(visible, ['todo', 'stats', 'settings'],
    '应只剩授权的两个模块 + 始终可用的设置，实际：' + JSON.stringify(visible));

  // 切不进去（switchView 必须拦住，否则快捷键/引导跳转等入口会绕过）
  h.App.switchView('admin');
  assert.notStrictEqual(h.App.getView(), 'admin', '普通用户不应能切到用户管理');
  assert.strictEqual(h.view('admin').innerHTML.trim(), '', '未授权时用户管理视图应为空');
});

test('用户管理 · 未登录 / 非管理员时给出明确指引，而不是空白或假数据', async function (t) {
  // 未登录：管理员入口隐藏；即便直接渲染本视图，也要给出可操作指引
  const h = await setupUi({ now: FIXED_NOW });
  t.after(function () { h.close(); });
  assert.strictEqual(h.qs('.nav-item-admin').hidden, true, '未登录时不应显示管理员入口');
  h.Modules.admin.render();
  await flush();
  assert.ok(h.view('admin').textContent.indexOf('多端同步') >= 0,
    '未登录应指向「设置 → 多端同步」：' + h.view('admin').textContent.slice(0, 160));

  const h2 = await setupAs({ role: 'user', permissions: null });
  t.after(function () { h2.close(); });
  h2.Modules.admin.render();
  await flush();
  assert.ok(h2.view('admin').textContent.indexOf('不是管理员') >= 0,
    '应说明当前账号不是管理员：' + h2.view('admin').textContent.slice(0, 160));
});

test('用户管理 · 加载失败时显示错误并可重试（不假装成功）', async function (t) {
  const h = await setupAs();
  t.after(function () { h.close(); });

  h.api.__state.admin.users = sampleUsers();
  h.api.__state.admin.failWith = '服务器连接失败';
  h.renderView('admin');
  await flush();
  const root = h.view('admin');
  assert.ok(root.textContent.indexOf('加载失败') >= 0, '应显示失败原因：' + root.textContent.slice(0, 200));
  assert.ok(root.textContent.indexOf('服务器连接失败') >= 0, '应带上具体原因');
  assert.ok(h.texts('button', root).indexOf('重试') >= 0, '应提供重试');

  // 重试成功后就该正常显示列表（证明失败不是被永久缓存住的）
  h.api.__state.admin.failWith = null;
  h.clickText('button', '重试', root);
  await flush();
  assert.ok(h.texts('.stat-value', h.view('admin')).indexOf('3') >= 0,
    '重试后应显示真实数据：' + JSON.stringify(h.texts('.stat-value', h.view('admin'))));
});

test('设置页 · 管理员可见「打开用户管理」，普通用户不可见', async function (t) {
  const hA = await setupAs();
  t.after(function () { hA.close(); });
  hA.renderView('settings');
  await flush();
  assert.ok(hA.texts('button').indexOf('打开用户管理') >= 0, '管理员设置页应有入口');

  const hB = await setupAs({ role: 'user', permissions: null });
  t.after(function () { hB.close(); });
  hB.renderView('settings');
  await flush();
  assert.strictEqual(hB.texts('button').indexOf('打开用户管理'), -1, '普通用户设置页不应有入口');
});
