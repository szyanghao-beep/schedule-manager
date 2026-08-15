/*
 * stats.js — 统计模块：今日/本周/本月完成率、逾期、累计完成、四象限分布与历史趋势。
 * 使用轻量 div 条形，保持极简。
 */
window.Modules = window.Modules || {};
window.Modules.stats = (function () {
  'use strict';
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const C = window.API.constants;
  const H = window.Helpers;

  let renderToken = 0; // 防止异步渲染交错导致重复节点

  async function render() {
    const token = ++renderToken;
    const root = document.getElementById('view-stats');
    clear(root);
    const s = window.Utils.calcStats(Store.get().events, Store.get().todos);
    const q = window.Utils.calcQuadrantStats(Store.get().todos, Date.now(), H.urgentThresholdMs());

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

    // 四象限分布（实时计算）
    root.appendChild(quadrantCard(q));

    // 近 30 天趋势（异步读取主进程维护的历史快照）
    const res = await window.API.getStatsHistory();
    if (token !== renderToken) return; // 已被更新的渲染取代，丢弃本次异步结果
    root.appendChild(trendCard((res && res.statsHistory) || []));
  }

  function quadrantCard(q) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '四象限分布（未完成待办）'));

    const grid = el('div', 'quad-grid');
    C.QUADRANT_ORDER.forEach(function (key) {
      grid.appendChild(quadCell(key, q[key], q.total));
    });
    card.appendChild(grid);
    return card;
  }

  function quadCell(key, count, total) {
    const cell = el('div', 'quad-cell');
    cell.style.borderTop = '3px solid ' + C.QUADRANT_COLOR[key];
    cell.appendChild(el('div', 'quad-label', C.QUADRANT_LABEL[key]));
    cell.appendChild(el('div', 'quad-value', String(count)));
    cell.appendChild(el('div', 'quad-sub', (total ? Math.round(count / total * 100) : 0) + '%'));
    return cell;
  }

  function trendCard(history) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '四象限近 30 天趋势'));

    const list = (history || []).slice(-30);
    if (!list.length) {
      card.appendChild(el('div', 'placeholder', '暂无历史记录（随时间推移会自动累积）'));
      return card;
    }
    list.forEach(function (day) { card.appendChild(trendRow(day)); });
    return card;
  }

  function trendRow(day) {
    const row = el('div', 'trend-row');
    row.appendChild(el('div', 'trend-date', day.date.slice(5).replace('-', '/')));
    const track = el('div', 'trend-track');
    const total = (day.q1 || 0) + (day.q2 || 0) + (day.q3 || 0) + (day.q4 || 0);
    C.QUADRANT_ORDER.forEach(function (key) {
      const v = day[key] || 0;
      if (v <= 0) return;
      const seg = el('div', 'trend-seg');
      seg.style.background = C.QUADRANT_COLOR[key];
      seg.style.width = (total ? (v / total * 100) : 0) + '%';
      seg.title = C.QUADRANT_LABEL[key] + '：' + v;
      track.appendChild(seg);
    });
    row.appendChild(track);
    row.appendChild(el('div', 'trend-total', String(total)));
    return row;
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
