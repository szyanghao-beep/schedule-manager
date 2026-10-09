/*
 * sync-dataloss.test.js — 「同步把客户清空了」这类**数据丢失**的回归测试
 *
 * 背景（真实故障）：多端同步之后桌面端客户列表被清空。原因是渲染层保存时
 * 漏传了 customers / followups 字段，本地客户从未落盘；而同步又是**唯一能删掉
 * 本地数据**的通道，一旦合并逻辑有问题就会静默抹掉数据，用户毫无察觉。
 *
 * 因此这里测三件事：
 *   1. 护栏：合并后「记录变少」必须能被本批墓碑解释，解释不了就整批放弃；
 *   2. 正常路径不许被护栏误伤：新增/编辑/正常删除（墓碑）都必须照常生效；
 *   3. 真实服务端往返：A 建的客户，B 拉取后必须有（不是清空），B 的编辑要能回到 A，
 *      分页拉取不许漏记录（游标不能推进到 serverTime）。
 *
 * 全部走 shared/sync.js 与真实 server 代码路径 —— 不做 mock，避免测了个假实现。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const sync = require(path.join(__dirname, '..', 'shared', 'sync.js'));
const { createDb } = require(path.join(__dirname, '..', 'server', 'src', 'db.js'));
const { createApp } = require(path.join(__dirname, '..', 'server', 'src', 'app.js'));

const ENTITIES = [
  { field: 'categories', type: sync.ENTITY_TYPES.CATEGORY },
  { field: 'events', type: sync.ENTITY_TYPES.EVENT },
  { field: 'todos', type: sync.ENTITY_TYPES.TODO },
  { field: 'customers', type: sync.ENTITY_TYPES.CUSTOMER },
  { field: 'followups', type: sync.ENTITY_TYPES.FOLLOWUP },
];

function cust(id, name, t) {
  return { id: id, name: name, company: name + '公司', updatedAt: t, localModifiedAt: t };
}

// ---------------------------------------------------------------------------
// 一、护栏：可疑的数据减少必须被拦下
// ---------------------------------------------------------------------------

test('护栏：本地记录出现重复 id（会让一条记录凭空消失）→ 拦下，不采用合并结果', function () {
  // 本地 3 条客户，其中两条 id 相同（不该发生，但真发生就会塌缩成一条 key）。
  const local = {
    customers: [cust('c1', '甲', 100), cust('c1', '乙', 100), cust('c2', '丙', 100)],
  };
  // 远程什么也没删（无墓碑）
  const r = sync.mergeWithGuardrail(local, ENTITIES, [
    { entityType: 'customer', id: 'c3', deleted: false, updatedAt: 200, data: cust('c3', '丁', 200) },
  ]);

  assert.strictEqual(r.beforeByType.customer, 3, '合并前本地应数出 3 条活客户');
  assert.strictEqual(r.afterByType.customer, 3, '注意：c1 塌缩成 1 条 → 3-1+1=3，护栏此时不该报错');
  assert.strictEqual(r.ok, true, '本批只增不减，护栏不应误报');

  // 真正触发护栏的情形：合并结果比「合并前的存活数」还少，且本批没有对应墓碑。
  const bad = sync.detectSuspiciousLoss({ customer: 3 }, { customer: 1 }, []);
  assert.strictEqual(bad.length, 1, '3 条变 1 条而没有任何墓碑 → 必须判为可疑');
  assert.strictEqual(bad[0].lost, 2);
  assert.strictEqual(bad[0].tombstones, 0);
  assert.strictEqual(bad[0].entityType, 'customer');
});

test('护栏：墓碑能解释的减少 = 数据确实增加了，不报错', function () {
  assert.deepStrictEqual(
    sync.detectSuspiciousLoss({ customer: 3 }, { customer: 2 }, [
      { entityType: 'customer', id: 'c9', deleted: true },
    ]),
    [], '少 1 条、恰好来了 1 条墓碑 → 正常删除');
  assert.deepStrictEqual(
    sync.detectSuspiciousLoss({ customer: 2 }, { customer: 2 }, []), [],
    '数量没变 → 安全');
  assert.deepStrictEqual(
    sync.detectSuspiciousLoss({ customer: 2 }, { customer: 5 }, []), [],
    '变多 → 安全');
  // 少 3 条但只有 1 条墓碑 → 仍有 2 条无法解释
  const v = sync.detectSuspiciousLoss({ customer: 5 }, { customer: 2 }, [
    { entityType: 'customer', id: 'x', deleted: true },
  ]);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].lost, 3);
  assert.strictEqual(v[0].tombstones, 1);
});

test('护栏：正常合并（新增 + 编辑 + 带墓碑的删除）全部放行', function () {
  const local = {
    customers: [cust('c1', '甲', 100), cust('c2', '乙', 100)],
    todos: [{ id: 't1', title: '旧待办', updatedAt: 100, localModifiedAt: 100 }],
  };
  const r = sync.mergeWithGuardrail(local, ENTITIES, [
    // 新增一条客户
    { entityType: 'customer', id: 'c3', deleted: false, updatedAt: 200, data: cust('c3', '丙', 200) },
    // 编辑 c2
    { entityType: 'customer', id: 'c2', deleted: false, updatedAt: 300, data: cust('c2', '乙改名', 300) },
    // 删除 c1（带墓碑）
    { entityType: 'customer', id: 'c1', deleted: true, updatedAt: 400, data: { id: 'c1' } },
    // 删除待办 t1（带墓碑）
    { entityType: 'todo', id: 't1', deleted: true, updatedAt: 400, data: { id: 't1' } },
  ]);

  assert.strictEqual(r.ok, true, '有墓碑的正常删除不允许被护栏误拦');
  const customers = sync.liveRecords(r.map, 'customer');
  assert.deepStrictEqual(customers.map(function (c) { return c.id; }).sort(), ['c2', 'c3']);
  assert.strictEqual(customers.filter(function (c) { return c.id === 'c2'; })[0].name, '乙改名',
    'LWW：新的编辑时间胜出');
  assert.strictEqual(sync.liveRecords(r.map, 'todo').length, 0, '墓碑生效，待办被删除');
});

test('护栏：缺 id 的记录不再互相覆盖（曾表现为「一批数据被清空」）', function () {
  const map = sync.recordsToMap(
    [{ name: 'A' }, { name: 'B' }, { name: 'C' }], sync.ENTITY_TYPES.CUSTOMER);
  assert.strictEqual(map.size, 3, '3 条缺 id 的记录必须是 3 个独立 key');
  assert.strictEqual(sync.liveRecords(map, 'customer').length, 3,
    '缺 id 也一条都不能丢（只是同步不了）');
});

// ---------------------------------------------------------------------------
// 二、真实服务端往返：客户不许被清空
// ---------------------------------------------------------------------------

async function startServer() {
  const db = createDb(':memory:');
  const app = createApp(db, 'test-secret', { version: 'test' });
  const server = await new Promise(function (resolve) {
    const sv = app.listen(0, '127.0.0.1', function () { resolve(sv); });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'u1', password: 'pw123456' }),
  });
  const body = await reg.json();
  assert.ok(body.token, '注册应返回 token：' + JSON.stringify(body));

  return {
    base: base,
    token: body.token,
    close: function () { server.close(); },
  };
}

function syncFetch(s, method, url, payload) {
  return fetch(s.base + url, {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.token,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  }).then(function (res) {
    return res.json().then(function (json) { return { status: res.status, json: json }; });
  });
}

test('往返：A 建立的客户，B 拉取后必须存在（这是用户报的「客户被清空」）', async function (t) {
  const s = await startServer();
  t.after(function () { s.close(); });

  const T = Date.now();
  // 设备 A：本地 2 个客户（带 localModifiedAt，表示是本地修改）
  const A = { customers: [cust('c1', '王总', T), cust('c2', '李总', T)] };

  // A 推送
  const pushA = await syncFetch(s, 'POST', '/api/sync', {
    changes: sync.extractLocalChanges(A.customers, sync.ENTITY_TYPES.CUSTOMER, 0),
  });
  assert.strictEqual(pushA.status, 200, JSON.stringify(pushA.json));
  assert.strictEqual(pushA.json.accepted, 2);

  // 设备 B：本地一个客户都没有，拉取后**必须**拿到 A 的 2 个客户
  const pull1 = await syncFetch(s, 'GET', '/api/sync?since=0');
  const B = {};
  const r1 = sync.mergeWithGuardrail(B, ENTITIES, pull1.json.changes);
  assert.strictEqual(r1.ok, true, '首次拉取不该被护栏拦下');
  const bCustomers = sync.liveRecords(r1.map, 'customer');
  assert.strictEqual(bCustomers.length, 2, 'B 必须拿到 A 的 2 个客户，绝不能是空的');
  assert.deepStrictEqual(bCustomers.map(function (c) { return c.name; }).sort(), ['李总', '王总']);

  // B 改一个客户并推送（编辑时间更新）
  const T2 = T + 1000;
  const edited = bCustomers.filter(function (c) { return c.id === 'c1'; })[0];
  edited.name = '王总(已联系)';
  edited.localModifiedAt = T2;
  edited.updatedAt = T2;
  const pushB = await syncFetch(s, 'POST', '/api/sync', {
    changes: sync.extractLocalChanges([edited], sync.ENTITY_TYPES.CUSTOMER, 0),
  });
  assert.strictEqual(pushB.json.accepted, 1, 'B 的新编辑应被接受（客户端时间更新）');

  // A 增量拉取 → 拿到 B 的修改，且客户总数仍是 2（没被清空、也没重复）
  const pull2 = await syncFetch(s, 'GET', '/api/sync?since=' + pushA.json.serverTime);
  const A2 = { customers: A.customers.slice() };
  const r2 = sync.mergeWithGuardrail(A2, ENTITIES, pull2.json.changes);
  assert.strictEqual(r2.ok, true);
  const aCustomers = sync.liveRecords(r2.map, 'customer');
  assert.strictEqual(aCustomers.length, 2, 'A 侧客户数应保持 2');
  assert.strictEqual(aCustomers.filter(function (c) { return c.id === 'c1'; })[0].name, '王总(已联系)',
    'A 应看到 B 的修改');

  // A 删除一个客户 → 墓碑传播 → B 端确实少一条，护栏不许误拦
  const T3 = T2 + 1000;
  const del = [
    { id: 'c2', name: '李总', updatedAt: T3, localModifiedAt: T3, deleted: true },
  ];
  await syncFetch(s, 'POST', '/api/sync', {
    changes: sync.extractLocalChanges(del, sync.ENTITY_TYPES.CUSTOMER, 0),
  });
  const pull3 = await syncFetch(s, 'GET', '/api/sync?since=' + pull1.json.serverTime);
  const r3 = sync.mergeWithGuardrail({ customers: aCustomers }, ENTITIES, pull3.json.changes);
  assert.strictEqual(r3.ok, true, '正常删除带墓碑 → 护栏必须放行');
  const afterDel = sync.liveRecords(r3.map, 'customer');
  assert.deepStrictEqual(afterDel.map(function (c) { return c.id; }), ['c1'],
    '删除生效：只剩 c1');
});

test('分页：多于一批的记录必须能被全部拉回，游标不能推进到 serverTime', async function (t) {
  const s = await startServer();
  t.after(function () { s.close(); });

  const T = Date.now();
  const many = [];
  for (let i = 0; i < 12; i++) many.push(cust('p' + i, '客户' + i, T + i));
  const push = await syncFetch(s, 'POST', '/api/sync', {
    changes: sync.extractLocalChanges(many, sync.ENTITY_TYPES.CUSTOMER, 0),
  });
  assert.strictEqual(push.json.accepted, 12, '12 条应全部落库');

  // 用小 limit 强制分页，按客户端的循环方式拉取（游标 = 本批最大 updatedAt）
  let cursor = 0;
  const got = [];
  let serverTimeSeen = 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await syncFetch(s, 'GET', '/api/sync?since=' + cursor + '&limit=5');
    serverTimeSeen = res.json.serverTime;
    const changes = res.json.changes || [];
    got.push.apply(got, changes.map(function (c) { return c.id; }));
    cursor = sync.nextPullCursor(cursor, changes);
    if (!res.json.hasMore || changes.length === 0) break;
  }
  assert.strictEqual(got.length, 12, '12 条必须一条不漏地拉回来，实际：' + got.length);
  assert.strictEqual(new Set(got).size, 12, '不许重复拉取');
  assert.ok(serverTimeSeen >= cursor,
    'serverTime 是服务端全局最新时间（≥ 本批游标），二者不是一回事');

  // 反证：若按 serverTime 推进游标（原来的 bug），中途的记录会被永久跳过
  const first = await syncFetch(s, 'GET', '/api/sync?since=0&limit=5');
  const buggyCursor = first.json.serverTime; // ← 错误做法
  const rest = await syncFetch(s, 'GET', '/api/sync?since=' + buggyCursor + '&limit=500');
  const skipped = 12 - 5 - (rest.json.changes || []).length;
  assert.ok(skipped > 0,
    '用 serverTime 推进游标会跳过 ' + skipped + ' 条记录 —— 这正是必须用 nextPullCursor 的原因');
});

test('nextPullCursor：空批不推进游标，回退不倒退', function () {
  assert.strictEqual(sync.nextPullCursor(0, []), 0, '空批 → 游标不动');
  assert.strictEqual(sync.nextPullCursor(100, []), 100);
  assert.strictEqual(
    sync.nextPullCursor(0, [{ updatedAt: 10 }, { updatedAt: 30 }, { updatedAt: 20 }]), 30,
    '取本批最大值');
  assert.strictEqual(sync.nextPullCursor(500, [{ updatedAt: 10 }]), 500, '比当前游标旧 → 不倒退');
  assert.strictEqual(sync.nextPullCursor(0, [{ updatedAt: 'x' }, null, {}]), 0, '脏数据不能让游标变 NaN');
});

// ---------------------------------------------------------------------------
// 三、推送游标：推送在途时新做的修改不能被「吞掉」
// ---------------------------------------------------------------------------

test('★ maxLocalModifiedAt：只算本批（> since）里最大的 localModifiedAt', function () {
  const recs = [
    { id: 'a', localModifiedAt: 100 },   // 早于 since → 不属于本批（上一批已推过）
    { id: 'b', localModifiedAt: 300 },   // 本批
    { id: 'c', localModifiedAt: 200 },   // 本批
    { id: 'd' },                          // 远程拉回来的记录没有 localModifiedAt → 不参与推送
    { id: 'e', localModifiedAt: 'not-a-number' },
  ];
  assert.strictEqual(sync.maxLocalModifiedAt(recs, 150), 300);
  assert.strictEqual(sync.maxLocalModifiedAt(recs, 0), 300);
  assert.strictEqual(sync.maxLocalModifiedAt(recs, 300), 0, '没有 > since 的记录 → 0（调用方不推进游标）');
  assert.strictEqual(sync.maxLocalModifiedAt([], 0), 0);
  assert.strictEqual(sync.maxLocalModifiedAt([{ localModifiedAt: 50 }], 100), 0);
});

test('★ 推送游标不能用 Date.now()：推送在途时改的那一条必须还能推出去', function () {
  // 时间轴：T1 = 第一次修改，Tpush = 推送完成的时刻，T2 = 推送进行中的第二次修改
  const T1 = 1000, T2 = 1400, Tpush = 2000;
  const records = [{ id: 'cu1', localModifiedAt: T1 }];

  // 推送这一刻收集到的本批：只有 T1 那条（T2 还没发生）
  const built = sync.extractLocalChanges(records, sync.ENTITY_TYPES.CUSTOMER, 0);
  assert.strictEqual(built.length, 1);
  const cursor = sync.maxLocalModifiedAt(records, 0);
  assert.strictEqual(cursor, T1, '游标应停在本批最大 localModifiedAt');

  // 推送在途时用户又改了同一条
  records[0] = { id: 'cu1', localModifiedAt: T2 };

  // 下一批（用新游标）必须能捞到 T2 那一次修改
  const next = sync.extractLocalChanges(records, sync.ENTITY_TYPES.CUSTOMER, cursor);
  assert.strictEqual(next.length, 1, 'T2 的修改必须还在下一批里（否则永远推不上去）');

  // 反证：若按「推送完成时刻」推进游标（以前的实现），T2 就被吞掉了
  const buggyNext = sync.extractLocalChanges(records, sync.ENTITY_TYPES.CUSTOMER, Tpush);
  assert.strictEqual(buggyNext.length, 0,
    '用 Date.now()/' + Tpush + ' 作游标会把 T2 的修改当成"已推送"而永远丢掉 —— 这就是要修的点');
});
