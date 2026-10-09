/*
 * data-safety.test.js — 「同一类数据丢失风险」的系统性审计
 *
 * 起因：客户被清空的根因是**保存 payload 漏字段**，但这类风险不止一处。凡是
 * 「某处维护着一份清单，别处忘了同步更新」的地方，都可能让数据消失。这里把
 * 所有已知通道逐个钉死，每一条都对应一个**真会丢数据**的场景：
 *
 *   1. 同步白名单：defaultData 里的集合，必须在同步白名单里，或者被**明确**列进
 *      「不同步」名单并说明理由 —— 绝不能出现「谁都没想过它」的集合
 *      （新加一个集合忘了进同步 = 多端各写各的，一同步就互相覆盖）。
 *   2. 老 data.json 迁移：旧文件缺字段（客户、跟进、记账……）时不能丢数据，
 *      也不能因为缺字段而报错回退成空数据。
 *   3. 跨版本混用：老版本客户端（记录没有 deleted/updatedAt）与新版本互相同步，
 *      两个方向都不能丢数据、不能让已删除的记录复活。
 *   4. LWW 与墓碑：同一条记录的编辑必须能双向传播；删除必须能传播；
 *      老副本不能复活已删除记录；**同步不能凭空删除本地独有的记录**。
 *   5. 白名单外的集合（记账/纪念日等）不参与同步，但也绝不能被同步逻辑清空。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sync = require(path.join(ROOT, 'shared', 'sync.js'));
const migrate = require(path.join(ROOT, 'shared', 'migrate.js'));

const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

// 顶层函数体：从 `function name(` 到下一个顶层 `\nfunction `
function functionBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '定位不到函数：' + name);
  const rest = src.slice(start + 1);
  const end = rest.indexOf('\nfunction ');
  return end >= 0 ? rest.slice(0, end) : rest;
}

// ---------------------------------------------------------------------------
// 0. 推送游标：不能用「推送完成时刻」当游标
// ---------------------------------------------------------------------------

test('★ 推送游标：syncPush 不得把 lastPushedAt 设成 Date.now()（会吞掉推送在途的修改）', function () {
  const main = read('main.js');
  const body = functionBody(main, 'syncPush');
  assert.ok(body.indexOf('syncState.lastPushedAt = Date.now()') < 0,
    'syncPush 里不能再用 Date.now() 推进推送游标：推送在途时用户又改的那一条会永远推不上去');
  assert.ok(body.indexOf('built.cursor') > 0,
    'syncPush 必须用 buildLocalChanges 返回的 cursor（本批最大 localModifiedAt）推进');

  // buildLocalChanges 必须真的把 cursor 算出来
  const build = functionBody(main, 'buildLocalChanges');
  assert.ok(build.indexOf('maxLocalModifiedAt') > 0,
    'buildLocalChanges 必须用 shared/sync.maxLocalModifiedAt 计算本批游标');
  assert.ok(build.indexOf('return { changes: changes, cursor: cursor }') > 0,
    'buildLocalChanges 必须同时返回 changes 与 cursor');
});

// ---------------------------------------------------------------------------
// 1. 同步白名单：每个集合都必须「有归属」
// ---------------------------------------------------------------------------

test('★ 同步白名单：defaultData 里每个集合要么参与同步，要么被明确排除并写明理由', function () {
  const main = read('main.js');
  const defStart = main.indexOf('function defaultData()');
  const defBody = main.slice(defStart, main.indexOf('\nfunction ', defStart));

  // 注意：defaultData 里 categories 是 `categories: categories,`（由常量映射生成），
  // 不是 `[]` 字面量，所以两种写法都要解析，否则会漏掉它
  const collections = [];
  const re = /(?:^|\n)\s{4}([A-Za-z_$][\w$]*)\s*:\s*(\[\][^\n]*|[a-z][\w$]*)\s*,/g;
  let m;
  while ((m = re.exec(defBody)) !== null) collections.push(m[1]);
  assert.ok(collections.length >= 8, '解析 defaultData 集合失败（' + collections.length + '）');

  // 同步白名单（main.js 的 SYNC_ENTITIES）
  const entStart = main.indexOf('const SYNC_ENTITIES');
  const entBody = main.slice(entStart, main.indexOf('];', entStart));
  const synced = [];
  const reEnt = /field:\s*'([A-Za-z_$][\w$]*)'/g;
  while ((m = reEnt.exec(entBody)) !== null) synced.push(m[1]);
  assert.ok(synced.indexOf('customers') >= 0 && synced.indexOf('followups') >= 0,
    '客户与跟进必须在同步白名单里（否则多端各写各的）');

  // 明确「不同步」的集合 + 理由（写成清单，新增集合必须显式做决定）
  const NOT_SYNCED = {
    statsHistory: '统计快照是由主进程按本机数据现算的派生数据，跨端合并没有意义',
    accounts: '记账相关整体暂不参与同步（2.3.0 起即为已知取舍，见 SYNC.md）',
    transactions: '同上',
    bookkeepingCategories: '同上',
    budgets: '同上',
    memorials: '纪念日暂不参与同步（已知取舍），但本地数据必须完好',
  };

  const unowned = collections.filter(function (k) {
    return synced.indexOf(k) < 0 && !Object.prototype.hasOwnProperty.call(NOT_SYNCED, k);
  });
  assert.deepStrictEqual(unowned, [],
    '这些集合既不在同步白名单、也没被明确排除：' + unowned.join(', ') +
    ' —— 新加集合时必须显式决定它同步还是不同步');

  // 反向：白名单里的字段必须是 defaultData 里真实存在的集合
  const ghost = synced.filter(function (k) { return collections.indexOf(k) < 0; });
  assert.deepStrictEqual(ghost, [], '同步白名单里出现了 defaultData 没有的集合：' + ghost.join(', '));
});

test('★ 白名单外的集合（记账/纪念日）不能被同步逻辑动到', function () {
  const local = {
    categories: [], events: [], todos: [], customers: [], followups: [],
    accounts: [{ id: 'a1', name: '银行卡' }],
    transactions: [{ id: 't1', amount: 100, date: 1 }],
    memorials: [{ id: 'm1', title: '纪念日' }],
  };
  // 远程凭空带来一批「墓碑」（最坏情况：服务端有脏数据、或另一个实现误删）
  const changes = [
    { entityType: 'account', id: 'a1', deleted: true, updatedAt: 9e12, data: { id: 'a1' } },
    { entityType: 'transaction', id: 't1', deleted: true, updatedAt: 9e12, data: { id: 't1' } },
    { entityType: 'memorial', id: 'm1', deleted: true, updatedAt: 9e12, data: { id: 'm1' } },
    { entityType: 'category', id: 'c1', deleted: true, updatedAt: 9e12, data: { id: 'c1' } },
    // setting 是「显式允许」的额外类型：它是对象不是数组集合，单独同步
    { entityType: 'setting', id: 'global', deleted: false, updatedAt: 9e12, data: { id: 'global', urgentThresholdHours: 6 } },
  ];
  const ENTITIES = [
    { field: 'categories', type: sync.ENTITY_TYPES.CATEGORY },
    { field: 'events', type: sync.ENTITY_TYPES.EVENT },
    { field: 'todos', type: sync.ENTITY_TYPES.TODO },
    { field: 'customers', type: sync.ENTITY_TYPES.CUSTOMER },
    { field: 'followups', type: sync.ENTITY_TYPES.FOLLOWUP },
  ];
  const r = sync.mergeWithGuardrail(local, ENTITIES, changes, {
    allowTypes: [sync.ENTITY_TYPES.SETTING],
  });

  // 白名单外的实体**必须被丢掉**：否则对端一次误删就能把本端不处理的集合带走
  assert.strictEqual(r.map.has('account:a1'), false, '记账账户不该进合并结果');
  assert.strictEqual(r.map.has('transaction:t1'), false, '流水不该进合并结果');
  assert.strictEqual(r.map.has('memorial:m1'), false, '纪念日不该进合并结果');
  assert.strictEqual(r.map.has('setting:global'), true, 'setting 是显式允许的类型，应当进合并结果');
  assert.strictEqual(r.ignoredChanges, 3, '被忽略的变更条数要如实上报（便于发现版本不匹配）');
  assert.deepStrictEqual(r.ignoredTypes.sort(), ['account', 'memorial', 'transaction']);

  // 被忽略的类型不能影响护栏判定
  assert.strictEqual(r.ok, true, '被忽略的类型不该被误判为「可疑减少」');
  assert.strictEqual(r.beforeByType.customer, 0);
  assert.strictEqual(r.afterByType.customer, 0);
});

// ---------------------------------------------------------------------------
// 2. 老 data.json 迁移：缺字段不能丢数据、不能报错
// ---------------------------------------------------------------------------

test('★ 迁移：老版本 data.json（没有 customers/followups）不能丢已有数据', function () {
  // 典型的 v2.1/v2.2 文件：只有日程/待办/分类/settings
  const old = {
    version: 1,
    categories: [{ id: 'c1', name: '工作' }],
    events: [{ id: 'e1', title: '会议', startTime: 1, endTime: 2 }],
    todos: [{ id: 't1', title: '待办' }],
    settings: { theme: 'dark' },
  };
  migrate.migrateData(old);
  // 迁移只加字段、不重建对象（重建白名单是曾经的丢数据套路）
  assert.strictEqual(old.events.length, 1, '老数据必须原样保留');
  assert.strictEqual(old.todos.length, 1);
  assert.strictEqual(old.categories.length, 1);
  assert.strictEqual(old.settings.theme, 'dark', '老设置不能被默认值覆盖');
  assert.ok(old.version >= 1);
});

test('★ 迁移：不认识的字段必须原样保留（不能被白名单式重建丢掉）', function () {
  const weird = {
    events: [], todos: [],
    customers: [{ id: 'cu1', name: '客户甲' }],
    futureFeatureData: [{ id: 'x1', note: '未来版本才认识的集合' }],
    someFlag: true,
  };
  migrate.migrateData(weird);
  assert.strictEqual(weird.customers.length, 1, '客户数据必须保留');
  assert.strictEqual((weird.futureFeatureData || []).length, 1,
    '不认识的集合也必须保留（迁移只允许加字段，不允许删字段）');
  assert.strictEqual(weird.someFlag, true);
});

test('★ 主进程 loadData 的兜底：文件损坏时才回退默认值，正常老文件必须留住数据', function () {
  const main = read('main.js');
  const body = main.slice(main.indexOf('function loadData()'), main.indexOf('\nfunction ', main.indexOf('function loadData()')));
  // 回退到 defaultData() 只允许出现在 catch 分支里（文件读取/解析失败）
  const catchIdx = body.indexOf('catch (e)');
  const fallbackIdx = body.indexOf('data = defaultData()');
  assert.ok(fallbackIdx > catchIdx, 'loadData 只有在解析失败时才能回退默认值，否则会静默清空用户数据');
  assert.ok(body.indexOf('Object.assign(defaultData(), parsed)') > 0,
    'loadData 必须用「默认值 + 文件内容」合并，而不是白名单重建');
});

// ---------------------------------------------------------------------------
// 3. 跨版本混用：老客户端 ↔ 新客户端
// ---------------------------------------------------------------------------

const ENTITIES = [
  { field: 'categories', type: sync.ENTITY_TYPES.CATEGORY },
  { field: 'events', type: sync.ENTITY_TYPES.EVENT },
  { field: 'todos', type: sync.ENTITY_TYPES.TODO },
  { field: 'customers', type: sync.ENTITY_TYPES.CUSTOMER },
  { field: 'followups', type: sync.ENTITY_TYPES.FOLLOWUP },
];

test('★ 跨版本：老客户端推来的记录（无 deleted / 无 updatedAt）不能删掉新端的记录', function () {
  // 新端本地：两条客户（带有 updatedAt）
  const local = {
    customers: [
      { id: 'cu1', name: '客户甲', updatedAt: 1000 },
      { id: 'cu2', name: '客户乙', updatedAt: 1000 },
    ],
  };
  // 老客户端（v2.2 协议）推来的 change：没有 deleted 字段，updatedAt 也没有
  const oldClientChanges = [
    { entityType: 'customer', id: 'cu1', data: { id: 'cu1', name: '客户甲（老端旧名字）' } },
  ];
  const r = sync.mergeWithGuardrail(local, ENTITIES, oldClientChanges);
  assert.strictEqual(r.ok, true);
  const live = sync.liveRecords(r.map, 'customer');
  assert.strictEqual(live.length, 2, '老端推一条不能导致新端记录减少');
  const cu1 = live.filter(function (c) { return c.id === 'cu1'; })[0];
  assert.strictEqual(cu1.name, '客户甲', '老端没有编辑时间（updatedAt=0）→ 不该覆盖更新的本地内容');
});

test('★ 跨版本：老客户端把已删除的记录再推上来，也不能让墓碑复活', function () {
  const local = { customers: [{ id: 'cu1', name: '客户甲', updatedAt: 5000, deleted: true }] };
  const oldClientChanges = [
    { entityType: 'customer', id: 'cu1', data: { id: 'cu1', name: '客户甲' }, updatedAt: 5000 },
  ];
  const r = sync.mergeWithGuardrail(local, ENTITIES, oldClientChanges);
  const live = sync.liveRecords(r.map, 'customer');
  assert.strictEqual(live.length, 0, '时间相同 + 本地是墓碑 → 墓碑优先，不能复活');
});

test('★ 跨版本：新端删除的墓碑能盖过老端更早的副本，老端不会「复活」数据', function () {
  const local = { customers: [{ id: 'cu1', name: '客户甲', updatedAt: 100 }] };
  const tombstone = [{ entityType: 'customer', id: 'cu1', deleted: true, updatedAt: 900, data: { id: 'cu1' } }];
  const r = sync.mergeWithGuardrail(local, ENTITIES, tombstone);
  assert.strictEqual(r.ok, true, '正常删除（有墓碑）不算可疑减少');
  assert.strictEqual(sync.liveRecords(r.map, 'customer').length, 0);
});

// ---------------------------------------------------------------------------
// 4. LWW / 墓碑：双向传播、不凭空删除
// ---------------------------------------------------------------------------

test('★ 同步不能删除本地独有的记录（服务端没有 ≠ 应当删除）', function () {
  const local = {
    categories: [{ id: 'cat1', name: '本地分类', updatedAt: 10 }],
    events: [{ id: 'e1', title: '本地独有', updatedAt: 10 }],
    todos: [{ id: 't1', title: '本地独有待办', updatedAt: 10 }],
    customers: [{ id: 'cu1', name: '本地独有客户', updatedAt: 10 }],
    followups: [{ id: 'f1', customerId: 'cu1', content: '跟进', updatedAt: 10 }],
  };
  // 远程什么都没给（服务端为空）—— 这是「首次配置同步」的正常状态
  const r = sync.mergeWithGuardrail(local, ENTITIES, []);
  assert.strictEqual(r.ok, true);
  ENTITIES.forEach(function (e) {
    assert.strictEqual(sync.liveRecords(r.map, e.type).length, 1,
      e.field + ' 本地独有的记录必须保留（服务端为空不代表删除）');
  });
});

test('★ 多实体混合的一批变更：各类型的数量都不能无故减少', function () {
  const local = {
    events: [{ id: 'e1', title: 'A', updatedAt: 1 }, { id: 'e2', title: 'B', updatedAt: 1 }],
    todos: [{ id: 't1', title: 'T', updatedAt: 1 }],
    customers: [{ id: 'cu1', name: 'C', updatedAt: 1 }, { id: 'cu2', name: 'D', updatedAt: 1 }],
    followups: [{ id: 'f1', content: 'F', updatedAt: 1 }],
  };
  const changes = [
    { entityType: 'event', id: 'e3', deleted: false, updatedAt: 50, data: { id: 'e3', title: '远程新增' } },
    { entityType: 'todo', id: 't1', deleted: true, updatedAt: 60, data: { id: 't1' } },
    { entityType: 'customer', id: 'cu1', deleted: false, updatedAt: 70, data: { id: 'cu1', name: 'C2' } },
    { entityType: 'customer', id: 'cu2', deleted: true, updatedAt: 80, data: { id: 'cu2' } },
    { entityType: 'followup', id: 'f2', deleted: false, updatedAt: 90, data: { id: 'f2', content: 'F2' } },
  ];
  const r = sync.mergeWithGuardrail(local, ENTITIES, changes);
  assert.strictEqual(r.ok, true, '有对应墓碑的正常减少不该被拦');
  assert.strictEqual(sync.liveRecords(r.map, 'event').length, 3);
  assert.strictEqual(sync.liveRecords(r.map, 'todo').length, 0);
  assert.strictEqual(sync.liveRecords(r.map, 'customer').length, 1);
  assert.strictEqual(sync.liveRecords(r.map, 'followup').length, 2);
});
