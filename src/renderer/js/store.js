/*
 * store.js — 渲染进程内存数据仓库：状态 + 变更订阅 + 防抖持久化。
 * 所有业务数据变更统一走这里的 CRUD 方法，保证「变更 -> 通知订阅者 -> 防抖保存」链路一致。
 */
window.Store = (function () {
  'use strict';

  const state = {
    categories: [],
    events: [],
    todos: [],
    settings: { defaultRemindBefore: 15 },
  };

  const listeners = [];
  let saveTimer = null;

  function get() { return state; }

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
      });
    }, 500);
  }

  // 提交：通知订阅者并防抖持久化
  function commit() { emit(); scheduleSave(); }

  function set(partial) {
    Object.assign(state, partial);
    commit();
  }

  // ---- 分类 ----
  function addCategory(cat) { state.categories.push(cat); commit(); }

  function updateCategory(id, patch) {
    const c = state.categories.find(function (x) { return x.id === id; });
    if (!c) return;
    Object.assign(c, patch);
    // 同步冗余字段到关联条目，保证列表渲染一致
    state.events.forEach(function (e) { if (e.categoryId === id) { e.categoryName = c.name; e.categoryColor = c.color; } });
    state.todos.forEach(function (t) { if (t.categoryId === id) { t.categoryName = c.name; t.categoryColor = c.color; } });
    commit();
  }

  function deleteCategory(id) {
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    // 兜底：关联条目归为「未分类」
    const fallback = { categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98' };
    state.events.forEach(function (e) { if (e.categoryId === id) Object.assign(e, fallback); });
    state.todos.forEach(function (t) { if (t.categoryId === id) Object.assign(t, fallback); });
    commit();
  }

  // ---- 日程 ----
  function addEvent(ev) { state.events.push(ev); commit(); }
  function updateEvent(id, patch) {
    const e = state.events.find(function (x) { return x.id === id; });
    if (e) { Object.assign(e, patch); commit(); }
  }
  function deleteEvent(id) {
    state.events = state.events.filter(function (x) { return x.id !== id; });
    commit();
  }

  // ---- 待办 ----
  function addTodo(t) { state.todos.push(t); commit(); }
  function updateTodo(id, patch) {
    const t = state.todos.find(function (x) { return x.id === id; });
    if (t) { Object.assign(t, patch); commit(); }
  }
  function deleteTodo(id) {
    state.todos = state.todos.filter(function (x) { return x.id !== id; });
    commit();
  }
  function deleteTodos(ids) {
    const set = {};
    ids.forEach(function (i) { set[i] = true; });
    state.todos = state.todos.filter(function (x) { return !set[x.id]; });
    commit();
  }
  function updateTodos(ids, patch) {
    const set = {};
    ids.forEach(function (i) { set[i] = true; });
    state.todos.forEach(function (x) { if (set[x.id]) Object.assign(x, patch); });
    commit();
  }

  return {
    get: get,
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
  };
})();
