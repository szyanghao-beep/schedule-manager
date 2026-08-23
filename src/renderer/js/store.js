/*
 * store.js — 渲染进程内存数据仓库：状态 + 变更订阅 + 防抖持久化。
 * 所有业务数据变更统一走这里的 CRUD 方法，保证「变更 -> 通知订阅者 -> 防抖保存」链路一致。
 *
 * 同步化改造（v1.2.2）：
 *   - 每条记录带 updatedAt / deleted（软删除墓碑），删除不再物理移除，保证多端同步不丢删除信息。
 *   - get() 返回「存活视图」（过滤 deleted），渲染层行为不变；
 *   - getRaw() 返回完整数据（含墓碑），供同步客户端使用。
 */
window.Store = (function () {
  'use strict';

  const state = {
    categories: [],
    events: [],
    todos: [],
    settings: { defaultRemindBefore: 15, urgentThresholdHours: 24, theme: 'system' },
    accounts: [],
    transactions: [],
    bookkeepingCategories: [],
    budgets: [],
    memorials: [],
  };

  const listeners = [];
  let saveTimer = null;

  function alive(list) {
    return list.filter(function (x) { return !x.deleted; });
  }

  // 存活视图（渲染层使用）
  function get() {
    return {
      categories: alive(state.categories),
      events: alive(state.events),
      todos: alive(state.todos),
      settings: state.settings,
      accounts: alive(state.accounts),
      transactions: alive(state.transactions),
      bookkeepingCategories: alive(state.bookkeepingCategories),
      budgets: alive(state.budgets),
      memorials: alive(state.memorials),
    };
  }

  // 完整数据（含软删除墓碑，供同步使用）
  function getRaw() { return state; }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      window.API.saveData({
        categories: state.categories,
        events: state.events,
        todos: state.todos,
        settings: state.settings,
        accounts: state.accounts,
        transactions: state.transactions,
        bookkeepingCategories: state.bookkeepingCategories,
        budgets: state.budgets,
        memorials: state.memorials,
      });
    }, 500);
  }

  // 提交：通知订阅者并防抖持久化
  function commit() { emit(); scheduleSave(); }

  function set(partial) {
    if (partial && partial.settings && typeof partial.settings === 'object') {
      // settings 深合并：防止只传部分字段时整体覆盖丢配置
      partial = Object.assign({}, partial, { settings: Object.assign({}, state.settings, partial.settings) });
    }
    Object.assign(state, partial);
    commit();
  }

  function touch(rec) {
    const now = Date.now();
    // updatedAt 取「当前时间」与「记录已有时间 + 1」的较大者，保证同一条记录时间戳单调递增，
    // 避免本地时钟回拨时新编辑被服务端 LWW 误判为「旧编辑」而拒绝。
    rec.updatedAt = Math.max(now, (rec.updatedAt || 0) + 1);
    rec.localModifiedAt = now;  // 本地修改追踪（推送增量提取用，客户端墙钟时间轴）
  }

  // ---- 分类 ----
  function addCategory(cat) {
    touch(cat);
    state.categories.push(cat);
    commit();
  }

  function updateCategory(id, patch) {
    const c = state.categories.find(function (x) { return x.id === id && !x.deleted; });
    if (!c) return;
    Object.assign(c, patch);
    touch(c);
    // 同步冗余字段到关联条目，保证列表渲染一致
    state.events.forEach(function (e) { if (e.categoryId === id && !e.deleted) { e.categoryName = c.name; e.categoryColor = c.color; touch(e); } });
    state.todos.forEach(function (t) { if (t.categoryId === id && !t.deleted) { t.categoryName = c.name; t.categoryColor = c.color; touch(t); } });
    commit();
  }

  function deleteCategory(id) {
    const c = state.categories.find(function (x) { return x.id === id && !x.deleted; });
    if (c) { c.deleted = true; touch(c); }
    // 兜底：关联条目归为「未分类」
    const fallback = { categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98' };
    state.events.forEach(function (e) { if (e.categoryId === id && !e.deleted) { Object.assign(e, fallback); touch(e); } });
    state.todos.forEach(function (t) { if (t.categoryId === id && !t.deleted) { Object.assign(t, fallback); touch(t); } });
    commit();
  }

  // ---- 日程 ----
  function addEvent(ev) {
    touch(ev);
    state.events.push(ev);
    commit();
  }
  function updateEvent(id, patch) {
    const e = state.events.find(function (x) { return x.id === id && !x.deleted; });
    if (e) { Object.assign(e, patch); touch(e); commit(); }
  }
  function deleteEvent(id) {
    const e = state.events.find(function (x) { return x.id === id && !x.deleted; });
    if (e) { e.deleted = true; touch(e); commit(); }
  }

  // ---- 待办 ----
  function addTodo(t) {
    touch(t);
    state.todos.push(t);
    commit();
  }
  function updateTodo(id, patch) {
    const t = state.todos.find(function (x) { return x.id === id && !x.deleted; });
    if (t) { Object.assign(t, patch); touch(t); commit(); }
  }
  function deleteTodo(id) {
    const t = state.todos.find(function (x) { return x.id === id && !x.deleted; });
    if (t) { t.deleted = true; touch(t); commit(); }
  }
  function deleteTodos(ids) {
    const set = {};
    ids.forEach(function (i) { set[i] = true; });
    state.todos.forEach(function (x) { if (set[x.id] && !x.deleted) { x.deleted = true; touch(x); } });
    commit();
  }
  function updateTodos(ids, patch) {
    const set = {};
    ids.forEach(function (i) { set[i] = true; });
    state.todos.forEach(function (x) { if (set[x.id] && !x.deleted) { Object.assign(x, patch); touch(x); } });
    commit();
  }

  // ---- 记账账户 ----
  function addAccount(a) { touch(a); state.accounts.push(a); commit(); }
  function updateAccount(id, patch) {
    const a = state.accounts.find(function (x) { return x.id === id && !x.deleted; });
    if (a) { Object.assign(a, patch); touch(a); commit(); }
  }
  function deleteAccount(id) {
    const a = state.accounts.find(function (x) { return x.id === id && !x.deleted; });
    if (a) { a.deleted = true; touch(a); commit(); }
  }

  // ---- 记账分类 ----
  function addBookkeepingCategory(c) { touch(c); state.bookkeepingCategories.push(c); commit(); }
  function updateBookkeepingCategory(id, patch) {
    const c = state.bookkeepingCategories.find(function (x) { return x.id === id && !x.deleted; });
    if (c) { Object.assign(c, patch); touch(c); commit(); }
  }
  function deleteBookkeepingCategory(id) {
    const c = state.bookkeepingCategories.find(function (x) { return x.id === id && !x.deleted; });
    if (c) { c.deleted = true; touch(c); }
    // 关联流水归为未分类
    state.transactions.forEach(function (t) { if (t.categoryId === id && !t.deleted) { t.categoryId = null; touch(t); } });
    commit();
  }

  // ---- 流水 ----
  function addTransaction(t) { touch(t); state.transactions.push(t); commit(); }
  function updateTransaction(id, patch) {
    const t = state.transactions.find(function (x) { return x.id === id && !x.deleted; });
    if (t) { Object.assign(t, patch); touch(t); commit(); }
  }
  function deleteTransaction(id) {
    const t = state.transactions.find(function (x) { return x.id === id && !x.deleted; });
    if (t) { t.deleted = true; touch(t); commit(); }
  }

  // ---- 预算 ----
  function addBudget(b) { touch(b); state.budgets.push(b); commit(); }
  function updateBudget(id, patch) {
    const b = state.budgets.find(function (x) { return x.id === id && !x.deleted; });
    if (b) { Object.assign(b, patch); touch(b); commit(); }
  }
  function deleteBudget(id) {
    const b = state.budgets.find(function (x) { return x.id === id && !x.deleted; });
    if (b) { b.deleted = true; touch(b); commit(); }
  }

  // ---- 纪念日 ----
  function addMemorial(m) { touch(m); state.memorials.push(m); commit(); }
  function updateMemorial(id, patch) {
    const m = state.memorials.find(function (x) { return x.id === id && !x.deleted; });
    if (m) { Object.assign(m, patch); touch(m); commit(); }
  }
  function deleteMemorial(id) {
    const m = state.memorials.find(function (x) { return x.id === id && !x.deleted; });
    if (m) { m.deleted = true; touch(m); commit(); }
  }

  return {
    get: get,
    getRaw: getRaw,
    subscribe: subscribe,
    set: set,
    addCategory: addCategory,
    updateCategory: updateCategory,
    deleteCategory: deleteCategory,
    addEvent: addEvent,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,
    addTodo: addTodo,
    updateTodo: updateTodo,
    deleteTodo: deleteTodo,
    deleteTodos: deleteTodos,
    updateTodos: updateTodos,
    addAccount: addAccount,
    updateAccount: updateAccount,
    deleteAccount: deleteAccount,
    addBookkeepingCategory: addBookkeepingCategory,
    updateBookkeepingCategory: updateBookkeepingCategory,
    deleteBookkeepingCategory: deleteBookkeepingCategory,
    addTransaction: addTransaction,
    updateTransaction: updateTransaction,
    deleteTransaction: deleteTransaction,
    addBudget: addBudget,
    updateBudget: updateBudget,
    deleteBudget: deleteBudget,
    addMemorial: addMemorial,
    updateMemorial: updateMemorial,
    deleteMemorial: deleteMemorial,
  };
})();
