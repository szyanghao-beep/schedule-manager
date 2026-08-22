/*
 * inbox.js — 收件箱（GTD Inbox）。
 * 「未整理」= 未完成且没有截止时间的待办（想法先丢进来，之后再处理）。
 * 提供快速捕捉（全局快捷键 Ctrl+Shift+N 或界面按钮），以及整理/排程/完成/删除操作。
 */
window.Modules = window.Modules || {};
window.Modules.inbox = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;

  function inboxTodos() {
    return Store.get().todos.filter(function (t) { return t.status !== 'done' && t.deadline == null; });
  }

  function render() {
    const root = document.getElementById('view-inbox');
    clear(root);
    const items = inboxTodos();

    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '收件箱（未整理）'));
    const btns = el('div', 'cal-nav');
    const captureBtn = el('button', 'btn btn-primary', '⚡ 快速捕捉');
    captureBtn.addEventListener('click', openQuickCapture);
    btns.appendChild(captureBtn);
    header.appendChild(btns);
    root.appendChild(header);

    const hint = el('div', 'item-meta', 'GTD：把想法先丢进来，之后在这里「整理」——补截止时间、预估耗时，或直接排到日程。全局快捷键 Ctrl+Shift+N 可随时捕捉。');
    hint.style.marginBottom = '12px';
    root.appendChild(hint);

    const list = el('div');
    if (!items.length) list.appendChild(el('div', 'placeholder', '收件箱是空的，按 Ctrl+Shift+N 快速捕捉一条想法'));
    items.forEach(function (t) { list.appendChild(inboxRow(t)); });
    root.appendChild(list);
  }

  function inboxRow(t) {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = t.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(t.title));
    main.appendChild(title);
    const meta = el('div', 'item-meta');
    const parts = ['捕捉于 ' + (t.createdAt ? window.Utils.toDateTimeStr(t.createdAt) : '—')];
    if (t.description) parts.push(t.description);
    meta.textContent = parts.join(' · ');
    main.appendChild(meta);

    const side = el('div', 'item-side');
    const editBtn = el('button', 'btn btn-sm', '整理');
    editBtn.title = '补充截止时间、预估耗时等信息';
    editBtn.addEventListener('click', function () { window.Modules.todo.openTodoForm(t); });
    const schedBtn = el('button', 'btn btn-sm', '排到日程');
    schedBtn.addEventListener('click', function () { window.Modules.todo.scheduleTodo(t); });
    const doneBtn = el('button', 'btn btn-sm', '完成');
    doneBtn.addEventListener('click', function () { window.Modules.todo.toggle(t); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () { Store.deleteTodo(t.id); window.Toast.success('已删除'); });
    side.appendChild(editBtn);
    side.appendChild(schedBtn);
    side.appendChild(doneBtn);
    side.appendChild(delBtn);

    row.appendChild(main);
    row.appendChild(side);
    row.addEventListener('dblclick', function () { window.Modules.todo.openTodoForm(t); });
    return row;
  }

  // 快速捕捉：只填一个标题，默认进入收件箱（无截止时间、无分类）
  function openQuickCapture() {
    const body = el('div');
    const titleRow = el('div', 'form-row');
    titleRow.appendChild(el('label', null, '捕捉内容'));
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.dataset.field = 'captureTitle';
    titleInput.placeholder = '记下一件事、一个想法…';
    titleRow.appendChild(titleInput);
    body.appendChild(titleRow);

    const descRow = el('div', 'form-row');
    descRow.appendChild(el('label', null, '备注（可选）'));
    const descInput = el('textarea');
    descInput.rows = 2;
    descInput.dataset.field = 'captureDesc';
    descRow.appendChild(descInput);
    body.appendChild(descRow);

    window.Modal.open({
      title: '快速捕捉',
      content: body,
      okText: '收入收件箱',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const title = (d.captureTitle || '').trim();
        if (!title) { window.Toast.error('内容不能为空'); return false; }
        Store.addTodo({
          id: window.Utils.genId(), status: 'pending', completedAt: null,
          createdAt: Date.now(), updatedAt: Date.now(),
          title: title, description: (d.captureDesc || '').trim(),
          deadline: null, priority: 'medium', categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98',
          importance: 'important', repeat: { type: 'none', interval: 1, endDate: null },
          remindBefore: 0, estimatedMinutes: null,
        });
        window.Toast.success('已收入收件箱');
      },
    });

    setTimeout(function () { if (titleInput.focus) titleInput.focus(); }, 0);
  }

  return { render: render, openQuickCapture: openQuickCapture };
})();
