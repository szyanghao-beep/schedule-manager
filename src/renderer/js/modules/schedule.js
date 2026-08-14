/*
 * schedule.js — 日程模块：日历视图（日/周/月）、日程 CRUD、全天/时段、重复系列的单次/未来/全部编辑。
 */
window.Modules = window.Modules || {};
window.Modules.schedule = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const H = window.Helpers;
  const Utils = window.Utils;
  const DAY_MS = 86400000;
  const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  let viewMode = 'month'; // month | week | day
  let anchor = Date.now();

  function render() {
    const root = document.getElementById('view-schedule');
    clear(root);
    root.appendChild(toolbar());
    if (viewMode === 'month') root.appendChild(renderMonth(anchor));
    else if (viewMode === 'week') root.appendChild(renderWeek(anchor));
    else root.appendChild(renderDay(anchor));
  }

  // ---------- 工具栏 ----------
  function toolbar() {
    const bar = el('div', 'cal-toolbar');

    const left = el('div', 'cal-nav');
    const prev = el('button', 'btn btn-sm', '‹');
    prev.title = '上一个';
    prev.addEventListener('click', function () { navigate(-1); });
    const today = el('button', 'btn btn-sm', '今天');
    today.addEventListener('click', function () { anchor = Date.now(); render(); });
    const next = el('button', 'btn btn-sm', '›');
    next.title = '下一个';
    next.addEventListener('click', function () { navigate(1); });
    left.appendChild(prev);
    left.appendChild(today);
    left.appendChild(next);
    left.appendChild(el('span', 'cal-title', viewTitle()));
    bar.appendChild(left);

    const right = el('div', 'cal-nav');
    const seg = el('div', 'seg');
    [['month', '月'], ['week', '周'], ['day', '日']].forEach(function (pair) {
      const b = el('button', 'seg-btn' + (viewMode === pair[0] ? ' active' : ''), pair[1]);
      b.addEventListener('click', function () { viewMode = pair[0]; render(); });
      seg.appendChild(b);
    });
    right.appendChild(seg);
    const addBtn = el('button', 'btn btn-primary', '+ 新增日程');
    addBtn.addEventListener('click', function () { openEventForm(null); });
    right.appendChild(addBtn);
    bar.appendChild(right);
    return bar;
  }

  function viewTitle() {
    const d = new Date(anchor);
    if (viewMode === 'month') return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
    if (viewMode === 'week') {
      const ws = Utils.startOfWeek(anchor);
      const we = Utils.addDays(ws, 6);
      return Utils.toDateStr(ws).slice(5).replace('-', '/') + ' - ' + Utils.toDateStr(we).slice(5).replace('-', '/');
    }
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function navigate(dir) {
    if (viewMode === 'month') anchor = H.addMonths(Utils.startOfMonth(anchor), dir);
    else if (viewMode === 'week') anchor = Utils.addDays(anchor, dir * 7);
    else anchor = Utils.addDays(anchor, dir);
    render();
  }

  // ---------- 数据收集 ----------
  // 收集 [from, to) 内的日程实例与待办提醒，统一按时间排序
  function collectItems(from, to) {
    const items = [];
    Store.get().events.forEach(function (e) {
      Utils.expandOccurrences(e, { limit: 200 }).forEach(function (o) {
        if (o.startTime >= from && o.startTime < to) items.push({ kind: 'event', ev: e, occ: o, startTime: o.startTime });
      });
    });
    // 待办提醒：未完成、有截止时间且设置了提醒（remindBefore > 0）的待办，
    // 在「截止时间 - 提前分钟」处生成一条提醒，与日程同步展示。
    Store.get().todos.forEach(function (t) {
      if (t.status === 'done') return;
      if (t.deadline == null || !t.remindBefore) return;
      const remindAt = t.deadline - t.remindBefore * 60 * 1000;
      if (remindAt >= from && remindAt < to) items.push({ kind: 'todo', todo: t, remindAt: remindAt, startTime: remindAt });
    });
    items.sort(function (a, b) { return a.startTime - b.startTime; });
    return items;
  }

  function groupByDay(items) {
    const byDay = {};
    items.forEach(function (x) {
      const d = Utils.toDateStr(x.startTime);
      (byDay[d] = byDay[d] || []).push(x);
    });
    return byDay;
  }

  // ---------- 月视图 ----------
  function renderMonth(anchor) {
    const monthStart = Utils.startOfMonth(anchor);
    const gridStart = Utils.startOfWeek(monthStart);
    const from = gridStart;
    const to = Utils.addDays(gridStart, 42);
    const byDay = groupByDay(collectItems(from, to));

    const grid = el('div', 'cal-grid');
    const wd = el('div', 'cal-weekdays');
    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (w) { wd.appendChild(el('div', 'cal-weekday', w)); });
    grid.appendChild(wd);
    const cells = el('div', 'cal-cells');
    for (let i = 0; i < 42; i++) {
      cells.appendChild(monthCell(Utils.addDays(gridStart, i), monthStart, byDay));
    }
    grid.appendChild(cells);
    return grid;
  }

  function monthCell(dayTs, monthStart, byDay) {
    const d = new Date(dayTs);
    const cell = el('div', 'cal-cell');
    if (d.getMonth() !== new Date(monthStart).getMonth()) cell.classList.add('other');
    if (Utils.isSameDay(dayTs, Date.now())) cell.classList.add('today');
    cell.appendChild(el('div', 'cal-date', String(d.getDate())));
    const list = byDay[Utils.toDateStr(dayTs)] || [];
    list.slice(0, 3).forEach(function (x) { cell.appendChild(itemChip(x)); });
    if (list.length > 3) cell.appendChild(el('div', 'cal-event more', '+' + (list.length - 3) + ' 更多'));
    cell.addEventListener('click', function () { anchor = dayTs; viewMode = 'day'; render(); });
    return cell;
  }

  // ---------- 周视图 ----------
  function renderWeek(anchor) {
    const gridStart = Utils.startOfWeek(anchor);
    const from = gridStart;
    const to = Utils.addDays(gridStart, 7);
    const byDay = groupByDay(collectItems(from, to));

    const grid = el('div', 'cal-grid');
    const cols = el('div', 'week-cols');
    for (let i = 0; i < 7; i++) {
      cols.appendChild(weekCol(Utils.addDays(gridStart, i), byDay));
    }
    grid.appendChild(cols);
    return grid;
  }

  function weekCol(dayTs, byDay) {
    const d = new Date(dayTs);
    const col = el('div', 'week-col');
    if (Utils.isSameDay(dayTs, Date.now())) col.classList.add('today');
    const head = el('div', 'week-col-day');
    head.appendChild(el('span', 'dnum', String(d.getDate())));
    head.appendChild(document.createTextNode(WEEKDAY[(d.getDay() + 6) % 7]));
    col.appendChild(head);
    const list = byDay[Utils.toDateStr(dayTs)] || [];
    list.forEach(function (x) { col.appendChild(itemChip(x)); });
    col.addEventListener('click', function () { anchor = dayTs; viewMode = 'day'; render(); });
    return col;
  }

  // ---------- 日视图 ----------
  function renderDay(anchor) {
    const dayStart = Utils.startOfDay(anchor);
    const items = collectItems(dayStart, Utils.addDays(dayStart, 1));
    const allDay = items.filter(function (x) { return x.kind === 'event' && x.ev.allDay; });
    const timed = items.filter(function (x) { return x.kind === 'event' && !x.ev.allDay; });
    const reminders = items.filter(function (x) { return x.kind === 'todo'; });

    const list = el('div', 'day-list');
    if (allDay.length) {
      list.appendChild(el('div', 'day-section-title', '全天'));
      allDay.forEach(function (x) { list.appendChild(dayItem(x.ev, x.occ)); });
    }
    if (timed.length) {
      list.appendChild(el('div', 'day-section-title', '时段'));
      timed.forEach(function (x) { list.appendChild(dayItem(x.ev, x.occ)); });
    }
    if (reminders.length) {
      list.appendChild(el('div', 'day-section-title', '提醒'));
      reminders.forEach(function (x) { list.appendChild(todoDayItem(x.todo, x.remindAt)); });
    }
    if (!items.length) list.appendChild(el('div', 'placeholder', '当天无日程'));
    return list;
  }

  function dayItem(ev, occ) {
    const row = el('div', 'day-item');
    const time = el('div', 'day-item-time', ev.allDay ? '全天' : Utils.toTimeStr(occ.startTime) + ' - ' + Utils.toTimeStr(occ.endTime));
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = ev.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(ev.title));
    main.appendChild(title);
    if (ev.description) main.appendChild(el('div', 'item-meta', ev.description));
    row.appendChild(time);
    row.appendChild(main);
    row.appendChild(H.badge('status', Utils.displayStatus(ev)));
    row.addEventListener('dblclick', function () { openEventAction(ev, occ); });
    row.addEventListener('contextmenu', function (e) { e.preventDefault(); eventContextMenu(e, ev, occ); });
    return row;
  }

  function todoDayItem(t, remindAt) {
    const row = el('div', 'day-item day-item-todo');
    const time = el('div', 'day-item-time', '🔔 ' + Utils.toTimeStr(remindAt));
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = t.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(t.title));
    main.appendChild(title);
    main.appendChild(el('div', 'item-meta', '待办提醒 · 截止 ' + Utils.toDateTimeStr(t.deadline)));
    row.appendChild(time);
    row.appendChild(main);
    row.appendChild(H.badge('priority', t.priority));
    row.addEventListener('dblclick', function () { openTodoAction(t); });
    row.addEventListener('contextmenu', function (e) { e.preventDefault(); todoContextMenu(e, t); });
    return row;
  }

  function eventChip(ev, occ) {
    const chip = el('div', 'cal-event');
    chip.style.background = ev.categoryColor || '#4f8ef7';
    chip.textContent = (ev.allDay ? '' : Utils.toTimeStr(occ.startTime) + ' ') + ev.title;
    chip.title = ev.title;
    chip.addEventListener('click', function (e) { e.stopPropagation(); openEventAction(ev, occ); });
    chip.addEventListener('contextmenu', function (e) { e.stopPropagation(); e.preventDefault(); eventContextMenu(e, ev, occ); });
    return chip;
  }

  // 月/周视图条目分派：待办提醒用专属样式
  function itemChip(x) {
    return x.kind === 'todo' ? todoChip(x.todo, x.remindAt) : eventChip(x.ev, x.occ);
  }

  function todoChip(t, remindAt) {
    const chip = el('div', 'cal-event cal-event-todo');
    chip.style.background = t.categoryColor || '#8a8f98';
    chip.textContent = '🔔 ' + Utils.toTimeStr(remindAt) + ' ' + t.title;
    chip.title = '待办提醒：' + t.title + '（截止 ' + Utils.toDateTimeStr(t.deadline) + '）';
    chip.addEventListener('click', function (e) { e.stopPropagation(); openTodoAction(t); });
    chip.addEventListener('contextmenu', function (e) { e.stopPropagation(); e.preventDefault(); todoContextMenu(e, t); });
    return chip;
  }

  function eventContextMenu(e, ev, occ) {
    const isRepeat = !!(ev.repeat && ev.repeat.type !== 'none');
    const items = [];
    if (isRepeat) {
      items.push({ label: '编辑本次', onClick: function () { openEventForm(ev, occ, 'single'); } });
      items.push({ label: '编辑之后所有', onClick: function () { openEventForm(ev, occ, 'future'); } });
      items.push({ label: '编辑全部系列', onClick: function () { openEventForm(ev, occ, 'all'); } });
    } else {
      items.push({ label: '编辑', onClick: function () { openEventForm(ev, occ); } });
    }
    items.push('-');
    items.push({ label: '删除', danger: true, onClick: function () { deleteEventScope(ev, occ); } });
    window.ContextMenu.show(e.clientX, e.clientY, items);
  }

  // 点击实例：非重复直接编辑；重复弹出范围选择
  function openEventAction(ev, occ) {
    if (!(ev.repeat && ev.repeat.type !== 'none')) { openEventForm(ev, occ); return; }
    const body = el('div');
    body.appendChild(el('p', 'scope-hint', '这是重复系列中的一个实例，请选择操作范围：'));
    const btns = el('div', 'scope-btns');
    [
      { label: '编辑本次', fn: function () { window.Modal.close(); openEventForm(ev, occ, 'single'); } },
      { label: '编辑之后所有', fn: function () { window.Modal.close(); openEventForm(ev, occ, 'future'); } },
      { label: '编辑全部系列', fn: function () { window.Modal.close(); openEventForm(ev, occ, 'all'); } },
      { label: '删除', danger: true, fn: function () { window.Modal.close(); deleteEventScope(ev, occ); } },
    ].forEach(function (it) {
      const b = el('button', 'btn' + (it.danger ? ' btn-danger' : ''));
      b.textContent = it.label;
      b.style.marginRight = '8px';
      b.addEventListener('click', it.fn);
      btns.appendChild(b);
    });
    body.appendChild(btns);
    window.Modal.open({ title: '重复日程', content: body, okText: false });
  }

  // ---------- 待办提醒交互 ----------
  function openTodoAction(t) {
    if (window.Modules.todo && window.Modules.todo.openTodoForm) window.Modules.todo.openTodoForm(t);
  }

  function completeTodo(t) {
    if (window.Modules.todo && window.Modules.todo.toggle) window.Modules.todo.toggle(t);
  }

  function todoContextMenu(e, t) {
    window.ContextMenu.show(e.clientX, e.clientY, [
      { label: '编辑待办', onClick: function () { openTodoAction(t); } },
      { label: '标记完成', onClick: function () { completeTodo(t); } },
    ]);
  }

  // ---------- 删除 ----------
  function deleteEventScope(ev, occ) {
    const isRepeat = !!(ev.repeat && ev.repeat.type !== 'none');
    if (!isRepeat || !occ) {
      if (confirm('确定删除该日程？')) { Store.deleteEvent(ev.id); window.Toast.success('已删除'); }
      return;
    }
    const body = el('div');
    body.appendChild(el('p', 'scope-hint', '删除该重复日程的哪部分？'));
    const btns = el('div', 'scope-btns');
    [
      { label: '仅删除本次', fn: function () {
        window.Modal.close();
        const ex = Object.assign({}, ev.exceptions || {});
        ex[occ.key] = true;
        Store.updateEvent(ev.id, { exceptions: ex });
        window.Toast.success('已删除本次');
      } },
      { label: '删除之后所有', fn: function () {
        window.Modal.close();
        const prevDay = Utils.addDays(Utils.startOfDay(occ.startTime), -1);
        Store.updateEvent(ev.id, { repeat: Object.assign({}, ev.repeat, { endDate: prevDay }) });
        window.Toast.success('已删除');
      } },
      { label: '删除全部系列', fn: function () {
        window.Modal.close();
        if (confirm('确定删除整个系列？')) { Store.deleteEvent(ev.id); window.Toast.success('已删除'); }
      } },
    ].forEach(function (it) {
      const b = el('button', 'btn' + (it.danger ? ' btn-danger' : ''));
      b.textContent = it.label;
      b.style.marginRight = '8px';
      b.addEventListener('click', it.fn);
      btns.appendChild(b);
    });
    body.appendChild(btns);
    window.Modal.open({ title: '删除重复日程', content: body, okText: false });
  }

  // ---------- 日程表单 ----------
  function defaultStart() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
  }

  function openEventForm(ev, occ, scope) {
    const isEdit = !!ev;
    const effStart = occ ? occ.startTime : (ev ? ev.startTime : defaultStart());
    const effEnd = occ ? occ.endTime : (ev ? ev.endTime : defaultStart() + 3600000);
    const allDayInit = ev ? !!ev.allDay : false;

    const body = el('div');

    const titleRow = el('div', 'form-row');
    titleRow.appendChild(el('label', null, '标题'));
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.dataset.field = 'title';
    titleInput.value = ev ? ev.title : '';
    titleRow.appendChild(titleInput);
    body.appendChild(titleRow);

    const descRow = el('div', 'form-row');
    descRow.appendChild(el('label', null, '描述'));
    const descInput = el('textarea');
    descInput.rows = 2;
    descInput.dataset.field = 'description';
    descInput.value = ev ? (ev.description || '') : '';
    descRow.appendChild(descInput);
    body.appendChild(descRow);

    const allDayRow = el('div', 'form-row inline');
    const allDayInput = el('input');
    allDayInput.type = 'checkbox';
    allDayInput.dataset.field = 'allDay';
    allDayInput.checked = allDayInit;
    allDayRow.appendChild(allDayInput);
    allDayRow.appendChild(el('label', null, '全天事件'));
    body.appendChild(allDayRow);

    const startRow = el('div', 'form-row');
    startRow.appendChild(el('label', null, '开始时间'));
    const startGrid = el('div', 'form-grid');
    const startDate = el('input'); startDate.type = 'date'; startDate.dataset.field = 'startDate'; startDate.value = Utils.toDateStr(effStart);
    const startTime = el('input'); startTime.type = 'time'; startTime.dataset.field = 'startTime'; startTime.value = Utils.toTimeStr(effStart);
    startGrid.appendChild(startDate); startGrid.appendChild(startTime);
    startRow.appendChild(startGrid);
    body.appendChild(startRow);

    const endRow = el('div', 'form-row');
    endRow.appendChild(el('label', null, '结束时间'));
    const endGrid = el('div', 'form-grid');
    const endDate = el('input'); endDate.type = 'date'; endDate.dataset.field = 'endDate'; endDate.value = Utils.toDateStr(effEnd);
    const endTime = el('input'); endTime.type = 'time'; endTime.dataset.field = 'endTime'; endTime.value = Utils.toTimeStr(effEnd);
    endGrid.appendChild(endDate); endGrid.appendChild(endTime);
    endRow.appendChild(endGrid);
    body.appendChild(endRow);

    const row2 = el('div', 'form-grid');
    const prioRow = el('div', 'form-row');
    prioRow.appendChild(el('label', null, '优先级'));
    const prioSelect = H.select(['low', 'medium', 'high'], C.PRIORITY_LABEL, ev ? ev.priority : 'medium');
    prioSelect.dataset.field = 'priority';
    prioRow.appendChild(prioSelect);
    row2.appendChild(prioRow);

    const catRow = el('div', 'form-row');
    catRow.appendChild(el('label', null, '分类'));
    const catSelect = H.categorySelect(ev ? ev.categoryId : '');
    catSelect.dataset.field = 'categoryId';
    catRow.appendChild(catSelect);
    row2.appendChild(catRow);
    body.appendChild(row2);

    const row3 = el('div', 'form-grid');
    const repeatRow = el('div', 'form-row');
    repeatRow.appendChild(el('label', null, '重复'));
    const repeatSelect = H.select(['none', 'daily', 'weekly', 'monthly', 'custom'], C.REPEAT_LABEL, (ev && ev.repeat) ? ev.repeat.type : 'none');
    repeatSelect.dataset.field = 'repeatType';
    repeatRow.appendChild(repeatSelect);
    row3.appendChild(repeatRow);

    const remindRow = el('div', 'form-row');
    remindRow.appendChild(el('label', null, '提醒'));
    const remindSelect = H.select(C.REMIND_OPTIONS, function (m) { return m === 0 ? '不提醒' : '提前 ' + m + ' 分钟'; }, ev ? (ev.remindBefore || 0) : Store.get().settings.defaultRemindBefore);
    remindSelect.dataset.field = 'remindBefore';
    remindRow.appendChild(remindSelect);
    row3.appendChild(remindRow);
    body.appendChild(row3);

    const intervalRow = el('div', 'form-row');
    intervalRow.appendChild(el('label', null, '自定义周期（天）'));
    const intervalInput = el('input');
    intervalInput.type = 'number'; intervalInput.min = 1;
    intervalInput.dataset.field = 'repeatInterval';
    intervalInput.value = (ev && ev.repeat && ev.repeat.interval) ? ev.repeat.interval : 1;
    intervalRow.appendChild(intervalInput);
    body.appendChild(intervalRow);
    intervalRow.style.display = 'none';

    const endRepeatRow = el('div', 'form-row');
    endRepeatRow.appendChild(el('label', null, '重复结束时间'));
    const endRepeatInput = el('input');
    endRepeatInput.type = 'date'; endRepeatInput.dataset.field = 'repeatEndDate';
    if (ev && ev.repeat && ev.repeat.endDate) endRepeatInput.value = Utils.toDateStr(ev.repeat.endDate);
    endRepeatRow.appendChild(endRepeatInput);
    body.appendChild(endRepeatRow);
    endRepeatRow.style.display = 'none';

    function syncAllDay() {
      startTime.style.display = allDayInput.checked ? 'none' : '';
      endTime.style.display = allDayInput.checked ? 'none' : '';
    }
    function syncRepeat() {
      intervalRow.style.display = repeatSelect.value === 'custom' ? '' : 'none';
      endRepeatRow.style.display = repeatSelect.value !== 'none' ? '' : 'none';
    }
    allDayInput.addEventListener('change', syncAllDay);
    repeatSelect.addEventListener('change', syncRepeat);
    syncAllDay();
    syncRepeat();

    window.Modal.open({
      title: formTitle(ev, scope),
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const allDay = d.allDay;
        let startTime, endTime;
        if (allDay) {
          startTime = Utils.startOfDay(Utils.parseDateTime(d.startDate, '00:00'));
          endTime = Utils.startOfDay(Utils.parseDateTime(d.endDate, '00:00')) + DAY_MS - 1;
        } else {
          startTime = Utils.parseDateTime(d.startDate, d.startTime);
          endTime = Utils.parseDateTime(d.endDate, d.endTime);
        }
        const input = {
          title: d.title.trim(),
          description: d.description.trim(),
          allDay: allDay,
          startTime: startTime,
          endTime: endTime,
          priority: d.priority,
          categoryId: d.categoryId,
          repeat: H.buildRepeat(d),
          remindBefore: Number(d.remindBefore),
        };
        if (input.allDay && input.endTime < input.startTime) { window.Toast.error('结束日期不能早于开始日期'); return false; }
        const v = Utils.validateEvent(input);
        if (!v.ok) { window.Toast.error(v.errors[0]); return false; }
        applyEventEdit(ev, occ, scope, input);
        window.Toast.success('已保存');
      },
    });
  }

  function formTitle(ev, scope) {
    if (!ev) return '新增日程';
    if (scope === 'single') return '编辑日程（仅本次）';
    if (scope === 'future') return '编辑日程（之后所有）';
    return '编辑日程';
  }

  // 应用编辑（含重复系列的范围处理）
  function applyEventEdit(ev, occ, scope, input) {
    const cat = H.categoryOf(input.categoryId);
    const base = Object.assign({}, input, { categoryName: cat.name, categoryColor: cat.color, updatedAt: Date.now() });

    if (!ev) {
      Store.addEvent(Object.assign({ id: Utils.genId(), status: 'pending', createdAt: Date.now() }, base));
      return;
    }

    const isRepeat = !!(ev.repeat && ev.repeat.type !== 'none');

    if (!isRepeat || scope === 'all') {
      Store.updateEvent(ev.id, base);
      return;
    }

    if (scope === 'single' && occ) {
      // 系列跳过该实例，另建独立覆盖事件
      const exceptions = Object.assign({}, ev.exceptions || {});
      exceptions[occ.key] = true;
      Store.updateEvent(ev.id, { exceptions: exceptions });
      Store.addEvent(Object.assign({}, base, {
        id: Utils.genId(), status: 'pending', createdAt: Date.now(),
        repeat: { type: 'none', interval: 1, endDate: null }, overrides: occ.key,
      }));
      return;
    }

    if (scope === 'future' && occ) {
      // 原系列截止到该次之前，新系列从该次开始沿用新字段与重复规则
      const prevDay = Utils.addDays(Utils.startOfDay(occ.startTime), -1);
      Store.updateEvent(ev.id, { repeat: Object.assign({}, ev.repeat, { endDate: prevDay }) });
      Store.addEvent(Object.assign({ id: Utils.genId(), status: 'pending', createdAt: Date.now() }, base));
      return;
    }

    Store.updateEvent(ev.id, base);
  }

  return { render: render };
})();
