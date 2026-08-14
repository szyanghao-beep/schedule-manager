/*
 * stats.js — 统计模块：今日/本周/本月完成率、逾期、累计完成。使用轻量 div 条形，保持极简。
 */
window.Modules = window.Modules || {};
window.Modules.stats = (function () {
  'use strict';
  const el = window.Dom.el;
  const clear = window.Dom.clear;

  function render() {
    const root = document.getElementById('view-stats');
    clear(root);
    const s = window.Utils.calcStats(Store.get().events, Store.get().todos);

    // 数字卡片
    const cards = el('div', 'stat-cards');
    cards.appendChild(statCard('今日完成率', s.today.rate + '%', s.today.done + ' / ' + s.today.total));
    cards.appendChild(statCard('本周完成', s.week.done + ' / ' + s.week.total, '完成率 ' + s.week.rate + '%'));
    cards.appendChild(statCard('本月完成', s.month.done + ' / ' + s.month.total, '完成率 ' + s.month.rate + '%'));
    cards.appendChild(statCard('逾期任务', String(s.overdue), '未处理'));
    cards.appendChild(statCard('累计已完成', String(s.completedTotal), '全部'));
    root.appendChild(cards);

    // 完成率对比条形图
    const chartCard = el('div', 'card');
    chartCard.style.marginTop = '16px';
    chartCard.appendChild(el('div', 'panel-title', '完成率对比'));
    const chart = el('div', 'chart');
    [['今日', s.today.rate], ['本周', s.week.rate], ['本月', s.month.rate]].forEach(function (item) {
      chart.appendChild(chartRow(item[0], item[1]));
    });
    chartCard.appendChild(chart);
    root.appendChild(chartCard);
  }

  function statCard(label, value, sub) {
    const c = el('div', 'stat-card');
    c.appendChild(el('div', 'stat-label', label));
    c.appendChild(el('div', 'stat-value', value));
    if (sub) c.appendChild(el('div', 'stat-sub', sub));
    return c;
  }

  function chartRow(label, pct) {
    const row = el('div', 'chart-row');
    row.appendChild(el('div', 'chart-label', label));
    const track = el('div', 'chart-track');
    const fill = el('div', 'chart-fill');
    fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'chart-val', pct + '%'));
    return row;
  }

  return { render: render };
})();
