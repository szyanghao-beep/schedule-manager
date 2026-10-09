/*
 * mobile.store.test.js — 手机端数据层与同步客户端的**行为**测试（Node 里真跑）
 *
 * 为什么要有这一层：手机端一直是本项目的验证盲区（没有安卓真机），
 * 之前只有「静态契约」测试（检查方法名/文件存在），查不出真正的逻辑问题。
 * 而手机端同样会丢数据：它自己维护一份 records Map + 待推送 journal，
 * 拉取合并用的也是 shared/sync.js —— 与桌面端是两条独立实现，必须各自验证。
 *
 * 做法：把 mobile/src/store.js 原样读进来，只把两行 import 换成注入的桩
 * （AsyncStorage / shared），再在 vm 里执行 —— 被测代码本身一字未改，
 * 因此测的是真实实现，而不是复刻一份。
 *
 * 覆盖的风险点（都是「会丢数据」的场景）：
 *   1. 拉取合并不能删掉本地独有记录（客户/日程/待办）
 *   2. LWW：远端更新胜出；本地更新的变更留在 journal 里等待重推
 *   3. 墓碑：删除能传播，且老副本不能复活
 *   4. 缺 id 的记录不能互相覆盖
 *   5. 持久化写的是**整份** records（不是白名单），否则一重启就少一类数据
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const shared = require(path.join(ROOT, 'shared', 'index.js'));

// 极简 AsyncStorage 桩（只用到 getItem/setItem）
function makeStorage() {
  const mem = new Map();
  return {
    mem: mem,
    async getItem(k) { return mem.has(k) ? mem.get(k) : null; },
    async setItem(k, v) { mem.set(k, v); },
    async removeItem(k) { mem.delete(k); },
  };
}

// 加载手机端 store：把 import/export 换成 CommonJS，注入桩，其余原样执行
function loadMobileStore(storage) {
  let src = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'store.js'), 'utf-8');
  src = src.replace(/^import AsyncStorage from '.*';$/m, 'const AsyncStorage = __AsyncStorage;');
  src = src.replace(/^import shared from '.*';$/m, 'const shared = __shared;');
  assert.ok(src.indexOf('__AsyncStorage') > 0, '未能替换 AsyncStorage 的 import（测试宿主需要更新）');
  assert.ok(src.indexOf('__shared') > 0, '未能替换 shared 的 import');
  src = src.replace(/^export default \{/m, 'module.exports = {');

  const sandbox = {
    __AsyncStorage: storage,
    __shared: shared,
    module: { exports: {} },
    exports: {},
    console: console,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Object: Object,
    Array: Array,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Map: Map,
    Set: Set,
    Promise: Promise,
    Error: Error,
    isNaN: isNaN,
    parseInt: parseInt,
    parseFloat: parseFloat,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(src, { filename: 'mobile/src/store.js' }).runInContext(ctx);
  return sandbox.module.exports;
}

async function freshStore(seed) {
  const storage = makeStorage();
  if (seed) storage.mem.set('schedule_mobile_state_v1', JSON.stringify(seed));
  const store = loadMobileStore(storage);
  await store.load();
  return { store: store, storage: storage };
}

const rec = function (id, type, extra) {
  return Object.assign({ id: id, entityType: type, updatedAt: 1000, deleted: false }, extra || {});
};

test('宿主可用：能加载手机端 store 并完成一次读写', async function () {
  const { store } = await freshStore();
  const c = store.createCustomer({ name: '手机端客户', company: '甲公司' });
  assert.ok(c && c.id, '创建客户应返回带 id 的记录');
  assert.strictEqual(store.getRecords('customer').length, 1);
});

test('★ 拉取合并不能删掉本地独有的客户（手机端也不能「清空客户」）', async function () {
  const { store } = await freshStore({
    records: [
      rec('cu1', 'customer', { name: '手机本地客户甲' }),
      rec('cu2', 'customer', { name: '手机本地客户乙' }),
      rec('e1', 'event', { title: '手机本地日程' }),
      rec('t1', 'todo', { title: '手机本地待办' }),
    ],
  });
  assert.strictEqual(store.getRecords('customer').length, 2);

  // 服务端只有一条别的客户（典型的「另一端刚配好同步」状态）
  store.applyPull([
    { entityType: 'customer', id: 'cu9', deleted: false, updatedAt: 5000, data: { id: 'cu9', name: '服务端客户' } },
  ], 5000);

  const names = store.getRecords('customer').filter(function (r) { return !r.deleted; })
    .map(function (r) { return r.name; });
  assert.strictEqual(names.length, 3, '拉取只应「合并」，绝不能清掉本地客户：' + JSON.stringify(names));
  assert.ok(names.indexOf('手机本地客户甲') >= 0 && names.indexOf('服务端客户') >= 0);
  assert.strictEqual(store.getRecords('event').length, 1, '日程也不能被拉取清掉');
  assert.strictEqual(store.getRecords('todo').length, 1, '待办也不能被拉取清掉');
});

test('★ LWW：远端更新的版本胜出，本地更新的变更留在 journal 等待重推', async function () {
  const { store } = await freshStore({
    records: [rec('cu1', 'customer', { name: '本地版本', updatedAt: 1000 })],
  });

  // 远端更新（updatedAt 更大）→ 采纳
  store.applyPull([
    { entityType: 'customer', id: 'cu1', deleted: false, updatedAt: 9000, data: { id: 'cu1', name: '远端版本' } },
  ], 9000);
  assert.strictEqual(store.getRecords('customer')[0].name, '远端版本', '更新的远端版本应当胜出');

  // 本地再改（updatedAt 更大）→ 应进入 journal，且不被远端旧版本覆盖
  store.updateCustomer('cu1', { name: '本地新版本' });
  const journal = store.getJournal();
  assert.ok(journal.length >= 1, '本地修改必须进入待推送队列');
  store.applyPull([
    { entityType: 'customer', id: 'cu1', deleted: false, updatedAt: 2000, data: { id: 'cu1', name: '远端很旧的版本' } },
  ], 9500);
  assert.strictEqual(store.getRecords('customer')[0].name, '本地新版本',
    '远端更旧的内容不能覆盖本地刚做的修改');
  assert.ok(store.getJournal().length >= 1,
    '★ 拉取不能清掉「还没推上去」的本地修改（清掉就永远同步不上去了）');
});

test('★ 推送期间新产生的本地修改不能被 pruneJournalAfterPush 误删', async function () {
  const { store } = await freshStore({
    records: [rec('cu1', 'customer', { name: '客户', updatedAt: 1000 })],
  });
  store.updateCustomer('cu1', { name: '第一笔修改' });
  const sent = store.getJournal();                 // 本次真正推上去的条目
  assert.ok(sent.length >= 1);

  // 推送在途时用户又改了一笔（新的 journal 条目，time 更大）
  store.updateCustomer('cu1', { name: '第二笔修改' });
  const afterEdit = store.getJournal();
  assert.ok(afterEdit.length >= 1, '第二笔修改应进入 journal');

  // 服务端返回的 serverTime 比第二笔的 updatedAt 还大（时钟偏差的最坏情况）
  store.pruneJournalAfterPush(Date.now() + 60000, sent);

  const left = store.getJournal();
  assert.strictEqual(left.length, 1, '只剩「没被推上去」的那一笔：' + JSON.stringify(left.map(function (c) { return c.id; })));
  assert.ok(shared.sync.recordTime(store.getRecords('customer')[0]) >= left[0].updatedAt,
    '记录时间不应被改写回服务器时间（否则这笔修改的 LWW 依据就丢了）');
  assert.strictEqual(store.getRecords('customer')[0].name, '第二笔修改');
});

test('★ 远端已有更新版本时，过时的 journal 条目可以丢掉（否则会反复重推旧编辑）', async function () {
  const { store } = await freshStore({
    records: [rec('cu1', 'customer', { name: '本地版本', updatedAt: 1000 })],
  });
  // 注意：store._update 会把 updatedAt 设为 Date.now()（不允许调用方指定），
  // 所以这里必须用真实时间轴来构造「远端更新」的场景
  store.updateCustomer('cu1', { name: '本地修改' });
  const localEditAt = shared.sync.recordTime(store.getRecords('customer')[0]);
  assert.ok(store.getJournal().length >= 1);

  // 另一台设备做了更新的修改（时间更大）→ 本地这笔已被取代
  const remoteAt = localEditAt + 60000;
  store.applyPull([
    { entityType: 'customer', id: 'cu1', deleted: false, updatedAt: remoteAt, data: { id: 'cu1', name: '别的设备的修改' } },
  ], remoteAt);
  assert.strictEqual(store.getJournal().length, 0, '已被远端取代的本地变更应当从 journal 移除');
  assert.strictEqual(store.getRecords('customer')[0].name, '别的设备的修改');
});

test('★ 墓碑：远端删除能传播；老副本不能复活已删除的记录', async function () {
  const { store } = await freshStore({
    records: [rec('cu1', 'customer', { name: '待删除客户', updatedAt: 1000 })],
  });

  // 远端墓碑（时间更新）→ 本地应删除
  store.applyPull([
    { entityType: 'customer', id: 'cu1', deleted: true, updatedAt: 9000, data: { id: 'cu1' } },
  ], 9000);
  assert.strictEqual(store.getRecords('customer').filter(function (r) { return !r.deleted; }).length, 0,
    '远端墓碑应当让本地记录消失');

  // 老副本再回来（时间更旧）→ 不能复活
  store.applyPull([
    { entityType: 'customer', id: 'cu1', deleted: false, updatedAt: 1500, data: { id: 'cu1', name: '老副本' } },
  ], 9500);
  assert.strictEqual(store.getRecords('customer').filter(function (r) { return !r.deleted; }).length, 0,
    '已删除的记录不能被更旧的副本复活');
});

test('★ 缺 id 的远端记录不能把一批数据压成一条', function () {
  const { sliceMap } = { sliceMap: null }; // 占位，保持用例结构清晰
  assert.strictEqual(sliceMap, null);
  const map = shared.sync.recordsToMap([{ name: 'A' }, { name: 'B' }], 'customer');
  assert.strictEqual(map.size, 2, '手机端用的也是 shared.sync.recordsToMap，缺 id 不能塌缩');
});

test('★ 持久化写的是整份 records（不是白名单）——否则重启就少一类数据', async function () {
  const { store, storage } = await freshStore({
    records: [
      rec('cu1', 'customer', { name: '客户' }),
      rec('e1', 'event', { title: '日程' }),
      rec('t1', 'todo', { title: '待办' }),
      rec('f1', 'followup', { customerId: 'cu1', content: '跟进' }),
    ],
  });
  store.createTodo({ title: '新待办' }); // 触发一次防抖持久化
  await new Promise(function (r) { setTimeout(r, 500); });

  const raw = storage.mem.get('schedule_mobile_state_v1');
  assert.ok(raw, '应当写入 AsyncStorage');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.records), '持久化里应有 records 数组');
  const types = parsed.records.map(function (r) { return r.entityType; });
  ['customer', 'event', 'todo', 'followup'].forEach(function (t) {
    assert.ok(types.indexOf(t) >= 0, '持久化丢了实体类型：' + t + '（实际 ' + JSON.stringify(types) + '）');
  });
  // 且必须能重新加载回来（往返一致）
  const reloaded = loadMobileStore(storage);
  await reloaded.load();
  assert.strictEqual(reloaded.getRecords('customer').length, 1, '重载后客户还在');
  assert.strictEqual(reloaded.getRecords('followup').length, 1, '重载后跟进记录还在');
});
