/*
 * customer.js — 客户商机跟进纯函数（桌面端 / 手机端 / 测试共用）
 *
 * 设计要点：
 *   1. 金额是一条「流水」而非单一字段：预估可反复调整、落单一次性确认、赢单后可多次增购；
 *      当前值由流水实时派生（expected / deal / upsellTotal / won），不落库、不会不一致。
 *   2. 阶段流转留痕（stageHistory），可回溯何时进入哪个阶段、每段停留多久。
 *   3. 跟进动作不另起炉灶 —— 由本模块生成一条普通「待办」（deadline = 下次跟进时间），
 *      从而直接复用现有的提醒、四象限、今日规划、时间块、周回顾等全部能力。
 *
 * UMD：Node(CommonJS) 下 require（主进程/测试/手机端），浏览器下挂载到 window.CustomerUtil
 * （渲染层用 preload 注入的 window.api.constants 作为常量来源）。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./constants.js'));
  } else {
    root.CustomerUtil = factory(root.api.constants);
  }
}(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const { CUSTOMER_STAGES, CUSTOMER_CLOSED_STAGES, AMOUNT_KIND, FOLLOWUP_TODO_MINUTES } = C;

// ---------- 金额流水 ----------
// 派生当前金额视图：预估取最新一条；成交 = 落单 + 增购累计
function amountSummary(customer) {
  const hist = (customer && Array.isArray(customer.amountHistory)) ? customer.amountHistory : [];
  const sorted = hist.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });

  let expected = 0, deal = 0, upsellTotal = 0, hasDeal = false;
  let lastEstimateAt = 0, dealAt = 0;

  sorted.forEach(function (h) {
    const amt = Number(h && h.amount) || 0;
    if (h.kind === AMOUNT_KIND.ESTIMATE) {
      expected = amt;
      lastEstimateAt = h.at || 0;
    } else if (h.kind === AMOUNT_KIND.DEAL) {
      deal = amt;
      hasDeal = true;
      dealAt = h.at || 0;
    } else if (h.kind === AMOUNT_KIND.UPSELL) {
      upsellTotal += amt;
    }
  });

  return {
    expected: expected,           // 当前预估（未赢单时列表显示这个）
    deal: deal,                   // 首单成交
    upsellTotal: upsellTotal,     // 增购累计
    won: deal + upsellTotal,      // 累计成交额
    hasDeal: hasDeal,
    lastEstimateAt: lastEstimateAt,
    dealAt: dealAt,
  };
}

// 追加一条金额流水（返回新客户对象，不修改入参）
function addAmount(customer, entry) {
  const e = entry || {};
  const amt = Number(e.amount);
  if (!isFinite(amt) || amt < 0) return customer;

  const kinds = [AMOUNT_KIND.ESTIMATE, AMOUNT_KIND.DEAL, AMOUNT_KIND.UPSELL];
  if (kinds.indexOf(e.kind) < 0) return customer; // 只接受 预估/落单/增购 三种

  const hist = Array.isArray(customer.amountHistory) ? customer.amountHistory : [];
  // 业务约束：落单只确认一次（后续追加走「增购」）
  if (e.kind === AMOUNT_KIND.DEAL && hist.some(function (h) { return h.kind === AMOUNT_KIND.DEAL; })) {
    return customer;
  }

  const ts = e.at || Date.now();
  const rec = {
    id: e.id || ('amt-' + ts + '-' + Math.random().toString(36).slice(2, 8)),
    at: ts,
    kind: e.kind,
    amount: amt,
    note: e.note ? String(e.note).slice(0, 200) : '',
  };
  const out = Object.assign({}, customer);
  out.amountHistory = hist.slice().concat([rec]);
  out.updatedAt = ts;
  return out;
}

// 已赢单才允许增购
function canUpsell(customer) {
  return !!customer && customer.stage === 'won';
}

// ---------- 阶段流转 ----------
function stageLabel(stage) { return C.CUSTOMER_STAGE_LABEL[stage] || stage || ''; }

// 变更阶段并留痕（返回新对象）
function changeStage(customer, stage, at) {
  if (CUSTOMER_STAGES.indexOf(stage) < 0) return customer;
  if (customer.stage === stage) return customer;
  const ts = at || Date.now();
  const out = Object.assign({}, customer);
  out.stage = stage;
  out.stageHistory = (Array.isArray(customer.stageHistory) ? customer.stageHistory.slice() : [])
    .concat([{ stage: stage, at: ts }]);
  out.updatedAt = ts;
  // 进入终态时记录时间，便于统计转化周期
  if (stage === 'won') out.wonAt = ts;
  if (stage === 'lost') out.lostAt = ts;
  return out;
}

// 阶段停留时长（天），用于看「卡在哪一段」
function stageDurations(customer, now) {
  const hist = (customer && Array.isArray(customer.stageHistory)) ? customer.stageHistory : [];
  if (!hist.length) return [];
  const end = now || Date.now();
  const DAY = 86400000;
  return hist.map(function (h, i) {
    const nextAt = (i + 1 < hist.length) ? hist[i + 1].at : end;
    return {
      stage: h.stage,
      label: stageLabel(h.stage),
      at: h.at,
      days: Math.max(0, Math.round(((nextAt - h.at) / DAY) * 10) / 10),
    };
  });
}

// ---------- 跟进 ----------
// 某客户「下次跟进时间」：取最新一条跟进记录的 nextAt
function nextFollowupAt(customer, followups) {
  const list = (followups || []).filter(function (f) {
    return f && !f.deleted && f.customerId === (customer && customer.id);
  });
  if (!list.length) return null;
  const latest = list.reduce(function (a, b) { return (a.at || 0) >= (b.at || 0) ? a : b; }, list[0]);
  return latest.nextAt != null ? latest.nextAt : null;
}

function isOverdue(ts, now) {
  if (ts == null) return false;
  return ts < (now || Date.now());
}

// 是否已赢单/输单（终态）
function isClosed(customer) {
  return !!customer && CUSTOMER_CLOSED_STAGES.indexOf(customer.stage) >= 0;
}

// 生成「跟进待办」—— 复用待办的全部能力（提醒/四象限/今日规划/时间块/周回顾）
function buildFollowupTodo(customer, followup, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const fu = followup || {};
  return {
    id: opts.id || ('fu-' + customer.id + '-' + (fu.id || now)),
    title: '跟进：' + (customer.name || '客户') + '（' + stageLabel(customer.stage) + '）',
    description: fu.nextPlan ? String(fu.nextPlan).slice(0, 500) : '',
    deadline: fu.nextAt != null ? fu.nextAt : null,
    status: 'pending',
    priority: 'high',
    categoryId: '',
    categoryName: '客户跟进',
    categoryColor: '#4f8ef7',
    importance: 'important',
    repeat: { type: 'none', interval: 1, endDate: null },
    remindBefore: (opts.remindBefore != null) ? opts.remindBefore : 15,
    estimatedMinutes: FOLLOWUP_TODO_MINUTES,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    localModifiedAt: now,
    customerId: customer.id,   // 关联客户
    followupId: fu.id || '',
    followupTag: true,         // 标记为「跟进动作」
  };
}

// ---------- 列表与统计 ----------
// 排序：推进中的在前；再按下次跟进时间升序（超期自然排最前）；无时间的排后
function sortCustomers(customers, followups, now) {
  return (customers || []).slice().sort(function (a, b) {
    const ac = isClosed(a), bc = isClosed(b);
    if (ac !== bc) return ac ? 1 : -1;
    const an = nextFollowupAt(a, followups);
    const bn = nextFollowupAt(b, followups);
    if (an == null && bn == null) return (b.updatedAt || 0) - (a.updatedAt || 0);
    if (an == null) return 1;
    if (bn == null) return -1;
    return an - bn;
  });
}

function groupByStage(customers) {
  const out = {};
  CUSTOMER_STAGES.forEach(function (s) { out[s] = []; });
  (customers || []).forEach(function (c) {
    if (out[c.stage]) out[c.stage].push(c);
  });
  return out;
}

// 汇总：各阶段数量/预估金额、成交汇总（漏斗与业绩两套口径分开）
function summarize(customers) {
  const byStage = {};
  CUSTOMER_STAGES.forEach(function (s) { byStage[s] = { count: 0, expected: 0, won: 0 }; });
  let activeCount = 0, wonCount = 0, lostCount = 0;
  let expectedTotal = 0, wonTotal = 0, upsellTotal = 0;

  (customers || []).forEach(function (c) {
    const sum = amountSummary(c);
    const s = byStage[c.stage] || (byStage[c.stage] = { count: 0, expected: 0, won: 0 });
    s.count++;
    s.expected += sum.expected;
    s.won += sum.won;

    if (isClosed(c)) {
      if (c.stage === 'won') { wonCount++; wonTotal += sum.won; upsellTotal += sum.upsellTotal; }
      else lostCount++;
    } else {
      activeCount++;
      expectedTotal += sum.expected; // 漏斗口径：只看未成交的预估
    }
  });

  return {
    byStage: byStage,
    activeCount: activeCount,
    wonCount: wonCount,
    lostCount: lostCount,
    expectedTotal: expectedTotal, // 在谈盘子（预估）
    wonTotal: wonTotal,           // 累计成交（业绩）
    upsellTotal: upsellTotal,
  };
}

  return {
    amountSummary: amountSummary,
    addAmount: addAmount,
    canUpsell: canUpsell,
    changeStage: changeStage,
    stageDurations: stageDurations,
    stageLabel: stageLabel,
    nextFollowupAt: nextFollowupAt,
    isOverdue: isOverdue,
    isClosed: isClosed,
    buildFollowupTodo: buildFollowupTodo,
    sortCustomers: sortCustomers,
    groupByStage: groupByStage,
    summarize: summarize,
  };
}));
