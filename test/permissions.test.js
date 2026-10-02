/*
 * permissions.test.js — 角色 / 状态 / 功能权限模型测试
 *
 * 重点锁住「未设置 与 显式空 是两回事」这条语义：
 *   老版本建的账号没有 permissions 字段（''），必须默认「全部功能」，
 *   否则升级后老用户会发现所有功能都不见了。
 */
const test = require('node:test');
const assert = require('node:assert');
const P = require('../shared/permissions.js');

test('角色与状态规整：非法值一律回落到最保守的取值', function () {
  assert.strictEqual(P.normalizeRole('admin'), 'admin');
  assert.strictEqual(P.normalizeRole('user'), 'user');
  assert.strictEqual(P.normalizeRole('superuser'), 'user', '未知角色不能变成管理员');
  assert.strictEqual(P.normalizeRole(undefined), 'user');
  assert.strictEqual(P.normalizeRole(null), 'user');

  assert.strictEqual(P.normalizeStatus('active'), 'active');
  assert.strictEqual(P.normalizeStatus('disabled'), 'disabled');
  assert.strictEqual(P.normalizeStatus('weird'), 'active');
  assert.strictEqual(P.normalizeStatus(undefined), 'active');
});

test('isAdmin / isActive：以规整后的值为准', function () {
  assert.strictEqual(P.isAdmin({ role: 'admin' }), true);
  assert.strictEqual(P.isAdmin({ role: 'user' }), false);
  assert.strictEqual(P.isAdmin({}), false);
  assert.strictEqual(P.isAdmin(null), false);
  assert.strictEqual(P.isActive({ status: 'active' }), true);
  assert.strictEqual(P.isActive({ status: 'disabled' }), false);
  assert.strictEqual(P.isActive(null), false);
});

test('★ 未设置权限 = 全部功能（老账号升级后不能突然没权限）', function () {
  assert.strictEqual(P.resolvePermissions('').length, P.ALL_MODULE_KEYS.length);
  assert.strictEqual(P.resolvePermissions(null).length, P.ALL_MODULE_KEYS.length);
  assert.strictEqual(P.resolvePermissions(undefined).length, P.ALL_MODULE_KEYS.length);
  assert.strictEqual(P.canAccess('', 'bookkeeping'), true);
  assert.strictEqual(P.canAccess(null, 'customer'), true);
});

test('★ 显式空数组 = 一个功能都不给（与「未设置」区分开）', function () {
  assert.deepStrictEqual(P.resolvePermissions([]), []);
  assert.strictEqual(P.canAccess('[]', 'bookkeeping'), false);
  assert.strictEqual(P.canAccess('[]', 'todo'), false);
});

test('sanitizePermissions：丢弃未知 key、去重、并保持模块定义的顺序', function () {
  const out = P.sanitizePermissions(['stats', 'todo', '不存在的模块', 'todo', 'schedule']);
  // 顺序按 MODULES 定义（schedule 在 todo 之前，stats 最后），而不是输入顺序
  assert.deepStrictEqual(out, ['schedule', 'todo', 'stats']);
  assert.deepStrictEqual(P.sanitizePermissions([]), []);
  assert.deepStrictEqual(P.sanitizePermissions('nonsense'), []);
  assert.deepStrictEqual(P.sanitizePermissions(null), []);
  assert.deepStrictEqual(P.sanitizePermissions(123), []);
});

test('sanitizePermissions：支持 JSON 字符串与逗号分隔串（服务端存的是 JSON）', function () {
  assert.deepStrictEqual(P.sanitizePermissions('["todo","stats"]'), ['todo', 'stats']);
  assert.deepStrictEqual(P.sanitizePermissions('todo,stats'), ['todo', 'stats']);
  assert.deepStrictEqual(P.sanitizePermissions('  ["todo"]  '), ['todo']);
  assert.deepStrictEqual(P.sanitizePermissions('[坏掉的 json'), [], '解析失败应返回空而不是抛错');
});

test('canAccess：设置永远可用（否则用户连引导和改密码都进不去）', function () {
  assert.strictEqual(P.canAccess([], 'settings'), true);
  assert.strictEqual(P.canAccess('[]', 'settings'), true);
  assert.strictEqual(P.canAccess(null, 'settings'), true);
  assert.ok(P.ALWAYS_ALLOWED.indexOf('settings') >= 0);
});

test('serializePermissions：统一存成 JSON，空数组存 []（不是空串）', function () {
  assert.strictEqual(P.serializePermissions(['todo']), '["todo"]');
  assert.strictEqual(P.serializePermissions([]), '[]');
  // 存成 '[]' 后必须解析回「一个都不给」，不能变成「全部」
  assert.strictEqual(P.canAccess(P.serializePermissions([]), 'todo'), false);
});

test('permissionSummary：给界面用的中文摘要', function () {
  assert.strictEqual(P.permissionSummary(null), '全部功能');
  assert.strictEqual(P.permissionSummary(''), '全部功能');
  assert.strictEqual(P.permissionSummary([]), '无功能权限');
  assert.strictEqual(P.permissionSummary(['todo', 'stats']), '待办、统计');
});

test('MODULES 与渲染层视图一一对应（新增功能模块时必须同步）', function () {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf-8');
  const navViews = [];
  const re = /class="nav-item[^"]*"\s+data-view="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) navViews.push(m[1]);

  // settings 与 admin 不参与权限勾选：settings 永远可用，admin 由角色决定
  const controllable = navViews.filter(function (v) {
    return v !== 'settings' && v !== 'admin';
  });
  assert.deepStrictEqual(
    P.ALL_MODULE_KEYS.slice().sort(),
    controllable.slice().sort(),
    '可授权的功能模块必须与导航项一致，实际导航：' + navViews.join(', ')
  );
});
