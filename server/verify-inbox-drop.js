/*
 * verify-inbox-drop.js — 局域网收集直传端点集成测试
 * 覆盖：配对码校验、非法请求、去重幂等、条目并入收件箱语义（deadline=null）。
 */
'use strict';

const { createApp } = require('./src/app.js');
const { derivePairingCode } = require('./src/inboxDrop.js');
const inboxUtil = require('../shared/inbox.js');

// 内存 db 占位（本端点不写服务器库，只需要一个符合签名的 db 对象）
const fakeDb = {
  prepare: function () { return { get: function () { return undefined; }, all: function () { return []; }, run: function () { return {}; } }; },
  exec: function () {},
};

async function main() {
  const secret = 'test-secret-abc';
  const pairingCode = derivePairingCode(secret);
  let todos = []; // 模拟桌面端主进程的收件箱（与 main.js handleInboxDrop 使用同一份合并逻辑）
  let crash = false;

  const app = createApp(fakeDb, secret, {
    pairingCode: pairingCode,
    onInboxDrop: function (items) {
      if (crash) throw new Error('模拟处理异常');
      const res = inboxUtil.mergeInboxItems(todos, items, Date.now());
      todos = res.todos;
      return { accepted: res.accepted, duplicated: res.duplicated, total: todos.length };
    },
  });

  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;

  let pass = 0, fail = 0;
  const check = (n, c) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n); } };
  const post = (body, headers) => fetch(base + '/api/inbox-drop', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });

  console.log('== 配对码派生 ==');
  check('派生 6 位数字码', /^\d{6}$/.test(pairingCode));
  check('同一密钥派生稳定', derivePairingCode(secret) === pairingCode);
  check('不同密钥派生不同码', derivePairingCode('other') !== pairingCode);

  console.log('== 校验与边界 ==');
  const noCode = await post({ items: [{ id: 'a', title: 'x' }] });
  check('缺配对码 -> 401', noCode.status === 401);
  const badCode = await post({ items: [{ id: 'a', title: 'x' }] }, { 'X-Pairing-Code': '000000' });
  check('错配对码 -> 401', badCode.status === 401);
  const notArray = await post({ items: 'oops' }, { 'X-Pairing-Code': pairingCode });
  check('items 非数组 -> 400', notArray.status === 400);
  const tooMany = await post({ items: new Array(501).fill({ id: 'x', title: 'y' }) }, { 'X-Pairing-Code': pairingCode });
  check('超过 500 条 -> 413', tooMany.status === 413);

  console.log('== 正常投递与幂等 ==');
  const r1 = await (await post({ items: [
    { id: 'm1', title: '给张总回电话', createdAt: 1000 },
    { id: 'm2', title: '想想新方案' },
  ] }, { 'X-Pairing-Code': pairingCode })).json();
  check('首次投递 accepted=2', r1.ok === true && r1.accepted === 2);
  check('条目进入收件箱', todos.length === 2);

  const r2 = await (await post({ items: [
    { id: 'm1', title: '给张总回电话' },
    { id: 'm3', title: '第三条' },
  ] }, { 'X-Pairing-Code': pairingCode })).json();
  check('重复投递幂等：accepted=1 duplicated=1', r2.accepted === 1 && r2.duplicated === 1);
  check('总数正确（3 条，无重复）', todos.length === 3);
  check('收件箱语义：全部 deadline 为 null（未整理）', todos.every(function (t) { return t.deadline === null; }));

  const r3 = await (await post({ items: [{ id: '', title: '' }, null] }, { 'X-Pairing-Code': pairingCode })).json();
  check('非法条目被忽略（accepted=0）', r3.accepted === 0);

  console.log('== 异常处理 ==');
  crash = true;
  const rErr = await post({ items: [{ id: 'z', title: '触发异常' }] }, { 'X-Pairing-Code': pairingCode });
  check('回调抛异常 -> 500（服务不崩）', rErr.status === 500);
  crash = false;
  const rAfter = await (await post({ items: [{ id: 'z2', title: '恢复后正常' }] }, { 'X-Pairing-Code': pairingCode })).json();
  check('异常后服务仍可用', rAfter.ok === true && rAfter.accepted === 1);

  console.log('== 未启用场景 ==');
  const appOff = createApp(fakeDb, secret, {});
  const serverOff = appOff.listen(0);
  const offRes = await fetch('http://127.0.0.1:' + serverOff.address().port + '/api/inbox-drop', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [] }),
  });
  check('未配置回调 -> 503', offRes.status === 503);
  await new Promise(function (r) { serverOff.close(r); });

  await new Promise(function (r) { server.close(r); });
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch(function (e) { console.error(e); process.exit(1); });
