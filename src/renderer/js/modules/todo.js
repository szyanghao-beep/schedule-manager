/*
 * todo.js — 待办模块：列表、CRUD、完成切换、批量操作、筛选、循环任务。
 */
window.Modules = window.Modules || {};
window.Modules.todo = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const H = window.Helpers;

  // 模块局部状态
  let filterCategory = 'all';
  let filterPriority = 'all';
  let filterStatus = 'all';
  let filterQuadrant = 'all';
  let selected = {}; // id -> true

  function render() {
    const root = document.getElementById('view-todo');
    clear(root);

    // 清理已不存在的选中项
    const state = Store.get();
    Object.keys(selected).forEach(function (id) {
      if (!state.todos.some(function (t) { return t.id === id; })) delete selected[id];
    });

    // 头部
    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '待办任务'));
    const addBtn = el('button', 'btn btn-primary', '+ 新增待办');
    addBtn.addEventListener('click', function () { openTodoForm(null); });
    header.appendChild(addBtn);
    root.appendChild(header);

    // 筛选栏
    root.appendChild(filterBar());

    // 批量操作栏（有选中时显示）
    if (Object.keys(selected).length > 0) root.appendChild(batchBar());

    // 列表
    const list = el('div');
    const items = filteredTodos(); // 只计算一次（2 年数据下避免重复 map/filter/sort）
    items.forEach(function (t) { list.appendChild(todoRow(t)); });
    if (!items.length) list.appendChild(el('div', 'placeholder', '暂无待办'));
    root.appendChild(list);
  }

  // 排序：未完成在前；其次按四象限优先级（Q1→Q4）；同象限按截止时间升序
  function filteredTodos() {
    const threshold = H.urgentThresholdMs();
    return Store.get().todos
      .map(function (t) {
        return { t: t, q: window.Utils.calcQuadrant(t, Date.now(), threshold) };
      })
      .filter(function (x) {
        const t = x.t;
        if (filterCategory !== 'all' && t.categoryId !== filterCategory) return false;
        if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
        if (filterStatus !== 'all' && window.Utils.displayStatus(t) !== filterStatus) return false;
        if (filterQuadrant !== 'all' && x.q !== filterQuadrant) return false;
        return true;
      })
      .sort(function (a, b) {
        const ad = a.t.status === 'done', bd = b.t.status === 'done';
        if (ad !== bd) return ad ? 1 : -1;
        const qd = C.QUADRANT_ORDER.indexOf(a.q) - C.QUADRANT_ORDER.indexOf(b.q);
        if (qd !== 0) return qd;
        return (a.t.deadline || Number.MAX_SAFE_INTEGER) - (b.t.deadline || Number.MAX_SAFE_INTEGER);
      })
      .map(function (x) { return x.t; });
  }

  function filterBar() {
    const bar = el('div', 'toolbar');
    bar.appendChild(el('span', 'item-meta', '筛选：'));

    const catSel = el('select');
    catSel.style.width = '140px';
    const allCat = el('option'); allCat.value = 'all'; allCat.textContent = '全部分类';
    catSel.appendChild(allCat);
    Store.get().categories.forEach(function (c) {
      const o = el('option'); o.value = c.id; o.textContent = c.name; catSel.appendChild(o);
    });
    catSel.value = filterCategory;
    catSel.addEventListener('change', function () { filterCategory = catSel.value; render(); });

    const prioSel = H.select(['all', 'low', 'medium', 'high'], { all: '全部优先级', low: '低', medium: '中', high: '高' }, filterPriority);
    prioSel.style.width = '120px';
    prioSel.addEventListener('change', function () { filterPriority = prioSel.value; render(); });

    const statusSel = H.select(['all', 'pending', 'doing', 'done', 'overdue'], { all: '全部状态', pending: '未开始', doing: '进行中', done: '已完成', overdue: '已过期' }, filterStatus);
    statusSel.style.width = '120px';
    statusSel.addEventListener('change', function () { filterStatus = statusSel.value; render(); });

    const quadSel = el('select');
    quadSel.style.width = '130px';
    [['all', '全部象限'], ['q1', 'Q1 重要紧急'], ['q2', 'Q2 重要不紧急'], ['q3', 'Q3 紧急不重要'], ['q4', 'Q4 不重要不紧急']].forEach(function (pair) {
      const o = el('option'); o.value = pair[0]; o.textContent = pair[1]; quadSel.appendChild(o);
    });
    quadSel.value = filterQuadrant;
    quadSel.addEventListener('change', function () { filterQuadrant = quadSel.value; render(); });

    bar.appendChild(catSel);
    bar.appendChild(prioSel);
    bar.appendChild(statusSel);
    bar.appendChild(quadSel);
    return bar;
  }

  function batchBar() {
    const bar = el('div', 'toolbar');
    const ids = Object.keys(selected);
    bar.appendChild(el('span', 'item-meta', '已选 ' + ids.length + ' 项'));

    const doneBtn = el('button', 'btn btn-sm', '标记完成');
    doneBtn.addEventListener('click', function () { Store.updateTodos(ids, { status: 'done', completedAt: Date.now() }); selected = {}; });
    const undoBtn = el('button', 'btn btn-sm', '标记未完成');
    undoBtn.addEventListener('click', function () { Store.updateTodos(ids, { status: 'pending', completedAt: null }); selected = {}; });
    const delBtn = el('button', 'btn btn-sm btn-danger', '批量删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('确定删除选中的 ' + ids.length + ' 项待办？')) return;
      Store.deleteTodos(ids); selected = {};
      window.Toast.success('已删除');
    });

    bar.appendChild(doneBtn);
    bar.appendChild(undoBtn);
    bar.appendChild(delBtn);
    return bar;
  }

  function todoRow(t) {
    const status = window.Utils.displayStatus(t);
    const row = el('div', 'item' + (status === 'overdue' ? ' overdue' : '') + (status === 'done' ? ' done' : ''));

    // 完成勾选
    const check = el('input', 'item-check');
    check.type = 'checkbox';
    check.checked = t.status === 'done';
    check.title = '标记完成 / 取消完成';
    check.addEventListener('change', function () { toggle(t); });

    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = t.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(t.title));
    main.appendChild(title);
    const meta = el('div', 'item-meta');
    const parts = [];
    if (t.deadline) parts.push('截止 ' + window.Utils.toDateTimeStr(t.deadline));
    if (t.repeat && t.repeat.type !== 'none') parts.push(C.REPEAT_LABEL[t.repeat.type]);
    meta.textContent = parts.join(' · ');
    main.appendChild(meta);

    // 批量选择勾选
    const sel = el('input', 'item-check');
    sel.type = 'checkbox';
    sel.checked = !!selected[t.id];
    sel.title = '选择（用于批量操作）';
    sel.addEventListener('change', function () {
      if (sel.checked) selected[t.id] = true; else delete selected[t.id];
      render();
    });

    const side = el('div', 'item-side');
    side.appendChild(H.quadrantBadge(t));
    side.appendChild(H.badge('priority', t.priority));
    side.appendChild(H.badge('status', status));
    const schedBtn = el('button', 'btn btn-sm', '⏱ 排到日程');
    schedBtn.title = '把该待办按预估耗时排到日程，生成时间块';
    schedBtn.addEventListener('click', function (e) { e.stopPropagation(); scheduleTodo(t); });
    side.appendChild(schedBtn);

    row.appendChild(check);
    row.appendChild(main);
    row.appendChild(sel);
    row.appendChild(side);

    row.addEventListener('dblclick', function () { openTodoForm(t); });
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      window.ContextMenu.show(e.clientX, e.clientY, [
        { label: t.status === 'done' ? '标记未完成' : '标记完成', onClick: function () { toggle(t); } },
        { label: '编辑', onClick: function () { openTodoForm(t); } },
        { label: '排到日程', onClick: function () { scheduleTodo(t); } },
        '-',
        { label: '删除', danger: true, onClick: function () { Store.deleteTodo(t.id); window.Toast.success('已删除'); } },
      ]);
    });

    return row;
  }

  // 完成/取消完成；循环任务完成后顺延到下一次
  function toggle(t) {
    if (t.status === 'done') {
      Store.updateTodo(t.id, { status: 'pending', completedAt: null });
      return;
    }
    if (t.repeat && t.repeat.type !== 'none' && t.deadline) {
      const occs = window.Utils.expandOccurrences(
        { id: t.id, startTime: t.deadline, endTime: t.deadline, repeat: t.repeat }, { limit: 50 }
      );
      const next = occs.find(function (o) { return o.startTime > t.deadline; });
      if (next) {
        Store.updateTodo(t.id, { deadline: next.startTime, status: 'pending', completedAt: null });
        window.Toast.success('已完成，已生成下一次');
        return;
      }
    }
    Store.updateTodo(t.id, { status: 'done', completedAt: Date.now() });
  }

  // 新增/编辑弹窗
  function openTodoForm(t) {
    const body = el('div');

    const titleRow = el('div', 'form-row');
    titleRow.appendChild(el('label', null, '标题'));
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.dataset.field = 'title';
    titleInput.value = t ? t.title : '';
    titleRow.appendChild(titleInput);
    body.appendChild(titleRow);

    const descRow = el('div', 'form-row');
    descRow.appendChild(el('label', null, '描述'));
    const descInput = el('textarea');
    descInput.rows = 2;
    descInput.dataset.field = 'description';
    descInput.value = t ? (t.description || '') : '';
    descRow.appendChild(descInput);
    body.appendChild(descRow);

    const deadlineRow = el('div', 'form-row');
    deadlineRow.appendChild(el('label', null, '截止时间'));
    const grid = el('div', 'form-grid');
    const dateInput = el('input');
    dateInput.type = 'date'; dateInput.dataset.field = 'deadlineDate';
    const timeInput = el('input');
    timeInput.type = 'time'; timeInput.dataset.field = 'deadlineTime';
    if (t && t.deadline) {
      dateInput.value = window.Utils.toDateStr(t.deadline);
      timeInput.value = window.Utils.toTimeStr(t.deadline);
    }
    grid.appendChild(dateInput);
    grid.appendChild(timeInput);
    deadlineRow.appendChild(grid);
    body.appendChild(deadlineRow);

    const prioRow = el('div', 'form-row');
    prioRow.appendChild(el('label', null, '优先级'));
    const prioSelect = H.select(['low', 'medium', 'high'], C.PRIORITY_LABEL, t ? t.priority : 'medium');
    prioSelect.dataset.field = 'priority';
    prioRow.appendChild(prioSelect);
    body.appendChild(prioRow);

    const catRow = el('div', 'form-row');
    catRow.appendChild(el('label', null, '分类'));
    const catSelect = H.categorySelect(t ? t.categoryId : '');
    catSelect.dataset.field = 'categoryId';
    catRow.appendChild(catSelect);
    body.appendChild(catRow);

    const importanceRow = el('div', 'form-row');
    importanceRow.appendChild(el('label', null, '四象限重要性'));
    const importanceSelect = H.select(['important', 'not_important'], C.IMPORTANCE_LABEL, (t && t.importance === 'not_important') ? 'not_important' : 'important');
    importanceSelect.dataset.field = 'importance';
    importanceRow.appendChild(importanceSelect);
    body.appendChild(importanceRow);

    const estRow = el('div', 'form-row');
    estRow.appendChild(el('label', null, '预估耗时（时间块排程用）'));
    const estSelect = el('select');
    estSelect.dataset.field = 'estimatedMinutes';
    const estNone = el('option'); estNone.value = ''; estNone.textContent = '不设定';
    estSelect.appendChild(estNone);
    C.ESTIMATED_MINUTES_OPTIONS.forEach(function (m) {
      const o = el('option'); o.value = m; o.textContent = m + ' 分钟'; estSelect.appendChild(o);
    });
    estSelect.value = (t && t.estimatedMinutes) ? t.estimatedMinutes : '';
    estRow.appendChild(estSelect);
    body.appendChild(estRow);

    const rr = el('div', 'form-grid');
    const repeatRow = el('div', 'form-row');
    repeatRow.appendChild(el('label', null, '重复'));
    const repeatSelect = H.select(['none', 'daily', 'weekly', 'monthly', 'custom'], C.REPEAT_LABEL, (t && t.repeat) ? t.repeat.type : 'none');
    repeatSelect.dataset.field = 'repeatType';
    repeatRow.appendChild(repeatSelect);
    rr.appendChild(repeatRow);

    const remindRow = el('div', 'form-row');
    remindRow.appendChild(el('label', null, '提醒'));
    const remindSelect = H.select(C.REMIND_OPTIONS, function (m) { return m === 0 ? '不提醒' : '提前 ' + m + ' 分钟'; }, t ? (t.remindBefore || 0) : Store.get().settings.defaultRemindBefore);
    remindSelect.dataset.field = 'remindBefore';
    remindRow.appendChild(remindSelect);
    rr.appendChild(remindRow);
    body.appendChild(rr);

    const intervalRow = el('div', 'form-row');
    intervalRow.appendChild(el('label', null, '自定义周期（天）'));
    const intervalInput = el('input');
    intervalInput.type = 'number'; intervalInput.min = 1;
    intervalInput.dataset.field = 'repeatInterval';
    intervalInput.value = (t && t.repeat && t.repeat.interval) ? t.repeat.interval : 1;
    intervalRow.appendChild(intervalInput);
    body.appendChild(intervalRow);
    intervalRow.style.display = 'none';

    const endRow = el('div', 'form-row');
    endRow.appendChild(el('label', null, '重复结束时间'));
    const endInput = el('input');
    endInput.type = 'date'; endInput.dataset.field = 'repeatEndDate';
    if (t && t.repeat && t.repeat.endDate) endInput.value = window.Utils.toDateStr(t.repeat.endDate);
    endRow.appendChild(endInput);
    body.appendChild(endRow);
    endRow.style.display = 'none';

    function syncRepeat() {
      intervalRow.style.display = repeatSelect.value === 'custom' ? '' : 'none';
      endRow.style.display = repeatSelect.value !== 'none' ? '' : 'none';
    }
    repeatSelect.addEventListener('change', syncRepeat);
    syncRepeat();

    window.Modal.open({
      title: t ? '编辑待办' : '新增待办',
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const input = {
          title: d.title.trim(),
          description: d.description.trim(),
          deadline: d.deadlineDate ? window.Utils.parseDateTime(d.deadlineDate, d.deadlineTime || '23:59') : null,
          priority: d.priority,
          categoryId: d.categoryId,
          importance: d.importance || 'important',
          repeat: H.buildRepeat(d),
          remindBefore: Number(d.remindBefore),
          estimatedMinutes: d.estimatedMinutes ? Number(d.estimatedMinutes) : null,
        };
        const v = window.Utils.validateTodo(input);
        if (!v.ok) { window.Toast.error(v.errors[0]); return false; }
        const cat = H.categoryOf(d.categoryId);
        if (t) {
          Store.updateTodo(t.id, Object.assign(input, { categoryName: cat.name, categoryColor: cat.color, updatedAt: Date.now() }));
        } else {
          Store.addTodo(Object.assign({
            id: window.Utils.genId(), status: 'pending', completedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
          }, input, { categoryName: cat.name, categoryColor: cat.color }));
        }
        window.Toast.success('已保存');
      },
    });
  }

  // 当前时间向上取整到下一个 30 分钟槽位，作为默认时间块起点
  function nextBlockStart() {
    const d = new Date();
    const slot = Math.ceil(d.getMinutes() / 30) * 30;
    d.setSeconds(0, 0);
    if (slot === 60) { d.setMinutes(0); d.setHours(d.getHours() + 1); }
    else d.setMinutes(slot);
    return d.getTime();
  }

  // 排到日程：把待办按预估耗时生成一个时间块日程，并记录 scheduledEventId 关联
  function scheduleTodo(t, defaultStart) {
    const dur = (t && t.estimatedMinutes) ? t.estimatedMinutes : 60;
    const startInit = defaultStart || (t && t.deadline) || nextBlockStart();

    const body = el('div');
    const hint = el('div', 'item-meta', '按预估耗时 ' + dur + ' 分钟生成一个时间块日程（不会改动待办本身）。');
    hint.style.marginBottom = '12px';
    body.appendChild(hint);

    const startRow = el('div', 'form-row');
    startRow.appendChild(el('label', null, '开始时间'));
    const grid = el('div', 'form-grid');
    const dateInput = el('input');
    dateInput.type = 'date'; dateInput.dataset.field = 'blockDate'; dateInput.value = window.Utils.toDateStr(startInit);
    const timeInput = el('input');
    timeInput.type = 'time'; timeInput.dataset.field = 'blockTime'; timeInput.value = window.Utils.toTimeStr(startInit);
    grid.appendChild(dateInput);
    grid.appendChild(timeInput);
    startRow.appendChild(grid);
    body.appendChild(startRow);

    window.Modal.open({
      title: '排到日程 · ' + (t.title || '待办'),
      content: body,
      okText: '创建时间块',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const start = window.Utils.parseDateTime(d.blockDate, d.blockTime || '09:00');
        const end = start + dur * 60000;
        const cat = H.categoryOf(t.categoryId);
        const ev = {
          id: window.Utils.genId(), status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
          title: t.title, description: t.description || '', allDay: false,
          startTime: start, endTime: end, priority: t.priority || 'medium',
          categoryId: t.categoryId, categoryName: cat.name, categoryColor: cat.color,
          repeat: { type: 'none', interval: 1, endDate: null }, remindBefore: 0,
        };
        Store.addEvent(ev);
        Store.updateTodo(t.id, { scheduledEventId: ev.id });
        window.Toast.success('已排到日程');
      },
    });
  }

  return { render: render, openTodoForm: openTodoForm, toggle: toggle, scheduleTodo: scheduleTodo };
})();
