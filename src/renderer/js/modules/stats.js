/*
 * stats.js — 统计模块：今日/本周/本月完成率、逾期、累计完成、四象限分布与历史趋势。
 * 使用轻量 div 条形，保持极简。
 * 支持穿透：点击数字卡片 / 四象限格子 / 条形图行，展开底层明细列表（待办可勾选/编辑，日程可定位）。
 * 刷新优化：历史趋势本地缓存 + 实时合并「今天」，避免每次数据变更都全量 IPC 重取 + 重绘抖动。
 */
window.Modules = window.Modules || {};
window.Modules.stats = (function () {
  'use strict';
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const C = window.API.constants;
  const H = window.Helpers;
  const Utils = window.Utils;

  let historyCache = null; // 主进程历史快照缓存，避免每次重绘都走 IPC
  let historyLoading = false; // 防止并发重复拉取
  let drill = null;           // 当前穿透状态：{ type, title }
  let trendView = 'chart';    // 趋势展示：chart（堆叠面积图）| list（明细表）

  const DRILL_TITLES = {
    today: '今日任务明细',
    week: '本周任务明细',
    month: '本月任务明细',
    overdue: '逾期任务明细',
    completed: '已完成明细',
  };

  function render() {
    const content = document.querySelector('.content');
    const sc = content ? content.scrollTop : 0; // 保留滚动位置，避免重绘后跳回顶部
    const root = document.getElementById('view-stats');
    clear(root);

    const now = Date.now();
    const s = Utils.calcStats(Store.get().events, Store.get().todos, now);
    const q = Utils.calcQuadrantStats(Store.get().todos, now, H.urgentThresholdMs());

    // 数字卡片
    const cards = el('div', 'stat-cards');
    cards.appendChild(statCard('今日完成率', s.today.rate + '%', s.today.done + ' / ' + s.today.total, 'today'));
    cards.appendChild(statCard('本周完成', s.week.done + ' / ' + s.week.total, '完成率 ' + s.week.rate + '%', 'week'));
    cards.appendChild(statCard('本月完成', s.month.done + ' / ' + s.month.total, '完成率 ' + s.month.rate + '%', 'month'));
    cards.appendChild(statCard('逾期任务', String(s.overdue), '未处理', 'overdue'));
    cards.appendChild(statCard('累计已完成', String(s.completedTotal), '全部', 'completed'));
    root.appendChild(cards);

    // 完成率对比条形图
    const chartCard = el('div', 'card');
    chartCard.style.marginTop = '16px';
    chartCard.appendChild(el('div', 'panel-title', '完成率对比'));
    const chart = el('div', 'chart');
    [['今日', s.today.rate, 'today'], ['本周', s.week.rate, 'week'], ['本月', s.month.rate, 'month']].forEach(function (item) {
      chart.appendChild(chartRow(item[0], item[1], item[2]));
    });
    chartCard.appendChild(chart);
    root.appendChild(chartCard);

    // 四象限分布（实时计算）
    root.appendChild(quadrantCard(q));

    // 穿透明细
    const panel = drillPanel();
    if (panel) root.appendChild(panel);

    // 近 30 天趋势（缓存 + 实时合并今天）
    root.appendChild(trendCard(historyCache));

    // 首次进入时异步加载历史快照（仅一次，后续走缓存）
    if (historyCache == null && !historyLoading) {
      historyLoading = true;
      window.API.getStatsHistory().then(function (res) {
        historyCache = (res && res.statsHistory) || [];
        historyLoading = false;
        render();
      });
    }

    if (content) content.scrollTop = sc;
  }

  // ---------- 穿透 ----------
  function setDrill(type, title) {
    drill = { type: type, title: title };
    render();
  }

  function clearDrill() {
    drill = null;
    render();
  }

  function drillPanel() {
    if (!drill) return null;
    const items = collectDrill(drill.type);
    const card = el('div', 'card');
    card.style.marginTop = '16px';

    const head = el('div', 'panel-header');
    head.appendChild(el('div', 'panel-title', drill.title + '（' + items.length + ' 项）'));
    const close = el('button', 'btn btn-sm', '收起');
    close.addEventListener('click', clearDrill);
    head.appendChild(close);
    card.appendChild(head);

    if (!items.length) {
      card.appendChild(el('div', 'placeholder', '暂无数据'));
      return card;
    }
    items.forEach(function (x) { card.appendChild(drillRow(x)); });
    return card;
  }

  // 按类型收集底层条目（口径与 calcStats / calcQuadrantStats 一致，逻辑在 utils.calcDrillItems 中单测）
  function collectDrill(type, now) {
    return Utils.calcDrillItems(Store.get().events, Store.get().todos, type, now, H.urgentThresholdMs());
  }

  function drillRow(x) {
    return x.kind === 'todo' ? todoDrillRow(x.item) : eventDrillRow(x.item);
  }

  function todoDrillRow(t) {
    const status = Utils.displayStatus(t);
    const row = el('div', 'item' + (status === 'overdue' ? ' overdue' : '') + (status === 'done' ? ' done' : ''));

    const check = el('input', 'item-check');
    check.type = 'checkbox';
    check.checked = t.status === 'done';
    check.title = '标记完成 / 取消完成';
    check.addEventListener('change', function () { window.Modules.todo.toggle(t); });

    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = t.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(t.title));
    main.appendChild(title);
    const parts = [];
    if (t.deadline) parts.push('截止 ' + Utils.toDateTimeStr(t.deadline));
    parts.push(C.QUADRANT_LABEL[Utils.calcQuadrant(t, Date.now(), H.urgentThresholdMs())]);
    main.appendChild(el('div', 'item-meta', parts.join(' · ')));

    const side = el('div', 'item-side');
    side.appendChild(H.badge('status', status));
    const edit = el('button', 'btn btn-sm', '编辑');
    edit.addEventListener('click', function () { window.Modules.todo.openTodoForm(t); });
    side.appendChild(edit);

    row.appendChild(check);
    row.appendChild(main);
    row.appendChild(side);
    return row;
  }

  function eventDrillRow(e) {
    const status = Utils.displayStatus(e);
    const row = el('div', 'item' + (status === 'overdue' ? ' overdue' : '') + (status === 'done' ? ' done' : ''));
    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = e.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(e.title));
    main.appendChild(title);
    main.appendChild(el('div', 'item-meta', (e.allDay ? '全天 ' : '') + Utils.toDateTimeStr(e.startTime)));

    const side = el('div', 'item-side');
    side.appendChild(H.badge('status', status));
    const gotoBtn = el('button', 'btn btn-sm', '定位');
    gotoBtn.addEventListener('click', function () {
      window.App.switchView('schedule');
      if (window.Modules.schedule && window.Modules.schedule.goto) window.Modules.schedule.goto(e.startTime);
    });
    side.appendChild(gotoBtn);

    row.appendChild(main);
    row.appendChild(side);
    return row;
  }

  // ---------- 卡片 / 图 ----------
  function quadrantCard(q) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '四象限分布（未完成待办 · 点击穿透）'));

    const grid = el('div', 'quad-grid');
    C.QUADRANT_ORDER.forEach(function (key) {
      grid.appendChild(quadCell(key, q[key], q.total));
    });
    card.appendChild(grid);
    return card;
  }

  function quadCell(key, count, total) {
    const cell = el('div', 'quad-cell quad-cell-clickable');
    cell.style.borderTop = '3px solid ' + C.QUADRANT_COLOR[key];
    cell.appendChild(el('div', 'quad-label', C.QUADRANT_LABEL[key]));
    cell.appendChild(el('div', 'quad-value', String(count)));
    cell.appendChild(el('div', 'quad-sub', (total ? Math.round(count / total * 100) : 0) + '%'));
    cell.title = '点击查看该象限待办';
    cell.addEventListener('click', function () { setDrill(key, C.QUADRANT_LABEL[key] + ' · 待办'); });
    return cell;
  }

  // 趋势：本地缓存的历史 + 实时合并「今天」，保证与顶部四象限卡片一致
  function trendCard(history) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';

    const head = el('div', 'panel-header');
    head.appendChild(el('div', 'panel-title', '四象限近 30 天趋势'));

    const right = el('div', 'cal-nav');
    const seg = el('div', 'seg');
    [['chart', '图'], ['list', '列表']].forEach(function (pair) {
      const b = el('button', 'seg-btn' + (trendView === pair[0] ? ' active' : ''), pair[1]);
      b.addEventListener('click', function () { trendView = pair[0]; render(); });
      seg.appendChild(b);
    });
    right.appendChild(seg);
    const refresh = el('button', 'btn btn-sm', '刷新');
    refresh.style.marginLeft = '8px';
    refresh.title = '重新读取主进程历史快照';
    refresh.addEventListener('click', function () { historyCache = null; historyLoading = false; render(); });
    right.appendChild(refresh);
    head.appendChild(right);
    card.appendChild(head);

    const list = mergedTrend(history);
    if (!list.length) {
      card.appendChild(el('div', 'placeholder', '暂无历史记录（随时间推移会自动累积）'));
      return card;
    }
    card.appendChild(trendView === 'list' ? trendTable(list) : trendChart(list));
    return card;
  }

  function mergedTrend(history) {
    const list = (history || []).slice(-30);
    const todayStr = Utils.toDateStr(Date.now());
    const live = Utils.calcQuadrantStats(Store.get().todos, Date.now(), H.urgentThresholdMs());
    const todayEntry = { date: todayStr, q1: live.q1, q2: live.q2, q3: live.q3, q4: live.q4, total: live.total };
    const merged = list.slice();
    const last = merged[merged.length - 1];
    if (last && last.date === todayStr) merged[merged.length - 1] = todayEntry;
    else merged.push(todayEntry);
    return merged.slice(-30);
  }

  // 堆叠面积图（纯 SVG，无第三方库）：X=日期、Y=未完成待办数，四象限固定配色堆叠
  function trendChart(list) {
    const wrap = el('div', 'trend-chart-wrap');
    const NS = 'http://www.w3.org/2000/svg';
    const W = 720, H = 220;
    const padL = 44, padR = 14, padT = 12, padB = 30;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const n = list.length;

    const totals = list.map(function (d) { return (d.q1 || 0) + (d.q2 || 0) + (d.q3 || 0) + (d.q4 || 0); });
    const yMax = niceCeil(Math.max.apply(null, totals.concat([1])));
    const stepX = n <= 1 ? 0 : innerW / (n - 1);
    const xAt = function (i) { return padL + stepX * i; };
    const yAt = function (v) { return padT + innerH * (1 - v / yMax); };

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '四象限近 30 天趋势堆叠面积图');

    // y 轴网格线 + 刻度
    yTicks(yMax).forEach(function (v) {
      const y = yAt(v);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('class', 'trend-gridline');
      svg.appendChild(line);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', padL - 8); label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'trend-axis-label');
      label.textContent = String(Math.round(v));
      svg.appendChild(label);
    });

    // 堆叠面积（q1 在底部、q4 在顶部，固定顺序保证颜色不随数据漂移）
    const cum = list.map(function () { return 0; });
    C.QUADRANT_ORDER.forEach(function (key) {
      const top = list.map(function (d, i) { return { x: xAt(i), y: yAt(cum[i] + (d[key] || 0)) }; });
      const bottom = list.map(function (d, i) { return { x: xAt(i), y: yAt(cum[i]) }; });
      list.forEach(function (d, i) { cum[i] += (d[key] || 0); });

      let areaD = '';
      top.forEach(function (p, i) { areaD += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); });
      for (let i = n - 1; i >= 0; i--) areaD += 'L' + bottom[i].x.toFixed(1) + ' ' + bottom[i].y.toFixed(1);
      areaD += 'Z';
      const area = document.createElementNS(NS, 'path');
      area.setAttribute('d', areaD);
      area.setAttribute('fill', C.QUADRANT_COLOR[key]);
      area.setAttribute('class', 'trend-area');
      svg.appendChild(area);

      let lineD = '';
      top.forEach(function (p, i) { lineD += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); });
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('d', lineD);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', C.QUADRANT_COLOR[key]);
      line.setAttribute('class', 'trend-line');
      svg.appendChild(line);
    });

    // x 轴日期刻度（稀疏）
    xTicks(n).forEach(function (i) {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', xAt(i)); label.setAttribute('y', H - 8);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'trend-axis-label');
      label.textContent = (list[i].date || '').slice(5).replace('-', '/');
      svg.appendChild(label);
    });

    // 交互：十字线 + 悬停提示
    const cross = document.createElementNS(NS, 'line');
    cross.setAttribute('class', 'trend-crosshair');
    cross.setAttribute('y1', padT); cross.setAttribute('y2', padT + innerH);
    cross.style.display = 'none';
    svg.appendChild(cross);

    const overlay = document.createElementNS(NS, 'rect');
    overlay.setAttribute('x', padL); overlay.setAttribute('y', padT);
    overlay.setAttribute('width', innerW); overlay.setAttribute('height', innerH);
    overlay.setAttribute('fill', 'transparent');
    overlay.setAttribute('pointer-events', 'all');
    svg.appendChild(overlay);

    const tip = el('div', 'trend-tooltip');
    tip.style.display = 'none';
    wrap.appendChild(tip);

    overlay.addEventListener('mousemove', function (ev) {
      const rect = svg.getBoundingClientRect();
      const scaleX = W / rect.width;
      let i = stepX === 0 ? 0 : Math.round((((ev.clientX - rect.left) * scaleX) - padL) / stepX);
      i = Math.max(0, Math.min(n - 1, i));
      const cx = xAt(i);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
      cross.style.display = '';
      renderTooltip(tip, list[i]);
      const wrapRect = wrap.getBoundingClientRect();
      const px = rect.left + cx / scaleX;
      let left = px - wrapRect.left + 12;
      if (left + tip.offsetWidth > wrapRect.width) left = px - wrapRect.left - tip.offsetWidth - 12;
      tip.style.left = left + 'px';
      tip.style.top = (rect.top - wrapRect.top + 8) + 'px';
    });
    overlay.addEventListener('mouseleave', function () { cross.style.display = 'none'; tip.style.display = 'none'; });

    wrap.appendChild(svg);
    wrap.appendChild(trendLegend());
    return wrap;
  }

  function renderTooltip(tip, d) {
    tip.textContent = '';
    tip.appendChild(el('div', 'trend-tip-date', (d.date || '').slice(5).replace('-', '/')));
    C.QUADRANT_ORDER.forEach(function (key) {
      const row = el('div', 'trend-tip-row');
      const sw = el('span', 'trend-tip-swatch');
      sw.style.background = C.QUADRANT_COLOR[key];
      row.appendChild(sw);
      row.appendChild(el('span', 'trend-tip-label', C.QUADRANT_LABEL[key]));
      row.appendChild(el('span', 'trend-tip-value', String(d[key] || 0)));
      tip.appendChild(row);
    });
    tip.style.display = '';
  }

  function trendLegend() {
    const legend = el('div', 'trend-legend');
    C.QUADRANT_ORDER.forEach(function (key) {
      const item = el('div', 'trend-legend-item');
      const sw = el('span', 'trend-legend-swatch');
      sw.style.background = C.QUADRANT_COLOR[key];
      item.appendChild(sw);
      item.appendChild(document.createTextNode(C.QUADRANT_LABEL[key]));
      legend.appendChild(item);
    });
    return legend;
  }

  // 明细表视图（无图例，列头即身份；同时作为图表的可达替代）
  function trendTable(list) {
    const table = el('div', 'trend-table');
    const head = el('div', 'trend-table-row trend-table-head');
    head.appendChild(el('div', 'trend-table-date', '日期'));
    C.QUADRANT_ORDER.forEach(function (key) { head.appendChild(el('div', 'trend-table-cell', C.QUADRANT_LABEL[key])); });
    head.appendChild(el('div', 'trend-table-cell', '合计'));
    table.appendChild(head);
    list.slice().reverse().forEach(function (d) {
      const row = el('div', 'trend-table-row');
      row.appendChild(el('div', 'trend-table-date', (d.date || '').slice(5).replace('-', '/')));
      C.QUADRANT_ORDER.forEach(function (key) { row.appendChild(el('div', 'trend-table-cell', String(d[key] || 0))); });
      row.appendChild(el('div', 'trend-table-cell', String((d.q1 || 0) + (d.q2 || 0) + (d.q3 || 0) + (d.q4 || 0))));
      table.appendChild(row);
    });
    return table;
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * mag;
  }

  function yTicks(yMax) {
    const step = niceCeil(yMax / 3);
    const ticks = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < yMax) ticks.push(yMax);
    return ticks;
  }

  function xTicks(n) {
    if (n <= 6) { const out = []; for (let i = 0; i < n; i++) out.push(i); return out; }
    const out = [];
    const step = Math.ceil(n / 5);
    for (let i = 0; i < n; i += step) out.push(i);
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    return out;
  }

  function statCard(label, value, sub, type) {
    const c = el('div', 'stat-card stat-card-clickable');
    c.appendChild(el('div', 'stat-label', label));
    c.appendChild(el('div', 'stat-value', value));
    if (sub) c.appendChild(el('div', 'stat-sub', sub));
    if (type) {
      c.title = '点击查看' + DRILL_TITLES[type];
      c.addEventListener('click', function () { setDrill(type, DRILL_TITLES[type]); });
    }
    return c;
  }

  function chartRow(label, pct, type) {
    const row = el('div', 'chart-row chart-row-clickable');
    row.appendChild(el('div', 'chart-label', label));
    const track = el('div', 'chart-track');
    const fill = el('div', 'chart-fill');
    fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'chart-val', pct + '%'));
    if (type) {
      row.title = '点击查看' + DRILL_TITLES[type];
      row.addEventListener('click', function () { setDrill(type, DRILL_TITLES[type]); });
    }
    return row;
  }

  return { render: render };
})();
