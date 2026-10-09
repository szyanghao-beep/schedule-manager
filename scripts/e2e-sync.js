/*
 * e2e-sync.js — 端到端同步验收（真实 Electron + 真实后端 + 真实 HTTP）
 *
 * 为什么单独做这一层：单元测试用的是纯函数，冒烟测试不碰同步，
 * 而用户报的故障恰恰发生在**层与层之间**：
 *
 *   界面新增客户 → 渲染层 Store → IPC 保存 → 主进程 data → 落盘 data.json → 推送服务器
 *
 * 这条链路里任何一环漏字段，用户看到的就是「同步之后客户没了」（v2.4.0 的真凶
 * 就是第 3 步：保存 payload 漏了 customers）。
 *
 * 本脚本逐个环节验证：
 *   1. 界面加的客户，必须出现在落盘的 data.json 里（漏字段就查不出来）；
 *   2. 推送后服务端 records 表里必须真的有这条客户；
 *   3. 模拟「另一台设备」在服务端写入/修改后，本机同步必须拉到并显示出来；
 *   4. 另一台设备删除（墓碑）后，本机同步必须真的删掉，且**护栏不能误拦**。
 *
 * 运行：npx electron scripts/e2e-sync.js    （或 npm run e2e:sync）
 * 退出码：0 = 全通过；1 = 有失败
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = path.join(os.tmpdir(), 'schedule-e2e-sync-' + Date.now());
const dbFile = path.join(tmpDir, 'sync-server.db');
process.env.SCHEDULE_USER_DATA_DIR = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const { app, BrowserWindow } = require('electron');
require('../main.js');

const { createDb } = require(path.join(__dirname, '..', 'server', 'src', 'db.js'));
const { createApp } = require(path.join(__dirname, '..', 'server', 'src', 'app.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

async function main() {
  await app.whenReady();
  await new Promise(function (r) { setTimeout(r, 2500); });

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('✘ 未创建主窗口'); app.exit(1); return; }
  const js = function (code) { return win.webContents.executeJavaScript(code); };

  // ---- 起一个真实后端（就是 server/ 那份代码，内存外的真实 HTTP 服务）----
  const db = createDb(dbFile);
  const server = createApp(db, 'e2e-secret', { version: 'e2e' });
  const http = await new Promise(function (resolve) {
    const sv = server.listen(0, '127.0.0.1', function () { resolve(sv); });
  });
  const base = 'http://127.0.0.1:' + http.address().port;
  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e-user', password: 'pw123456' }),
  });
  const regJson = await reg.json();
  check('真实后端已就绪且能注册账号', !!regJson.token, JSON.stringify(regJson).slice(0, 120));

  // 关掉新手引导，避免遮罩影响后续操作
  await js(`(function () {
    try { window.localStorage.setItem('schedule.guide.v1', JSON.stringify({ doneVersion: 99, dismissedTips: {} })); } catch (e) {}
    if (window.Guide && window.Guide.closeTip) window.Guide.closeTip();
    document.getElementById('modal-root').innerHTML = '';
    return true;
  })()`);

  console.log('== 1. 登录到后端 ==');
  const setRes = await js(`window.API.syncSetServer(${JSON.stringify(base)})`);
  check('同步地址设置成功', !!setRes && setRes.serverUrl === base, JSON.stringify(setRes));
  // 与界面一致：登录时同时带上服务器地址（设置页也是这么调的）
  const login = await js(`window.API.loginSync({ serverUrl: ${JSON.stringify(base)}, username: 'e2e-user', password: 'pw123456' })`);
  check('登录成功（拿到 token）', !!login && (login.ok === true || !!login.token), JSON.stringify(login).slice(0, 160));

  console.log('== 2. 界面新增客户 → 必须落盘（这正是丢客户的环节）==');
  await js(`window.Store.addCustomer({
    id: 'e2e-cust-1', name: '端到端客户甲', company: '端到端科技有限公司',
    contact: '张经理', phone: '13900000001', owner: '张三', stage: 'contacted',
  }); true`);
  // 保存是 500ms 防抖 + 原子写盘，多等一会儿确保写到磁盘
  await new Promise(function (r) { setTimeout(r, 1500); });

  // 先看**主进程内存**里有没有（区分「渲染层没发上来」和「写盘延迟」，
  // 这两种原因的修法完全不同，测试必须能分辨）
  const inMain = await js(`(async function () {
    const d = await window.API.loadData();
    return (d && d.customers || []).map(function (c) { return c.id; });
  })()`);
  check('★ 界面加的客户已到达主进程数据（保存 payload 漏字段的回归点）',
    Array.isArray(inMain) && inMain.indexOf('e2e-cust-1') >= 0, JSON.stringify(inMain));

  const dataFile = path.join(tmpDir, 'data.json');
  let onDisk = null;
  try { onDisk = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) { onDisk = null; }
  check('data.json 已写入', !!onDisk);
  const diskCustomers = (onDisk && onDisk.customers) || [];
  check('★ 界面加的客户真的落盘了（重启后还在）',
    diskCustomers.some(function (c) { return c.id === 'e2e-cust-1'; }),
    'data.json 里 customers=' + JSON.stringify(diskCustomers.map(function (c) { return c.name; })));

  console.log('== 3. 推送：服务端必须有这条客户 ==');
  const pushRes = await js('window.API.syncNow()');
  check('syncNow 未报错', !!pushRes, JSON.stringify(pushRes).slice(0, 160));
  const row = db.prepare(
    "SELECT * FROM records WHERE entity_type = 'customer' AND entity_id = 'e2e-cust-1'"
  ).get();
  check('★ 服务端 records 表里真的有这条客户', !!row && !row.deleted,
    row ? JSON.stringify(row).slice(0, 120) : '（没查到记录）');
  if (row) {
    const d = JSON.parse(row.data_json);
    check('服务端保存的内容完整（含姓名/公司）',
      d.name === '端到端客户甲' && d.company === '端到端科技有限公司', JSON.stringify(d).slice(0, 120));
  }

  console.log('== 4. 拉取：另一台设备的新增必须出现在本机 ==');
  // 模拟「另一台设备」直接在服务端写一条新客户（等价于它推送到服务器）
  const now = Date.now();
  db.prepare(`INSERT INTO records (user_id, entity_type, entity_id, deleted, updated_at, client_updated_at, data_json)
    VALUES (?, 'customer', 'e2e-cust-2', 0, ?, ?, ?)`).run(
    regJson.user.id, now + 1000, now,
    JSON.stringify({ id: 'e2e-cust-2', name: '另一台设备加的客户', company: 'B 公司', stage: 'lead',
      amountHistory: [], stageHistory: [] }));
  await js('window.API.syncNow()');
  await new Promise(function (r) { setTimeout(r, 300); });
  const names = await js('window.Store.get().customers.filter(function (c) { return !c.deleted; }).map(function (c) { return c.name; })');
  check('★ 另一台设备新增的客户已同步到本机',
    Array.isArray(names) && names.indexOf('另一台设备加的客户') >= 0, JSON.stringify(names));
  check('本机原有客户没有被同步清空（用户报的故障）',
    Array.isArray(names) && names.indexOf('端到端客户甲') >= 0, JSON.stringify(names));

  console.log('== 5. 另一台设备修改后，本机要看到新内容 ==');
  db.prepare(`UPDATE records SET updated_at = ?, client_updated_at = ?, data_json = ?
    WHERE entity_type = 'customer' AND entity_id = 'e2e-cust-1'`).run(
    now + 5000, now + 5000,
    JSON.stringify({ id: 'e2e-cust-1', name: '端到端客户甲（B 已改名）', company: '端到端科技有限公司',
      contact: '张经理', owner: '李四', stage: 'negotiation', amountHistory: [], stageHistory: [] }));
  await js('window.API.syncNow()');
  await new Promise(function (r) { setTimeout(r, 300); });
  const after = await js(`(function () {
    const c = window.Store.get().customers.filter(function (x) { return x.id === 'e2e-cust-1'; })[0];
    return c ? { name: c.name, owner: c.owner, stage: c.stage } : null;
  })()`);
  check('★ B 的修改已同步到本机', !!after && after.name === '端到端客户甲（B 已改名）',
    JSON.stringify(after));
  check('B 修改的其他字段也同步过来（owner=李四）', !!after && after.owner === '李四', JSON.stringify(after));

  console.log('== 6. 另一台设备删除（墓碑）→ 本机确实删除，且护栏不误拦 ==');
  db.prepare(`UPDATE records SET deleted = 1, updated_at = ?, client_updated_at = ?, data_json = ?
    WHERE entity_type = 'customer' AND entity_id = 'e2e-cust-2'`).run(
    now + 9000, now + 9000, JSON.stringify({ id: 'e2e-cust-2' }));
  const abortedEvents = [];
  await js(`window.__aborted = []; window.api.onSyncAborted(function (p) { window.__aborted.push(p); }); true`);
  const beforeDel = await js('window.Store.get().customers.filter(function (c) { return !c.deleted; }).length');
  await js('window.API.syncNow()');
  await new Promise(function (r) { setTimeout(r, 300); });
  const afterDel = await js(`(function () {
    const alive = window.Store.get().customers.filter(function (c) { return !c.deleted; });
    return { n: alive.length, ids: alive.map(function (c) { return c.id; }),
      aborted: (window.__aborted || []).length };
  })()`);
  check('★ 被删除的客户从列表里消失（墓碑生效）',
    afterDel.ids.indexOf('e2e-cust-2') < 0, JSON.stringify(afterDel));
  check('其余客户还在（没被误删）', afterDel.ids.indexOf('e2e-cust-1') >= 0, JSON.stringify(afterDel));
  check('★ 正常删除没有被数据安全护栏误拦', afterDel.aborted === 0 && beforeDel === 2,
    'before=' + beforeDel + ' aborted=' + afterDel.aborted);

  console.log('== 7. 同步后的数据必须再次落盘（下次启动还在）==');
  await new Promise(function (r) { setTimeout(r, 900); });
  let onDisk2 = null;
  try { onDisk2 = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) {}
  const ids2 = ((onDisk2 && onDisk2.customers) || []).filter(function (c) { return !c.deleted; })
    .map(function (c) { return c.id; });
  check('★ 落盘数据与界面一致（同步结果持久化）',
    ids2.indexOf('e2e-cust-1') >= 0 && ids2.indexOf('e2e-cust-2') < 0, JSON.stringify(ids2));

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  // 注意：关闭的是 http server（createApp 返回的是 express app，没有 close）
  http.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('端到端同步验收异常:', e);
  app.exit(1);
});
