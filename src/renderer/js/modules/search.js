/*
 * search.js — 搜索模块：全文检索日程与待办（标题 / 描述 / 分类名），支持 Ctrl+F 唤起。
 * 匹配与排序逻辑在 utils.searchItems（纯函数、可单测），本模块只负责 UI 与交互。
 * 输入框不随结果区一起重建，保证输入过程不丢焦点；Store 数据变更时结果区自动刷新。
 */
window.Modules = window.Modules || {};
window.Modules.search = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const H = window.Helpers;
  const Utils = window.Utils;

  let inputEl = null;
  let lastQuery = '';

  function render() {
    const root = document.getElementById('view-search');
    clear(root);
    root.appendChild(el('div', 'panel-title', '搜索'));
    const box = el('div', 'search-box');
    inputEl = el('input');
    inputEl.type = 'text';
    inputEl.placeholder = '搜索日程与待办（标题 / 描述 / 分类）';
    inputEl.value = lastQuery;
    inputEl.addEventListener('input', function () {
      lastQuery = inputEl.value;
      renderResults();
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        inputEl.value = '';
        lastQuery = '';
        renderResults();
      }
    });
    box.appendChild(inputEl);
    root.appendChild(box);
    renderResults();
  }

  function renderResults() {
    const root = document.getElementById('view-search');
    const old = document.getElementById('search-results');
    if (old) old.remove();
    const results = el('div');
    results.id = 'search-results';

    const q = lastQuery.trim();
    if (!q) {
      results.appendChild(el('div', 'placeholder', '输入关键词搜索日程与待办'));
      root.appendChild(results);
      return;
    }
    const terms = q.toLowerCase().split(/\s+/).filter(function (t) { return t; });
    const res = Utils.searchItems(q, Store.get().events, Store.get().todos);
    if (!res.events.length && !res.todos.length) {
      results.appendChild(el('div', 'placeholder', '未找到与「' + q + '」匹配的日程或待办'));
      root.appendChild(results);
      return;
    }

    if (res.events.length) {
      results.appendChild(el('div', 'search-group-title', '日程（' + res.events.length + '）'));
      res.events.forEach(function (e) { results.appendChild(eventRow(e, terms)); });
    }
    if (res.todos.length) {
      results.appendChild(el('div', 'search-group-title', '待办（' + res.todos.length + '）'));
      res.todos.forEach(function (t) { results.appendChild(todoRow(t, terms)); });
    }
    root.appendChild(results);
  }

  function eventRow(e, terms) {
    const status = Utils.displayStatus(e);
    const row = el('div', 'item' + (status === 'overdue' ? ' overdue' : '') + (status === 'done' ? ' done' : ''));
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = e.categoryColor || '#8a8f98';
    title.appendChild(dot);
    appendHighlighted(title, e.title, terms);
    main.appendChild(title);
    const parts = [];
    parts.push((e.allDay ? '全天 ' : '') + Utils.toDateTimeStr(e.startTime));
    if (e.description) parts.push(e.description);
    if (e.categoryName) parts.push(e.categoryName);
    main.appendChild(el('div', 'item-meta', parts.join(' · ')));
    row.appendChild(main);
    const side = el('div', 'item-side');
    side.appendChild(H.badge('status', status));
    const gotoBtn = el('button', 'btn btn-sm', '定位');
    gotoBtn.title = '跳转到日程视图的这一天';
    gotoBtn.addEventListener('click', function () {
      window.App.switchView('schedule');
      if (window.Modules.schedule && window.Modules.schedule.goto) window.Modules.schedule.goto(e.startTime);
    });
    side.appendChild(gotoBtn);
    row.appendChild(side);
    return row;
  }

  function todoRow(t, terms) {
    const status = Utils.displayStatus(t);
    const row = el('div', 'item' + (status === 'overdue' ? ' overdue' : '') + (status === 'done' ? ' done' : ''));
    const check = el('input', 'item-check');
    check.type = 'checkbox';
    check.checked = t.status === 'done';
    check.title = '标记完成 / 取消完成';
    check.addEventListener('change', function () {
      if (window.Modules.todo && window.Modules.todo.toggle) window.Modules.todo.toggle(t);
    });
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = t.categoryColor || '#8a8f98';
    title.appendChild(dot);
    appendHighlighted(title, t.title, terms);
    main.appendChild(title);
    const parts = [];
    if (t.deadline) parts.push('截止 ' + Utils.toDateTimeStr(t.deadline));
    if (t.description) parts.push(t.description);
    if (t.categoryName) parts.push(t.categoryName);
    if (t.repeat && t.repeat.type !== 'none') parts.push(C.REPEAT_LABEL[t.repeat.type]);
    main.appendChild(el('div', 'item-meta', parts.join(' · ')));
    row.appendChild(check);
    row.appendChild(main);
    const side = el('div', 'item-side');
    side.appendChild(H.quadrantBadge(t));
    const edit = el('button', 'btn btn-sm', '编辑');
    edit.addEventListener('click', function () {
      if (window.Modules.todo && window.Modules.todo.openTodoForm) window.Modules.todo.openTodoForm(t);
    });
    side.appendChild(edit);
    row.appendChild(side);
    return row;
  }

  // 高亮首个命中的关键词片段（只高亮一个词，避免多词包裹嵌套）
  function appendHighlighted(parent, text, terms) {
    const str = String(text);
    const lower = str.toLowerCase();
    let best = null;
    terms.forEach(function (t) {
      const idx = lower.indexOf(t);
      if (idx !== -1 && (best === null || idx < best.idx)) best = { idx: idx, len: t.length };
    });
    if (!best) { parent.appendChild(document.createTextNode(str)); return; }
    parent.appendChild(document.createTextNode(str.slice(0, best.idx)));
    const mark = el('mark', 'search-hl', str.slice(best.idx, best.idx + best.len));
    parent.appendChild(mark);
    parent.appendChild(document.createTextNode(str.slice(best.idx + best.len)));
  }

  // 唤起聚焦（Ctrl+F 或导航切到搜索页时由 App 调用）
  function focus() {
    if (inputEl) { inputEl.focus(); inputEl.select(); }
  }

  return { render: render, focus: focus };
})();
