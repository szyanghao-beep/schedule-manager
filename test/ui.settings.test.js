/*
 * ui.settings.test.js — 设置页「多端同步」卡片的渲染层 UI 测试（jsdom 真实 DOM）
 *
 * 覆盖纯函数测试碰不到的部分：
 *   - syncStatus() 的两种状态各自渲染出什么 DOM（登录表单 / 已登录操作区）
 *   - 点击「修改地址 / 保存地址 / 立即同步 / 退出登录 / 登录」是否真的触发 IPC 与状态变化
 *   - 异步渲染：同步卡片是 Promise 填充的，render() 返回时还是空的
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { setupUi, flush, FIXED_NOW } = require('./ui.helpers.js');

const SERVER = 'http://192.168.0.106:8787';

test('设置页 · 未登录时渲染登录表单（服务器地址/用户名/密码 + 登录按钮）', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: false, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();

  const card = h.cardByTitle('多端同步', root);

  // 三个输入框：服务器地址（预填上次用过的地址）/ 用户名 / 密码
  const inputs = h.qsa('input', card);
  assert.deepStrictEqual(inputs.map(function (i) { return i.type; }), ['text', 'text', 'password']);
  assert.deepStrictEqual(inputs.map(function (i) { return i.value; }), [SERVER, '', '']);

  // 每个输入框都在一行 form-row 里，label 文案正确
  const rows = h.formRows(card);
  assert.deepStrictEqual(rows.map(function (r) { return r.label; }), ['服务器地址', '用户名', '密码']);
  assert.deepStrictEqual(rows.map(function (r) { return r.type; }), ['text', 'text', 'password']);

  // 按钮：连接本机（回环，不怕换网段） + 填入局域网地址（给手机/队友用） + 登录 + 注册并登录
  assert.deepStrictEqual(h.texts('button', card),
    ['连接本机', '填入局域网地址', '登录', '注册并登录'],
    '实际：' + JSON.stringify(h.texts('button', card)));

  // 未登录时不出现已登录状态的操作按钮
  assert.strictEqual(h.allByText('button', '立即同步', root).length, 0);
  assert.strictEqual(h.allByText('button', '退出登录', root).length, 0);
});

test('设置页 · 同步卡片是异步渲染：render() 同步返回时内容还是空的，flush 后才有', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: true, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  const card = h.cardByTitle('多端同步', root);
  // render() 刚返回：syncStatus() 的 Promise 还没回来
  assert.strictEqual(h.allByText('button', '立即同步', card).length, 0, '同步卡片此时应为空（异步还没回）');

  await flush();
  assert.strictEqual(h.allByText('button', '立即同步', card).length, 1, 'flush 后应渲染出「立即同步」');
});

test('设置页 · 已登录时渲染 立即同步/修改地址/退出登录，且「修改地址」展开地址输入框', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: true, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);

  // 已登录信息行
  assert.ok(
    h.texts('.item-meta', card).some(function (s) { return s === '已登录服务器：' + SERVER; }),
    '应显示「已登录服务器：…」，实际：' + JSON.stringify(h.texts('.item-meta', card))
  );

  // 操作按钮（顺序即 DOM 顺序：账号信息区的「刷新我的权限」+ 地址编辑区两个 + 主操作三个）
  assert.deepStrictEqual(
    h.texts('button', card),
    ['刷新我的权限', '保存地址', '取消', '立即同步', '修改地址', '退出登录'],
    '实际：' + JSON.stringify(h.texts('button', card))
  );

  // 多账号：已登录时应显示当前账号与角色（普通用户不带「打开用户管理」）
  assert.ok(
    h.texts('.item-meta', card).some(function (s) { return s.indexOf('当前账号：') === 0; }),
    '应显示当前账号与角色，实际：' + JSON.stringify(h.texts('.item-meta', card))
  );
  assert.strictEqual(h.texts('button', card).indexOf('打开用户管理'), -1,
    '非管理员不应出现「打开用户管理」');

  // 「修改地址」默认收起，且地址输入框必须真的在文档里（曾出现只创建未挂载的 bug）
  const ipInput = h.qs('input', card);
  assert.ok(ipInput, '地址输入框应存在于卡片中');
  assert.strictEqual(ipInput.value, SERVER);
  assert.strictEqual(ipInput.closest('.card'), card, '地址输入框必须挂在同步卡片上');
  const editBox = ipInput.closest('.form-row').parentNode;
  assert.strictEqual(editBox.style.display, 'none');

  // 点「修改地址」→ 展开；再点 → 收起
  h.clickText('button', '修改地址', card);
  assert.notStrictEqual(editBox.style.display, 'none', '点「修改地址」后地址输入框应可见');
  h.clickText('button', '修改地址', card);
  assert.strictEqual(editBox.style.display, 'none', '再点一次应收起');

  // 「取消」也收起
  h.clickText('button', '修改地址', card);
  h.clickText('button', '取消', card);
  assert.strictEqual(editBox.style.display, 'none');
});

test('设置页 · 改地址并保存：调用 syncSetServer 并把新地址渲染出来', async function (t) {
  const NEW_SERVER = 'http://10.0.0.9:8787';
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: true, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);

  h.clickText('button', '修改地址', card);
  const ipInput = h.qs('input', card);
  ipInput.value = NEW_SERVER;
  // 保存成功后重新查询状态会返回新地址
  h.api.__set('syncStatus', { loggedIn: true, serverUrl: NEW_SERVER });

  h.clickText('button', '保存地址', card);
  await flush();

  assert.strictEqual(h.api.__count('syncSetServer'), 1, '应调用一次 syncSetServer');
  assert.deepStrictEqual(h.api.__lastArgs('syncSetServer'), [NEW_SERVER]);
  const card2 = h.cardByTitle('多端同步', root);
  assert.ok(
    h.texts('.item-meta', card2).some(function (s) { return s === '已登录服务器：' + NEW_SERVER; }),
    '保存后应显示新地址，实际：' + JSON.stringify(h.texts('.item-meta', card2))
  );
  assert.ok(h.toasts().indexOf('地址已更新，下次同步将全量对齐') >= 0, '应提示地址已更新：' + JSON.stringify(h.toasts()));
});

test('设置页 · 立即同步：调用 syncNow 并提示推送/拉取条数', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: true, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  h.api.__set('syncNow', { pushed: 3, pulled: 2 });

  h.clickText('button', '立即同步', h.cardByTitle('多端同步', root));
  await flush();

  assert.strictEqual(h.api.__count('syncNow'), 1);
  assert.deepStrictEqual(h.toasts(), ['同步完成：推送 3 条，拉取 2 条']);
});

test('设置页 · 退出登录：调用 syncLogout 并回到登录表单', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: true, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  assert.strictEqual(h.allByText('button', '退出登录', root).length, 1);

  // 退出后 syncStatus 会返回未登录
  h.api.__set('syncStatus', { loggedIn: false, serverUrl: SERVER });
  h.clickText('button', '退出登录', h.cardByTitle('多端同步', root));
  await flush();

  assert.strictEqual(h.api.__count('syncLogout'), 1);
  assert.ok(h.toasts().indexOf('已退出登录') >= 0);
  const card = h.cardByTitle('多端同步', root);
  assert.ok(h.texts('button', card).indexOf('登录') >= 0, '应回到登录表单，实际按钮：' + JSON.stringify(h.texts('button', card)));
  assert.ok(h.qs('input[type=password]', card) !== null, '登录表单应包含密码输入框');
  assert.strictEqual(h.qs('input', card).value, SERVER, '退出登录后仍预填原地址，避免用户反复手输');
});

test('设置页 · 登录：把地址/用户名/密码透传给 loginSync，成功后重渲染', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: false, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);
  const inputs = h.qsa('input', card);
  inputs[1].value = 'alice';
  inputs[2].value = 's3cret';

  // 登录成功后 syncStatus 变为已登录
  h.api.__set('syncStatus', { loggedIn: true, serverUrl: SERVER });
  h.clickText('button', '登录', card);
  await flush();

  assert.strictEqual(h.api.__count('loginSync'), 1);
  assert.deepStrictEqual(h.api.__lastArgs('loginSync'), [{
    serverUrl: SERVER, username: 'alice', password: 's3cret', register: false,
  }]);
  assert.deepStrictEqual(h.toasts(), ['登录成功']);
  assert.strictEqual(h.allByText('button', '立即同步', root).length, 1, '登录成功后应渲染已登录操作区');
});

test('设置页 · 注册并登录：register 标志为 true', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: false, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);
  const inputs = h.qsa('input', card);
  inputs[1].value = 'bob';
  inputs[2].value = 'pw';

  h.clickText('button', '注册并登录', card);
  await flush();

  assert.deepStrictEqual(h.api.__lastArgs('loginSync'), [{
    serverUrl: SERVER, username: 'bob', password: 'pw', register: true,
  }]);
  assert.deepStrictEqual(h.toasts(), ['注册并登录成功']);
});

test('设置页 · 登录失败：错误信息进 toast，不改变登录态', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: false, serverUrl: SERVER } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);
  const inputs = h.qsa('input', card);
  inputs[1].value = 'alice';
  inputs[2].value = 'wrong';
  h.api.__fail('loginSync', new Error('用户名或密码错误'));

  h.clickText('button', '登录', card);
  await flush();

  assert.deepStrictEqual(h.toasts(), ['登录失败：用户名或密码错误']);
  // 仍然是登录表单（没有被误判为已登录）
  assert.strictEqual(h.allByText('button', '立即同步', root).length, 0);
  assert.strictEqual(h.allByText('button', '登录', root).length, 1);
});

test('设置页 · 字段为空时点登录：本地拦截，不发 IPC', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: false, serverUrl: '' } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  h.clickText('button', '登录', h.cardByTitle('多端同步', root));
  await flush();

  assert.strictEqual(h.api.__count('loginSync'), 0, '三个字段都空时不应调用 loginSync');
  assert.deepStrictEqual(h.toasts(), ['请填写服务器地址、用户名和密码']);
});

test('★ 设置页 · 「连接本机」填入回环地址（换网络/换主机都不会失效）', async function (t) {
  // 用户明确反馈过「网段会随程序安装的主机变化」。
  // 本机自连时用 127.0.0.1 最稳：它永远指向本机，不受 IP / 网段 / 换电脑影响。
  const h = await setupUi({
    now: FIXED_NOW,
    api: {
      syncStatus: { loggedIn: false, serverUrl: '' },
      syncServerStatus: { running: true, port: 8787, ips: ['192.168.1.23'], url: 'http://192.168.1.23:8787', pairingCode: '246810' },
    },
  });
  t.after(function () { h.close(); });
  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);

  h.clickText('button', '连接本机', card);
  await flush();
  assert.strictEqual(h.qs('input', card).value, 'http://127.0.0.1:8787',
    '应填入回环地址，而不是会被网段变化影响的局域网 IP');
  assert.ok(h.toasts().some(function (s) { return s.indexOf('不受网段变化影响') >= 0; }),
    JSON.stringify(h.toasts()));
});

test('设置页 · 填入本机地址：点一次把同步服务的局域网地址填进服务器地址框', async function (t) {
  const h = await setupUi({
    now: FIXED_NOW,
    api: {
      syncStatus: { loggedIn: false, serverUrl: '' },
      syncServerStatus: { running: true, port: 8787, ips: ['192.168.1.23'], url: 'http://192.168.1.23:8787', pairingCode: '246810' },
    },
  });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('多端同步', root);

  h.clickText('button', '填入局域网地址', card);
  await flush();

  assert.strictEqual(h.qs('input', card).value, 'http://192.168.1.23:8787');
  assert.ok(h.toasts().indexOf('已填入本机地址 192.168.1.23') >= 0, JSON.stringify(h.toasts()));
  // 登录表单里的提示行应告知本机同步服务在运行，**并列出本机真实地址** ——
  // 手输 IP 写错网段是同步失败的最高频原因，把正确答案直接摆出来才能防止再填错。
  const hintTexts = h.texts('.item-meta', card);
  assert.ok(hintTexts.some(function (s) { return s.indexOf('本机同步服务运行中') >= 0; }),
    JSON.stringify(hintTexts));
  assert.ok(hintTexts.some(function (s) { return s.indexOf('192.168.1.23:8787') >= 0; }),
    '提示行应显示本机地址，便于用户核对：' + JSON.stringify(hintTexts));
});

test('设置页 · 本机同步服务开关：勾选后调用 syncServerStart 并显示地址与配对码', async function (t) {
  const h = await setupUi({
    now: FIXED_NOW,
    api: {
      syncStatus: { loggedIn: false, serverUrl: '' },
      syncServerStatus: { running: false, ips: [], port: 8787 },
    },
  });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();
  const card = h.cardByTitle('本机同步服务（同步中心）', root);
  assert.deepStrictEqual(h.texts('.item-meta', card).indexOf('已停止') >= 0, true, JSON.stringify(h.texts('.item-meta', card)));

  const cb = h.qs('input[type=checkbox]', card);
  assert.strictEqual(cb.checked, false);
  h.change(cb, true);
  await flush();

  assert.strictEqual(h.api.__count('syncServerStart'), 1);
  assert.strictEqual(cb.checked, true, '启动成功后应回勾');
  const metas = h.texts('.item-meta', card);
  assert.ok(metas.indexOf('运行中：http://192.168.0.106:8787') >= 0, JSON.stringify(metas));
  assert.ok(metas.indexOf('手机端填这个地址：http://192.168.0.106:8787') >= 0, JSON.stringify(metas));
  assert.ok(metas.some(function (s) { return s.indexOf('收集口令：246810') === 0; }), JSON.stringify(metas));
});

test('设置页 · 分类管理：渲染分类行，点删除后该行消失', async function (t) {
  const h = await setupUi({
    now: FIXED_NOW,
    data: {
      categories: [
        { id: 'c1', name: '工作', color: '#4f8ef7', isDefault: true, createdAt: 1 },
        { id: 'c2', name: '生活', color: '#4caf7d', isDefault: false, createdAt: 2 },
      ],
    },
    api: { syncStatus: { loggedIn: false, serverUrl: '' } },
  });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();

  const catCard = h.cardByTitle('分类管理', root);
  assert.deepStrictEqual(h.texts('.item-title', catCard), ['工作（默认）', '生活']);
  assert.deepStrictEqual(h.texts('button', catCard), ['+ 新增分类', '编辑', '删除', '编辑', '删除']);

  // confirm 已被宿主桩成 true，点「生活」那一行的删除
  h.click(h.allByText('button', '删除', catCard)[1]);
  await flush();

  const catCard2 = h.cardByTitle('分类管理', root);
  assert.deepStrictEqual(h.texts('.item-title', catCard2), ['工作（默认）']);
  assert.deepStrictEqual(h.Store.get().categories.map(function (c) { return c.name; }), ['工作']);
  assert.deepStrictEqual(h.toasts(), ['已删除']);
});

test('设置页 · 提醒默认值：改下拉框即写回 settings 并提示已保存', async function (t) {
  const h = await setupUi({ now: FIXED_NOW, api: { syncStatus: { loggedIn: false, serverUrl: '' } } });
  t.after(function () { h.close(); });

  const root = h.renderView('settings');
  await flush();

  const remindCard = h.cardByTitle('提醒默认值', root);
  const sel = h.qs('select', remindCard);
  assert.strictEqual(sel.value, '15', '默认值来自 store.settings.defaultRemindBefore');
  // 选项文案由 Utils.formatRemind 生成：0 -> 不提醒，60 -> 提前 1 小时
  assert.deepStrictEqual(h.texts('option', sel).slice(0, 3), ['不提醒', '提前 5 分钟', '提前 10 分钟']);

  h.change(sel, '60');
  await flush();

  assert.strictEqual(h.Store.get().settings.defaultRemindBefore, 60);
  assert.deepStrictEqual(h.toasts(), ['已保存']);
});
