/*
 * field-coverage.test.js — 「顶层集合」字段覆盖一致性契约测试
 *
 * 为什么需要（真实事故）：
 *   渲染层 store 的 saveData payload 漏了 customers / followups，
 *   于是桌面端新增/修改客户只留在渲染层内存里 —— 既不落盘、也不参与同步推送。
 *   而一旦点「多端同步」，主进程会用它自己那份（不含客户的）数据合并后写盘并刷新界面，
 *   用户看到的就是「多端同步之后客户被清空」。
 *   同一个漏项还存在于「导入/恢复」路径，会静默丢掉全部客户数据。
 *
 * 这类 bug 的共同特征是：**新增一个集合时，某个环节忘了加**。
 * 所以这里把「必须保持一致的环节」逐个钉住，任何一处漏加都会立刻失败。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

// 必须全流程保持一致的「业务集合」（settings 结构不同，单独处理）
const COLLECTIONS = [
  'categories', 'events', 'todos',
  'accounts', 'transactions', 'bookkeepingCategories', 'budgets', 'memorials',
  'customers', 'followups',
];

// 取一段源码：从 startMarker 到之后第一次出现的 endMarker（不含）
function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, '定位不到片段起点：' + startMarker);
  const rest = src.slice(start + startMarker.length);
  const end = endMarker ? rest.indexOf(endMarker) : -1;
  return end >= 0 ? rest.slice(0, end) : rest.slice(0, 4000);
}

// 顶层函数体：从 `function name(` 到下一个顶层 `\nfunction `
function functionBody(src, name) {
  return sliceBetween(src, 'function ' + name + '(', '\nfunction ');
}

function missingFrom(body, pattern) {
  return COLLECTIONS.filter(function (k) {
    return body.indexOf(pattern.replace('{}', k)) < 0;
  });
}

test('★ main.js：defaultData / publicData 必须包含全部集合', function () {
  const main = read('main.js');

  const def = functionBody(main, 'defaultData');
  assert.deepStrictEqual(missingFrom(def, '{}:'), [],
    'defaultData() 缺少集合（内存里根本没有这些字段）：');

  const pub = functionBody(main, 'publicData');
  assert.deepStrictEqual(missingFrom(pub, '{}:'), [],
    'publicData() 缺少集合（渲染层会看不到这些数据）：');
});

test('★ main.js：applyImported（导入/恢复备份）必须覆盖全部集合', function () {
  const main = read('main.js');
  const body = functionBody(main, 'applyImported');
  const missing = missingFrom(body, 'data.{} =');
  assert.deepStrictEqual(missing, [],
    'applyImported() 缺少集合 —— 导入数据或恢复备份会**静默丢掉**这些数据：' + missing.join(', '));

  // 导入的数据还要被标记为「本地修改」，否则下次同步不会上传
  const pushable = ['categories', 'events', 'todos', 'customers', 'followups'];
  const markSlice = body.slice(body.indexOf('localModifiedAt'));
  const notMarked = pushable.filter(function (k) { return body.indexOf('data.' + k) < 0; });
  assert.deepStrictEqual(notMarked, [],
    '这些集合在导入后没有参与「标记为本地修改」，将永远同步不出去：' + notMarked.join(', '));
  assert.ok(markSlice.length > 0, 'applyImported 应把导入数据标记为本地修改');
});

test('★ main.js：data:save 处理器必须接收全部集合（渲染层写回主进程的入口）', function () {
  const main = read('main.js');
  const body = sliceBetween(main, "ipcMain.handle('data:save'", "ipcMain.handle('data:");
  const missing = missingFrom(body, 'payload.{}');
  assert.deepStrictEqual(missing, [],
    "data:save 处理器没有接收这些集合 —— 渲染层对它们的改动到不了主进程，\n" +
    '  也就不会落盘、不会被同步推送（这正是「同步后客户被清空」的根因）：' + missing.join(', '));
});

test('★ 同步链路：buildLocalChanges / applyRemoteChanges 覆盖全部可同步实体', function () {
  const main = read('main.js');
  const sync = require(path.join(ROOT, 'shared', 'sync.js'));

  const SYNCED = ['categories', 'events', 'todos', 'customers', 'followups'];

  const push = functionBody(main, 'buildLocalChanges');
  assert.deepStrictEqual(SYNCED.filter(function (k) { return push.indexOf('data.' + k) < 0; }), [],
    'buildLocalChanges 未推送这些集合（改了也同步不出去）：');

  const merge = functionBody(main, 'applyRemoteChanges');
  assert.deepStrictEqual(SYNCED.filter(function (k) { return merge.indexOf('data.' + k) < 0; }), [],
    'applyRemoteChanges 未把这些集合纳入合并：');

  // 合并后的回写：漏了会把它们从内存里抹掉
  assert.deepStrictEqual(
    SYNCED.filter(function (k) { return merge.indexOf('data.' + k + ' = sync.liveRecords') < 0; }), [],
    '同步合并后没有回写这些集合（会被清空）：');

  assert.ok(sync.ENTITY_TYPES.CUSTOMER && sync.ENTITY_TYPES.FOLLOWUP,
    'ENTITY_TYPES 必须包含 customer / followup');
});

test('★ 渲染层 store：state / get() / saveData 三处必须一致（本次事故点）', function () {
  const store = read('src/renderer/js/store.js');

  const stateBody = sliceBetween(store, 'const state = {', 'const listeners');
  assert.deepStrictEqual(missingFrom(stateBody, '{}:'), [],
    '渲染层 store 的 state 缺少集合：');

  const getBody = functionBody(store, 'get');
  assert.deepStrictEqual(missingFrom(getBody, '{}:'), [],
    '渲染层 store 的 get() 缺少集合（界面读不到）：');

  const saveBody = sliceBetween(store, 'window.API.saveData({', '}, 500)');
  assert.deepStrictEqual(missingFrom(saveBody, '{}:'), [],
    '★ 渲染层 store 的 saveData payload 缺少集合 —— 漏了会导致：\n' +
    '  这些数据的本地改动既不落盘也不参与同步，而一次同步就会用主进程那份旧数据\n' +
    '  覆盖界面，表现为「同步后数据被清空」。');
});

test('★ 行为验证：改一条客户后，saveData 的 payload 必须真的带上 customers', async function () {
  // 上面那条是静态检查；这条是**真的改一次数据、真的抓一次 payload**，
  // 防止「字段名写对了但值没传」这类静态检查看不出来的问题。
  const helpers = require('./ui.helpers.js');
  const { setupUi, flush, FIXED_NOW } = helpers;

  const h = await setupUi({ now: FIXED_NOW });
  h.api.__reset();
  try {
    const c = h.Store.addCustomer({ id: h.Utils.genId(), name: '甲方公司', contact: '张三', owner: '李四' });
    assert.ok(c && c.id, '应能新增客户');

    // store 是 500ms 防抖保存
    await new Promise(function (r) { setTimeout(r, 700); });
    await flush();

    const payload = h.api.__lastArgs('saveData')[0]; // __lastArgs 返回参数数组
    assert.ok(payload, '应触发了 saveData');
    assert.ok(Array.isArray(payload.customers), 'saveData 的 payload 必须带 customers 数组');
    assert.strictEqual(payload.customers.length, 1, '新增的客户必须在 payload 里');
    assert.strictEqual(payload.customers[0].name, '甲方公司');
    // 其它集合也要在（漏一个就是同一类 bug）
    COLLECTIONS.forEach(function (k) {
      assert.ok(Array.isArray(payload[k]), 'saveData payload 缺少数组字段：' + k);
    });
  } finally {
    h.close();
  }
});

test('契约：defaultData 里出现新的业务集合时，本测试的清单也要更新（防止测试失效）', function () {
  const main = read('main.js');
  const body = functionBody(main, 'defaultData');
  // 抽出顶层「name: [...]」形式的字段名
  const found = [];
  const re = /(?:^|\n)\s{4}([A-Za-z_$][\w$]*)\s*:\s*\[\]/g;
  let m;
  while ((m = re.exec(body)) !== null) found.push(m[1]);
  assert.ok(found.length >= 8, '应能从 defaultData 解析出集合字段（实际 ' + found.length + ' 个）');

  const uncovered = found.filter(function (k) { return COLLECTIONS.indexOf(k) < 0; });
  // statsHistory 刻意排除：它由主进程在统计时写入并自行落盘，
  // 渲染层只读（saveData 不带它是对的），不属于「渲染层要写回的业务集合」。
  const excluded = ['statsHistory'];
  const realUncovered = uncovered.filter(function (k) { return excluded.indexOf(k) < 0; });
  assert.deepStrictEqual(realUncovered, [],
    'defaultData 里出现了本测试未覆盖的新集合，请加入 COLLECTIONS 并确认各环节都处理了：' + realUncovered.join(', '));
});

test('★ 缺 id 的记录不能互相覆盖（否则同步合并时会「清空一批」）', function () {
  const sync = require(path.join(ROOT, 'shared', 'sync.js'));

  // 三条都没有 id 的客户记录
  const list = [
    { name: 'A', updatedAt: 1 },
    { name: 'B', updatedAt: 2 },
    { name: 'C', updatedAt: 3 },
  ];
  const map = sync.recordsToMap(list, sync.ENTITY_TYPES.CUSTOMER);
  const live = sync.liveRecords(map, sync.ENTITY_TYPES.CUSTOMER);
  assert.strictEqual(live.length, 3,
    '缺 id 的记录若共用同一个 key，会塌缩成 1 条 —— 这正是「一批数据被清空」的机制');
  assert.deepStrictEqual(live.map(function (r) { return r.name; }).sort(), ['A', 'B', 'C']);
});

test('★ 渲染层 store 会给缺 id 的记录补上 id（从源头杜绝塌缩）', async function () {
  const helpers = require('./ui.helpers.js');
  const { setupUi, FIXED_NOW } = helpers;
  const h = await setupUi({ now: FIXED_NOW });
  try {
    // 故意不传 id
    const c1 = h.Store.addCustomer({ name: '甲' });
    const c2 = h.Store.addCustomer({ name: '乙' });
    assert.ok(c1.id && c2.id, '应自动补上 id');
    assert.notStrictEqual(c1.id, c2.id, '两条记录的 id 必须不同');
    assert.strictEqual(h.Store.get().customers.length, 2);
  } finally {
    h.close();
  }
});
