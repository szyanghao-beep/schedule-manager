/*
 * plan.js — 今日规划（Time Blocking 自动排程）。
 * 把「未完成且有预估耗时」的待办按 截止时间 → 四象限 → 优先级 贪心填入当天工作时段，
 * 展示今日时间线（已有日程 + 建议时间块），一键把建议块落到日程（生成时间块事件）。
 */
window.Modules = window.Modules || {};
window.Modules.plan = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const H = window.Helpers;
  const Utils = window.Utils;

  function render() {
    const root = document.getElementById('view-plan');
    clear(root);

    const state = Store.get();
    const now = Date.now();
    const dayStart = Utils.startOfDay(now);
    const dayEnd = Utils.addDays(dayStart, 1);

    // 已存在的日程 id（用于判断 scheduledEventId 是否仍有效）
    const liveEventIds = {};
    state.events.forEach(function (e) { liveEventIds[e.id] = true; });

    // 候选：未完成、有预估耗时、且尚未（有效）排到日程
    const candidates = state.todos.filter(function (t) {
      return t.status !== 'done' && Number(t.estimatedMinutes) > 0 && !(t.scheduledEventId && liveEventIds[t.scheduledEventId]);
    });

    // 今日已有日程实例（含重复展开、全天逐日）
    const todayEvents = [];
    state.events.forEach(function (e) {
      const dur = (e.endTime || e.startTime) - e.startTime;
      // 全天事件可能跨多天：把窗口起点前移一个时长，避免实例因「起点在窗外」而被漏掉
      const expandFrom = e.allDay ? dayStart - dur : dayStart;
      Utils.expandOccurrences(e, { from: expandFrom, to: dayEnd }).forEach(function (occ) {
        if (e.allDay) {
          let d = Utils.startOfDay(occ.startTime);
          while (d <= occ.endTime) {
            if (d >= dayStart && d < dayEnd) todayEvents.push({ kind: 'event', ev: e, start: d, end: Utils.addDays(d, 1), allDay: true });
            d = Utils.addDays(d, 1);
          }
        } else {
          todayEvents.push({ kind: 'event', ev: e, start: occ.startTime, end: occ.endTime, allDay: false });
        }
      });
    });

    const result = Utils.autoSchedule(candidates, state.events, {
      now, dayStart,
      workStartHour: C.WORK_HOURS.start, workEndHour: C.WORK_HOURS.end,
      slotMinutes: C.SCHEDULE_SLOT_MINUTES, bufferMinutes: C.SCHEDULE_BUFFER_MINUTES,
      urgentThresholdMs: H.urgentThresholdMs(),
    });
    const candById = {};
    candidates.forEach(function (t) { candById[t.id] = t; });

    // 头部
    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '今日规划 · ' + Utils.toDateStr(now)));
    const btnWrap = el('div', 'cal-nav');
    const applyBtn = el('button', 'btn btn-primary', '应用排程到日程');
    applyBtn.addEventListener('click', function () { applyBlocks(result.blocks, candById); });
    const redoBtn = el('button', 'btn', '重新排程');
    redoBtn.addEventListener('click', render);
    btnWrap.appendChild(applyBtn);
    btnWrap.appendChild(redoBtn);
    header.appendChild(btnWrap);
    root.appendChild(header);

    // 汇总
    const summary = el('div', 'plan-summary');
    summary.appendChild(summaryItem('待排程待办', candidates.length));
    const totalMin = candidates.reduce(function (s, t) { return s + Number(t.estimatedMinutes); }, 0);
    summary.appendChild(summaryItem('预估总耗时', totalMin + ' 分钟'));
    summary.appendChild(summaryItem('已排入', result.blocks.length));
    summary.appendChild(summaryItem('未排入', result.unscheduled.length));
    root.appendChild(summary);

    // 时间线：今日已有日程 + 建议时间块，按时间排序
    const timeline = el('div', 'card');
    timeline.appendChild(el('div', 'panel-title', '今日时间线'));
    const tl = todayEvents.slice();
    result.blocks.forEach(function (b) {
      const t = candById[b.todoId];
      tl.push({ kind: 'block', todo: t, start: b.start, end: b.end, allDay: false });
    });
    tl.sort(function (a, b) { return a.start - b.start; });
    if (!tl.length) timeline.appendChild(el('div', 'placeholder', '今日暂无安排'));
    tl.forEach(function (x) { timeline.appendChild(timelineRow(x)); });
    root.appendChild(timeline);

    // 未排入 + 缺预估耗时
    const unschedCard = el('div', 'card');
    unschedCard.style.marginTop = '16px';
    unschedCard.appendChild(el('div', 'panel-title', '未排入与待整理'));
    const list = el('div');
    result.unscheduled.map(function (id) { return candById[id]; }).filter(Boolean)
      .forEach(function (t) { list.appendChild(miniTodoRow(t, '工作时段已满，未能排入')); });
    state.todos.filter(function (t) { return t.status !== 'done' && !(Number(t.estimatedMinutes) > 0); })
      .forEach(function (t) { list.appendChild(miniTodoRow(t, '未设定预估耗时')); });
    if (!list.firstChild) list.appendChild(el('div', 'placeholder', '全部待办都已排程'));
    unschedCard.appendChild(list);
    root.appendChild(unschedCard);
  }

  // 把建议时间块落到日程：创建时间块事件 + 记录 scheduledEventId 关联
  function applyBlocks(blocks, candById) {
    let n = 0;
    blocks.forEach(function (b) {
      const t = candById[b.todoId];
      if (!t || t.scheduledEventId) return;
      const cat = H.categoryOf(t.categoryId);
      const ev = {
        id: Utils.genId(), status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
        title: t.title, description: t.description || '', allDay: false,
        startTime: b.start, endTime: b.end, priority: t.priority || 'medium',
        categoryId: t.categoryId, categoryName: cat.name, categoryColor: cat.color,
        repeat: { type: 'none', interval: 1, endDate: null }, remindBefore: 0,
      };
      Store.addEvent(ev);
      Store.updateTodo(t.id, { scheduledEventId: ev.id });
      n++;
    });
    window.Toast.success('已排入 ' + n + ' 项到日程');
  }

  function summaryItem(label, value) {
    const it = el('div', 'plan-summary-item');
    it.appendChild(el('div', 'plan-summary-label', label));
    it.appendChild(el('div', 'plan-summary-value', String(value)));
    return it;
  }

  function timelineRow(x) {
    const row = el('div', 'day-item' + (x.kind === 'block' ? ' day-item-todo' : ''));
    const time = el('div', 'day-item-time', x.allDay ? '全天' : (Utils.toTimeStr(x.start) + ' - ' + Utils.toTimeStr(x.end)));
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = x.kind === 'block'
      ? C.QUADRANT_COLOR[Utils.calcQuadrant(x.todo || {}, Date.now(), H.urgentThresholdMs())]
      : ((x.ev && x.ev.categoryColor) || '#4f8ef7');
    title.appendChild(dot);
    title.appendChild(document.createTextNode(x.kind === 'block' ? (x.todo ? x.todo.title : '') : x.ev.title));
    main.appendChild(title);
    if (x.kind === 'block') {
      main.appendChild(el('div', 'item-meta', '建议时间块 · ' + (x.todo && x.todo.estimatedMinutes ? x.todo.estimatedMinutes + ' 分钟' : '')));
    } else if (x.ev && x.ev.description) {
      main.appendChild(el('div', 'item-meta', x.ev.description));
    }
    row.appendChild(time);
    row.appendChild(main);
    if (x.kind === 'block' && x.todo) {
      row.appendChild(H.quadrantBadge(x.todo));
      row.addEventListener('dblclick', function () { window.Modules.todo.openTodoForm(x.todo); });
    }
    return row;
  }

  function miniTodoRow(t, note) {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', t.title));
    main.appendChild(el('div', 'item-meta', note));
    row.appendChild(main);
    const editBtn = el('button', 'btn btn-sm', '整理');
    editBtn.addEventListener('click', function () { window.Modules.todo.openTodoForm(t); });
    row.appendChild(editBtn);
    return row;
  }

  return { render: render };
})();
