/*
 * customer.js — 客户商机跟进模块（2.3.2）
 *
 * 设计：
 *   - 客户档案（含金额流水：预估可调整 / 落单确认 / 赢单后增购累加）
 *   - 记录跟进时「下次跟进时间」为必填 → 自动生成一条普通待办（deadline = 下次跟进时间），
 *     从而直接复用待办的提醒、四象限、今日规划、时间块、周回顾等全部能力
 *   - 阶段流转留痕，可回溯每段停留时长
 */
window.Modules = window.Modules || {};
window.Modules.customer = (function () {
  'use strict';
  const C = window.API.constants;
  const CU = window.CustomerUtil;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const Utils = window.Utils;
  const DAY = 86400000;

  let filterStage = 'active'; // active（推进中）| all | 具体阶段
  let detailId = null;        // 当前展开详情的客户 id
  // 团队共用商机库：客户一多就必须能「搜」和「按人看」，否则只能靠翻列表
  let keyword = '';           // 搜索关键词（名称/联系人/电话/负责人/备注）
  let filterOwner = 'all';    // 'all' | ''（未分配）| 具体负责人
  let bucket = '';            // '' 不按跟进时间筛 | overdue | today | week | none
  let showTeam = false;       // 是否展开「按负责人」团队汇总

  // ---------- 工具 ----------
  function money(n) {
    const v = Number(n) || 0;
    if (v === 0) return '¥0';
    if (v >= 10000) {
      const w = v / 10000;
      return '¥' + (w % 1 === 0 ? w : w.toFixed(2)) + '万';
    }
    return '¥' + v.toLocaleString('zh-CN');
  }

  function stageBadge(stage) {
    const b = el('span', 'badge', C.CUSTOMER_STAGE_LABEL[stage] || stage);
    b.style.background = C.CUSTOMER_STAGE_COLOR[stage] || '#8a8f98';
    b.style.color = '#fff';
    return b;
  }

  function followupHint(c, fus, now) {
    const next = CU.nextFollowupAt(c, fus);
    const box = el('div', 'item-meta');
    if (next == null) {
      box.textContent = '尚未安排下次跟进';
      box.style.color = 'var(--warning)';
      return box;
    }
    const diff = next - now;
    const days = Math.round(diff / DAY);
    let text;
    if (diff < 0) text = '已超期 ' + Math.abs(days) + ' 天';
    else if (days === 0) text = '今天该跟进';
    else if (days === 1) text = '明天跟进';
    else text = days + ' 天后跟进（' + Utils.toDateStr(next) + '）';
    box.textContent = '下次跟进：' + Utils.toDateTimeStr(next) + ' · ' + text;
    if (diff < 0) box.style.color = 'var(--danger)';
    else if (days <= 1) box.style.color = 'var(--warning)';
    return box;
  }

  // ---------- 主渲染 ----------
  function render() {
    const root = document.getElementById('view-customer');
    clear(root);

    const all = Store.get().customers;
    const fus = Store.get().followups;
    const now = Date.now();

    // 顶部：统计 + 新增
    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '客户商机'));
    const btns = el('div', 'cal-nav');
    const addBtn = el('button', 'btn btn-primary', '+ 新增客户');
    addBtn.addEventListener('click', function () { openCustomerForm(null); });
    btns.appendChild(addBtn);
    header.appendChild(btns);
    root.appendChild(header);

    // 统计条（漏斗口径与业绩口径分开）
    const sum = CU.summarize(all);
    const cards = el('div', 'stat-cards');
    [
      ['推进中商机', String(sum.activeCount), '未成交客户'],
      ['在谈预估', money(sum.expectedTotal), '未成交预估合计'],
      ['已成交客户', String(sum.wonCount), '赢单数'],
      ['累计成交', money(sum.wonTotal), '含增购 ' + money(sum.upsellTotal)],
      ['流失', String(sum.lostCount), '输单数'],
    ].forEach(function (pair) {
      const c = el('div', 'stat-card');
      c.appendChild(el('div', 'stat-label', pair[0]));
      c.appendChild(el('div', 'stat-value', pair[1]));
      c.appendChild(el('div', 'stat-sub', pair[2]));
      cards.appendChild(c);
    });
    root.appendChild(cards);

    // 筛选
    const bar = el('div', 'toolbar');
    bar.style.marginTop = '16px';
    bar.appendChild(el('span', 'item-meta', '筛选：'));
    const sel = el('select');
    sel.style.width = '160px';
    [['active', '推进中（默认）'], ['all', '全部客户']].forEach(function (p) {
      const o = el('option'); o.value = p[0]; o.textContent = p[1]; sel.appendChild(o);
    });
    C.CUSTOMER_STAGES.forEach(function (s) {
      const o = el('option'); o.value = s; o.textContent = C.CUSTOMER_STAGE_LABEL[s]; sel.appendChild(o);
    });
    sel.value = filterStage;
    sel.addEventListener('change', function () { filterStage = sel.value; render(); });
    bar.appendChild(sel);

    // 搜索（团队共用商机库时，客户一多翻列表就找不着了）
    const search = el('input');
    search.type = 'search';
    search.placeholder = '搜客户名称 / 联系人 / 电话 / 负责人';
    search.style.width = '220px';
    search.style.marginLeft = '8px';
    search.value = keyword;
    search.addEventListener('input', function () {
      keyword = search.value;
      render();
      // render() 会重建 DOM，需把焦点与光标交还给新的搜索框，否则每敲一个字就丢焦点
      const next = document.getElementById('customer-search');
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    });
    search.id = 'customer-search';
    bar.appendChild(search);

    // 负责人筛选（团队场景：只看自己负责的客户）
    const owners = CU.ownerList(all);
    // 防「筛选中的负责人已不存在」：select.value 会落回空值，
    // 而空值在这套 UI 里代表「只看未分配」，会静默变成完全不同的筛选结果
    if (filterOwner !== 'all' && filterOwner !== '' && owners.indexOf(filterOwner) < 0) {
      filterOwner = 'all';
    }
    let ownerOptions = [['all', '全部负责人']];
    if (owners.length) ownerOptions = ownerOptions.concat(owners.map(function (o) { return [o, o]; }));
    ownerOptions.push(['', '未分配']);
    const ownerSel = el('select');
    ownerSel.style.width = '140px';
    ownerSel.style.marginLeft = '8px';
    ownerOptions.forEach(function (p) {
      const o = el('option'); o.value = p[0]; o.textContent = p[1]; ownerSel.appendChild(o);
    });
    ownerSel.value = filterOwner;
    ownerSel.addEventListener('change', function () { filterOwner = ownerSel.value; render(); });
    bar.appendChild(ownerSel);

    const resetBtn = el('button', 'btn btn-sm', '重置');
    resetBtn.style.marginLeft = '8px';
    resetBtn.addEventListener('click', function () {
      keyword = ''; filterOwner = 'all'; bucket = ''; filterStage = 'active'; render();
    });
    bar.appendChild(resetBtn);
    root.appendChild(bar);

    // 「今天该跟谁」工作台：直接回答团队每天的第一个问题
    const bk = CU.followupBuckets(all, fus, now);
    const chips = el('div', 'toolbar');
    chips.style.marginTop = '8px';
    chips.appendChild(el('span', 'item-meta', '跟进待办：'));
    [['', '不限'], ['overdue', '已逾期 ' + bk.overdue.length], ['today', '今天 ' + bk.today.length],
      ['week', '本周 ' + bk.week.length], ['none', '未安排 ' + bk.none.length]].forEach(function (p) {
      const active = bucket === p[0];
      const b = el('button', 'btn btn-sm' + (active ? ' btn-primary' : ''), p[1]);
      b.addEventListener('click', function () { bucket = active ? '' : p[0]; render(); });
      chips.appendChild(b);
    });
    root.appendChild(chips);

    // 团队汇总（默认折叠，避免挤占列表空间）
    const teamToggle = el('button', 'btn btn-sm', showTeam ? '收起团队汇总' : '团队汇总（按负责人）');
    teamToggle.style.marginTop = '8px';
    teamToggle.addEventListener('click', function () { showTeam = !showTeam; render(); });
    root.appendChild(teamToggle);
    if (showTeam) root.appendChild(teamTable(all, fus, now));

    // 过滤链：阶段 → 负责人 → 跟进桶 → 关键词搜索（四者可叠加）
    let list = all;
    if (filterStage === 'active') list = list.filter(function (c) { return !CU.isClosed(c); });
    else if (filterStage !== 'all') list = list.filter(function (c) { return c.stage === filterStage; });
    if (filterOwner !== 'all') list = CU.filterByOwner(list, filterOwner);
    if (bucket) list = bk[bucket].filter(function (c) { return list.indexOf(c) >= 0; });
    list = CU.searchCustomers(list, keyword);

    const sorted = CU.sortCustomers(list, fus, now);
    const wrap = el('div');
    wrap.style.marginTop = '8px';
    if (!sorted.length) {
      const filtered = !!(keyword || bucket || filterOwner !== 'all');
      wrap.appendChild(el('div', 'placeholder',
        filtered
          ? '没有符合当前筛选条件的客户（可点「重置」清除条件）'
          : '暂无客户，点右上角「+ 新增客户」开始'));
    } else {
      sorted.forEach(function (c) { wrap.appendChild(customerCard(c, fus, now)); });
    }
    root.appendChild(wrap);
  }

  // ---------- 团队汇总：每个负责人一行（谁在谈多少、成交多少、几个该跟进） ----------
  function teamTable(all, fus, now) {
    const box = el('div', 'card');
    box.style.marginTop = '8px';
    box.appendChild(el('div', 'panel-title', '团队汇总（按负责人）'));
    const rows = CU.summarizeByOwner(all, fus, now);
    if (!rows.length) {
      box.appendChild(el('div', 'placeholder', '暂无客户'));
      return box;
    }
    rows.forEach(function (r) {
      const line = el('div', 'item');
      line.style.alignItems = 'center';
      const main = el('div', 'item-main');
      const title = el('div', 'item-title', r.owner || '（未分配）');
      main.appendChild(title);
      const meta = el('div', 'item-meta');
      meta.textContent = '客户 ' + r.total + ' · 在谈 ' + r.activeCount + ' · 成交 ' + r.wonCount +
        ' · 在谈预估 ' + money(r.expectedTotal) + ' · 累计成交 ' + money(r.wonTotal);
      main.appendChild(meta);
      line.appendChild(main);

      const side = el('div', 'item-side');
      // 该跟进却压着的数量——团队里最该被看到的一列
      const warn = el('div', 'item-meta',
        (r.overdueCount ? '逾期 ' + r.overdueCount + '　' : '') +
        (r.dueTodayCount ? '今天 ' + r.dueTodayCount + '　' : '') +
        (r.noNextCount ? '未安排 ' + r.noNextCount : ''));
      if (r.overdueCount) warn.style.color = 'var(--danger)';
      else if (r.dueTodayCount) warn.style.color = 'var(--warning)';
      side.appendChild(warn);

      if (r.owner) {
        const only = el('button', 'btn btn-sm', '只看他');
        only.addEventListener('click', function () { filterOwner = r.owner; render(); });
        side.appendChild(only);
      } else {
        const only = el('button', 'btn btn-sm', '只看未分配');
        only.addEventListener('click', function () { filterOwner = ''; render(); });
        side.appendChild(only);
      }
      line.appendChild(side);
      box.appendChild(line);
    });
    return box;
  }


  // ---------- 客户卡片（含可展开详情） ----------
  function customerCard(c, fus, now) {
    const card = el('div', 'card');
    card.style.marginBottom = '10px';

    const sum = CU.amountSummary(c);
    const head = el('div', 'panel-header');
    head.style.marginBottom = '8px';

    const left = el('div');
    left.style.flex = '1';
    const titleRow = el('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '8px';
    const name = el('div', 'item-title', c.name || '（未命名客户）');
    name.style.fontSize = '15px';
    titleRow.appendChild(name);
    titleRow.appendChild(stageBadge(c.stage));
    left.appendChild(titleRow);

    const meta = el('div', 'item-meta');
    const parts = [];
    if (c.contact) parts.push('联系人：' + c.contact);
    if (c.phone) parts.push(c.phone);
    if (c.owner) parts.push('负责人：' + c.owner);
    meta.textContent = parts.join(' · ') || '—';
    left.appendChild(meta);

    // 金额：未赢单显示预估；已赢单显示累计成交（含增购）
    const amountLine = el('div', 'item-meta');
    amountLine.style.marginTop = '4px';
    if (sum.hasDeal) {
      amountLine.textContent = '成交 ' + money(sum.won) + (sum.upsellTotal ? '（首单 ' + money(sum.deal) + ' + 增购 ' + money(sum.upsellTotal) + '）' : '');
      amountLine.style.color = 'var(--success)';
    } else if (sum.expected) {
      amountLine.textContent = '预估 ' + money(sum.expected) + '（未落单）';
      amountLine.style.color = 'var(--muted)';
    } else {
      amountLine.textContent = '金额待确认';
      amountLine.style.color = 'var(--muted)';
    }
    left.appendChild(amountLine);
    left.appendChild(followupHint(c, fus, now));
    head.appendChild(left);

    const actions = el('div', 'cal-nav');
    const fuBtn = el('button', 'btn btn-primary btn-sm', '记录跟进');
    fuBtn.addEventListener('click', function () { openFollowupForm(c); });
    const detailBtn = el('button', 'btn btn-sm', detailId === c.id ? '收起' : '详情');
    detailBtn.addEventListener('click', function () {
      detailId = (detailId === c.id) ? null : c.id;
      render();
    });
    actions.appendChild(fuBtn);
    actions.appendChild(detailBtn);
    head.appendChild(actions);
    card.appendChild(head);

    if (detailId === c.id) card.appendChild(detail(c, fus, now));
    return card;
  }

  // ---------- 客户详情（金额流水 + 跟进时间线 + 阶段操作） ----------
  function detail(c, fus, now) {
    const box = el('div');

    // 阶段推进
    const stageRow = el('div', 'toolbar');
    stageRow.appendChild(el('span', 'item-meta', '阶段：'));
    const stageSel = el('select');
    stageSel.style.width = '140px';
    C.CUSTOMER_STAGES.forEach(function (s) {
      const o = el('option'); o.value = s; o.textContent = C.CUSTOMER_STAGE_LABEL[s]; stageSel.appendChild(o);
    });
    stageSel.value = c.stage;
    stageSel.addEventListener('change', function () { onStageChange(c, stageSel.value); });
    stageRow.appendChild(stageSel);

    const editBtn = el('button', 'btn btn-sm', '编辑资料');
    editBtn.addEventListener('click', function () { openCustomerForm(c); });
    stageRow.appendChild(editBtn);

    const delBtn = el('button', 'btn btn-sm btn-danger', '删除客户');
    delBtn.addEventListener('click', function () {
      if (!confirm('删除客户「' + c.name + '」？其跟进记录与未完成的跟进待办将一并删除。')) return;
      detailId = null;
      Store.deleteCustomer(c.id);
      window.Toast.success('已删除');
    });
    stageRow.appendChild(delBtn);
    box.appendChild(stageRow);

    // 金额区块
    const sum = CU.amountSummary(c);
    box.appendChild(el('div', 'day-section-title', '金额'));
    const amtBox = el('div', 'item');
    const amtMain = el('div', 'item-main');
    const lines = [
      ['当前预估', money(sum.expected)],
      ['落单确认', sum.hasDeal ? money(sum.deal) : '未落单'],
      ['增购累计', money(sum.upsellTotal)],
      ['累计成交', money(sum.won)],
    ];
    lines.forEach(function (p) {
      const row = el('div', 'item-meta');
      row.textContent = p[0] + '：' + p[1];
      if (p[0] === '累计成交') { row.style.fontWeight = '600'; row.style.color = 'var(--success)'; }
      amtMain.appendChild(row);
    });
    amtBox.appendChild(amtMain);

    const amtBtns = el('div', 'item-side');
    const estBtn = el('button', 'btn btn-sm', '调整预估');
    estBtn.addEventListener('click', function () { openAmountForm(c, 'estimate'); });
    amtBtns.appendChild(estBtn);
    if (CU.canUpsell(c)) {
      const upBtn = el('button', 'btn btn-sm', '追加增购');
      upBtn.addEventListener('click', function () { openAmountForm(c, 'upsell'); });
      amtBtns.appendChild(upBtn);
    }
    amtBox.appendChild(amtBtns);
    box.appendChild(amtBox);

    // 金额流水（留痕）
    const hist = (c.amountHistory || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (hist.length) {
      const histBox = el('div');
      histBox.style.marginTop = '6px';
      hist.forEach(function (h) {
        const row = el('div', 'item-meta');
        row.textContent = Utils.toDateTimeStr(h.at) + ' · ' + (C.AMOUNT_KIND_LABEL[h.kind] || h.kind) +
          ' ' + money(h.amount) + (h.note ? '（' + h.note + '）' : '');
        histBox.appendChild(row);
      });
      box.appendChild(histBox);
    }

    // 该客户的「在办事项」：把客户与待办/日程连起来看，避免两边割裂
    box.appendChild(el('div', 'day-section-title', '关联事项'));
    box.appendChild(relatedSection(c));

    // 阶段停留时长（看卡在哪一段）
    const durs = CU.stageDurations(c, now);
    if (durs.length) {
      box.appendChild(el('div', 'day-section-title', '阶段进展'));
      durs.forEach(function (d) {
        box.appendChild(el('div', 'item-meta',
          d.label + '：' + Utils.toDateStr(d.at) + ' 起，停留约 ' + d.days + ' 天'));
      });
    }

    // 跟进时间线
    const list = (fus || []).filter(function (f) { return f.customerId === c.id; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    box.appendChild(el('div', 'day-section-title', '跟进记录（' + list.length + '）'));
    if (!list.length) {
      box.appendChild(el('div', 'placeholder', '还没有跟进记录，点上方「记录跟进」写第一次'));
    } else {
      list.forEach(function (f) {
        const row = el('div', 'item');
        const main = el('div', 'item-main');
        const t = el('div', 'item-title');
        t.textContent = (C.FOLLOWUP_METHOD_ICON[f.method] || '📝') + ' ' +
          (C.FOLLOWUP_METHOD_LABEL[f.method] || f.method) + ' · ' + Utils.toDateTimeStr(f.at);
        main.appendChild(t);
        if (f.content) main.appendChild(el('div', 'item-meta', f.content));
        if (f.nextAt != null) {
          const nx = el('div', 'item-meta', '下次跟进：' + Utils.toDateTimeStr(f.nextAt) + (f.nextPlan ? ' · ' + f.nextPlan : ''));
          nx.style.color = CU.isOverdue(f.nextAt, now) ? 'var(--danger)' : 'var(--muted)';
          main.appendChild(nx);
        }
        row.appendChild(main);
        const side = el('div', 'item-side');
        const delB = el('button', 'btn btn-sm btn-danger', '删除');
        delB.addEventListener('click', function () {
          if (!confirm('删除这条跟进记录？')) return;
          Store.deleteFollowup(f.id);
        });
        side.appendChild(delB);
        row.appendChild(side);
        box.appendChild(row);
      });
    }

    return box;
  }

  // ---------- 关联事项：该客户相关的待办与日程 ----------
  // 客户档案与实际要做的事（待办/时间块）过去在两个页面里各看各的，
  // 这里把它们聚到一个地方，并给出直达入口。
  function relatedSection(c) {
    const wrap = el('div');

    const todos = (Store.get().todos || []).filter(function (t) {
      return t && !t.deleted && t.customerId === c.id;
    });
    const openTodos = todos.filter(function (t) { return t.status !== 'done'; });
    const doneTodos = todos.filter(function (t) { return t.status === 'done'; });

    // 关联日程：待办「排到日程」后会写入 scheduledEventId
    const events = Store.get().events || [];
    const evById = {};
    events.forEach(function (e) { if (e && !e.deleted) evById[e.id] = e; });
    const linked = todos
      .map(function (t) { return { todo: t, ev: t.scheduledEventId ? evById[t.scheduledEventId] : null }; })
      .filter(function (p) { return !!p.ev; })
      .sort(function (a, b) { return (a.ev.start || 0) - (b.ev.start || 0); });

    if (!todos.length && !linked.length) {
      wrap.appendChild(el('div', 'placeholder', '这个客户还没有关联的待办，记录跟进后会自动生成'));
      return wrap;
    }

    // 待办
    if (openTodos.length) {
      openTodos.forEach(function (t) {
        const row = el('div', 'item');
        const main = el('div', 'item-main');
        const title = el('div', 'item-title', t.title || '（无标题待办）');
        main.appendChild(title);
        const meta = [];
        if (t.deadline != null) meta.push('截止 ' + Utils.toDateTimeStr(t.deadline));
        if (t.followupTag) meta.push('跟进动作');
        if (t.scheduledEventId && evById[t.scheduledEventId]) meta.push('已排到日程');
        if (meta.length) main.appendChild(el('div', 'item-meta', meta.join(' · ')));
        row.appendChild(main);
        const side = el('div', 'item-side');
        const goBtn = el('button', 'btn btn-sm', '去待办');
        goBtn.addEventListener('click', function () {
          if (window.App && window.App.switchView) window.App.switchView('todo');
        });
        side.appendChild(goBtn);
        row.appendChild(side);
        wrap.appendChild(row);
      });
    }

    // 已排到日程的时间块
    if (linked.length) {
      wrap.appendChild(el('div', 'item-meta', '已排到日程：'));
      linked.forEach(function (p) {
        const row = el('div', 'item-meta');
        row.textContent = '　· ' + Utils.toDateTimeStr(p.ev.start) + ' ' + (p.ev.title || '') +
          (p.todo.status === 'done' ? '（已完成）' : '');
        wrap.appendChild(row);
      });
    }

    if (doneTodos.length) {
      wrap.appendChild(el('div', 'item-meta', '已完成 ' + doneTodos.length + ' 条相关待办'));
    }
    return wrap;
  }

  // ---------- 阶段变更（赢单强制确认成交金额） ----------
  function onStageChange(c, stage) {
    if (stage === c.stage) return;
    if (stage === 'won') {
      const sum = CU.amountSummary(c);
      if (!sum.hasDeal) {
        // 未落单 → 强制填写成交金额（这就是「落单才确认」的机制化）
        openAmountForm(c, 'deal', function (amount, note) {
          Store.addCustomerAmount(c.id, { kind: 'deal', amount: amount, note: note });
          Store.updateCustomer(c.id, { stage: 'won' });
          window.Toast.success('已落单赢单，成交 ' + money(amount));
        });
        return;
      }
    }
    Store.updateCustomer(c.id, { stage: stage });
    window.Toast.success('阶段已更新为「' + (C.CUSTOMER_STAGE_LABEL[stage] || stage) + '」');
  }

  // ---------- 客户表单 ----------
  function openCustomerForm(c) {
    const body = el('div');
    const fName = field(body, '客户 / 公司名称', c ? c.name : '', 'text');
    const fContact = field(body, '联系人', c ? c.contact : '', 'text');
    const fPhone = field(body, '联系电话', c ? c.phone : '', 'text');
    const fOwner = field(body, '负责人', c ? c.owner : '', 'text');
    // 负责人是团队筛选/统计的维度，必须统一写法：给已有负责人做候选，
    // 避免同一个人被写成「李四 / 李四（销售）/ 李四L」导致统计被拆散
    const owners = CU.ownerList(Store.get().customers);
    if (owners.length) {
      fOwner.setAttribute('list', 'customer-owner-list');
      const dl = el('datalist');
      dl.id = 'customer-owner-list';
      owners.forEach(function (o) {
        const opt = el('option');
        opt.value = o;
        dl.appendChild(opt);
      });
      body.appendChild(dl);
    }
    const fRemark = field(body, '备注', c ? c.remark : '', 'textarea');

    window.Modal.open({
      title: c ? '编辑客户' : '新增客户',
      content: body,
      okText: '保存',
      onOk: function () {
        const name = fName.value.trim();
        if (!name) { window.Toast.error('请填写客户名称'); return false; }
        const patch = {
          name: name,
          contact: fContact.value.trim(),
          phone: fPhone.value.trim(),
          owner: fOwner.value.trim(),
          remark: fRemark.value.trim(),
        };
        if (c) Store.updateCustomer(c.id, patch);
        else Store.addCustomer(Object.assign({ id: Utils.genId() }, patch));
        window.Toast.success('已保存');
      },
    });
  }

  // ---------- 记录跟进（下次跟进时间必填 → 自动生成跟进待办） ----------
  function openFollowupForm(c) {
    const body = el('div');
    body.appendChild(el('div', 'form-hint', '客户：' + (c.name || '') + '（' + (C.CUSTOMER_STAGE_LABEL[c.stage] || '') + '）'));

    const methodRow = el('div', 'form-row');
    methodRow.appendChild(el('label', null, '跟进方式'));
    const methodSel = el('select');
    C.FOLLOWUP_METHODS.forEach(function (m) {
      const o = el('option'); o.value = m; o.textContent = (C.FOLLOWUP_METHOD_ICON[m] || '') + ' ' + C.FOLLOWUP_METHOD_LABEL[m];
      methodSel.appendChild(o);
    });
    methodRow.appendChild(methodSel);
    body.appendChild(methodRow);

    const contentRow = el('div', 'form-row');
    contentRow.appendChild(el('label', null, '本次跟进内容'));
    const content = el('textarea');
    content.rows = 3;
    contentRow.appendChild(content);
    body.appendChild(contentRow);

    // ★ 下次跟进时间（必填）
    body.appendChild(el('label', null, '下次跟进时间（必填）'));
    const nextGrid = el('div', 'form-grid');
    const nextDate = el('input'); nextDate.type = 'date';
    const nextTime = el('input'); nextTime.type = 'time';
    const def = Date.now() + 3 * DAY; // 默认 3 天后
    nextDate.value = Utils.toDateStr(def);
    nextTime.value = Utils.toTimeStr(def);
    nextGrid.appendChild(nextDate);
    nextGrid.appendChild(nextTime);
    body.appendChild(nextGrid);

    const planRow = el('div', 'form-row');
    planRow.style.marginTop = '10px';
    planRow.appendChild(el('label', null, '下次跟进计划'));
    const plan = el('textarea');
    plan.rows = 2;
    planRow.appendChild(plan);
    body.appendChild(planRow);

    body.appendChild(el('div', 'item-meta', '保存后会生成一条待办「跟进：…」，到点自动提醒，并进入今日规划。'));

    window.Modal.open({
      title: '记录跟进',
      content: body,
      okText: '保存并安排下次提醒',
      onOk: function () {
        if (!nextDate.value || !nextTime.value) {
          window.Toast.error('请填写下次跟进时间（这是不遗漏跟进的关键）');
          return false;
        }
        const nextAt = Utils.parseDateTime(nextDate.value, nextTime.value);
        const res = Store.recordFollowup(c.id, {
          method: methodSel.value,
          content: content.value.trim(),
          nextAt: nextAt,
          nextPlan: plan.value.trim(),
        });
        if (!res) { window.Toast.error('保存失败'); return false; }
        window.Toast.success('已记录，下次跟进 ' + Utils.toDateTimeStr(nextAt));
      },
    });
  }

  // ---------- 金额表单（调整预估 / 落单确认 / 追加增购） ----------
  function openAmountForm(c, kind, onDone) {
    const body = el('div');
    const isDeal = kind === 'deal';
    const isUpsell = kind === 'upsell';
    const sum = CU.amountSummary(c);

    const tips = {
      estimate: '调整预估金额（可多次调整，历史会保留；未落单前列表显示预估）',
      deal: '确认落单成交金额（仅此一次；之后如需增加请用「追加增购」）',
      upsell: '追加增购金额（会累加到该客户的累计成交额）',
    };
    body.appendChild(el('div', 'form-hint', tips[kind] || ''));
    if (isDeal) body.appendChild(el('div', 'item-meta', '当前预估：' + money(sum.expected)));
    if (isUpsell) body.appendChild(el('div', 'item-meta', '当前累计成交：' + money(sum.won)));

    const amtRow = el('div', 'form-row');
    amtRow.appendChild(el('label', null, isDeal ? '成交金额（元）' : '金额（元）'));
    const amt = el('input');
    amt.type = 'number';
    amt.min = '0';
    amt.step = '0.01';
    amt.value = isDeal ? (sum.expected || '') : '';
    amtRow.appendChild(amt);
    body.appendChild(amtRow);

    const noteRow = el('div', 'form-row');
    noteRow.appendChild(el('label', null, '备注（可选）'));
    const note = el('input');
    note.type = 'text';
    noteRow.appendChild(note);
    body.appendChild(noteRow);

    window.Modal.open({
      title: C.AMOUNT_KIND_LABEL[kind] || '金额',
      content: body,
      okText: '保存',
      onOk: function () {
        const v = Number(amt.value);
        if (!isFinite(v) || v < 0 || amt.value === '') { window.Toast.error('请填写有效金额'); return false; }
        if (onDone) {
          onDone(v, note.value.trim());
          return true;
        }
        const r = Store.addCustomerAmount(c.id, { kind: kind, amount: v, note: note.value.trim() });
        if (!r) {
          window.Toast.error(isUpsell ? '仅赢单后可追加增购' : '保存失败');
          return false;
        }
        window.Toast.success((C.AMOUNT_KIND_LABEL[kind] || '') + ' ' + money(v) + ' 已记录');
      },
    });
  }

  function field(parent, label, value, type) {
    const row = el('div', 'form-row');
    row.appendChild(el('label', null, label));
    let input;
    if (type === 'textarea') {
      input = el('textarea');
      input.rows = 2;
    } else {
      input = el('input');
      input.type = type || 'text';
    }
    input.value = value == null ? '' : value;
    row.appendChild(input);
    parent.appendChild(row);
    return input;
  }

  return { render: render };
})();
