/*
 * review.js — 周回顾（GTD Weekly Review）。
 * 汇总本周完成/新增/逾期/收件箱积压/缺预估耗时，展示四象限分布，
 * 列出「需要关注」的待办，并给出周回顾清单。
 */
window.Modules = window.Modules || {};
window.Modules.review = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;

  function render() {
    const root = document.getElementById('view-review');
    clear(root);
    const state = Store.get();
    const now = Date.now();
    const weekStart = window.Utils.startOfWeek(now);
    const s = window.Utils.calcWeeklyReview(state.todos, now);

    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '周回顾 · ' + window.Utils.toDateStr(weekStart) + ' 起'));
    root.appendChild(header);

    // 汇总卡片
    const cards = el('div', 'stat-cards');
    cards.appendChild(statCard('本周完成', s.doneWeek));
    cards.appendChild(statCard('本周新增', s.createdWeek));
    cards.appendChild(statCard('逾期待办', s.overdue, '#e05b5b'));
    cards.appendChild(statCard('收件箱积压', s.inbox));
    cards.appendChild(statCard('缺预估耗时', s.noEstimate));
    root.appendChild(cards);

    // 四象限分布（未完成）
    const quadCard = el('div', 'card');
    quadCard.style.marginTop = '16px';
    quadCard.appendChild(el('div', 'panel-title', '四象限分布（未完成）'));
    const quadGrid = el('div', 'quad-grid');
    C.QUADRANT_ORDER.forEach(function (q) {
      const cell = el('div', 'quad-cell');
      cell.appendChild(el('div', 'quad-label', C.QUADRANT_LABEL[q]));
      const v = el('div', 'quad-value', String(s.byQuadrant[q] || 0));
      v.style.color = C.QUADRANT_COLOR[q];
      cell.appendChild(v);
      quadGrid.appendChild(cell);
    });
    quadCard.appendChild(quadGrid);
    root.appendChild(quadCard);

    // 需要关注
    const attnCard = el('div', 'card');
    attnCard.style.marginTop = '16px';
    attnCard.appendChild(el('div', 'panel-title', '需要关注'));
    const attn = [];
    state.todos.forEach(function (t) {
      if (t.status === 'done') return;
      const st = window.Utils.displayStatus(t);
      if (st === 'overdue') attn.push({ t: t, note: '已逾期' });
      else if (t.deadline == null) attn.push({ t: t, note: '未整理（收件箱）' });
      else if (!(Number(t.estimatedMinutes) > 0)) attn.push({ t: t, note: '缺预估耗时' });
    });
    const list = el('div');
    if (!attn.length) list.appendChild(el('div', 'placeholder', '本周没有需要特别关注的事项'));
    attn.forEach(function (x) { list.appendChild(reviewRow(x.t, x.note)); });
    attnCard.appendChild(list);
    root.appendChild(attnCard);

    // 周回顾清单
    const checklist = el('div', 'card');
    checklist.style.marginTop = '16px';
    checklist.appendChild(el('div', 'panel-title', '周回顾清单'));
    [
      '清空收件箱：把每条想法归入项目或安排时间',
      '确认没有遗漏的逾期与未排程待办',
      '回顾本周完成情况，调整下周计划',
    ].forEach(function (txt) { checklist.appendChild(el('div', 'review-check', '✓ ' + txt)); });
    root.appendChild(checklist);
  }

  function statCard(label, value, color) {
    const card = el('div', 'stat-card');
    card.appendChild(el('div', 'stat-label', label));
    const v = el('div', 'stat-value', String(value));
    if (color) v.style.color = color;
    card.appendChild(v);
    return card;
  }

  function reviewRow(t, note) {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', t.title));
    main.appendChild(el('div', 'item-meta', note));
    row.appendChild(main);
    const btn = el('button', 'btn btn-sm', '处理');
    btn.addEventListener('click', function () { window.Modules.todo.openTodoForm(t); });
    row.appendChild(btn);
    return row;
  }

  return { render: render };
})();
