/*
 * bookkeeping.js — 收支记账纯函数（2.3.0），主进程 / 渲染进程 / 单元测试共用。
 * UMD 包装：Node(CommonJS) 下 require 使用，浏览器下挂载到 window.Bookkeeping。
 * 金额一律整数「分」存储（避免浮点误差），显示层用 formatCents 转「元」字符串。
 *
 * 记账模型（账户维度单式，决策 #2）：
 *   - income/expense 只影响一个账户（accountId），不影响余额守恒。
 *   - transfer 从 accountId 转出、toAccountId 转入（同金额正数），信用卡还款即「银行 -> 信用卡」的转账。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Bookkeeping = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 分 -> 元字符串（"12.34"，负值带 "-"）
  function formatCents(cents) {
    const v = Math.round(Number(cents) || 0);
    const neg = v < 0;
    const abs = Math.abs(v);
    const y = Math.floor(abs / 100);
    const f = abs % 100;
    return (neg ? '-' : '') + y + '.' + (f < 10 ? '0' + f : '' + f);
  }

  // 元（数字或字符串）-> 分（四舍五入整数）；非法返回 null
  function yuanToCents(yuan) {
    const v = parseFloat(yuan);
    if (!isFinite(v)) return null;
    return Math.round(v * 100);
  }

  // 单条流水对某账户余额的净影响（正=流入，负=流出）
  function txnFlow(txn, accountId) {
    if (!txn || txn.deleted || !accountId) return 0;
    const amt = Number(txn.amount) || 0;
    if (txn.type === 'income') return txn.accountId === accountId ? amt : 0;
    if (txn.type === 'expense') return txn.accountId === accountId ? -amt : 0;
    if (txn.type === 'transfer') {
      if (txn.accountId === accountId) return -amt;
      if (txn.toAccountId === accountId) return amt;
      return 0;
    }
    return 0;
  }

  // 账户余额 = 初始余额 + 全部流水净额
  function accountBalance(account, transactions) {
    const initial = Number(account && account.initialBalance) || 0;
    let net = 0;
    (transactions || []).forEach(function (t) { net += txnFlow(t, account && account.id); });
    return initial + net;
  }

  // 流水日期 -> 毫秒时间戳（统一类型后再比较）
  //
  // 为什么必须归一化：界面写入的 date 是**数字时间戳**（Utils.parseDateTime），
  // 但导入的旧数据 / 手改的 JSON 里的 date 可能是 'YYYY-MM-DD' 字符串。
  // 数字与字符串用 < / >= 比较时，JS 会把字符串转成 NaN，比较结果恒为 false，
  // 于是同一批数据在不同代码路径上结论相反 —— 表现为「本月合计里有钱，
  // 明细列表却是空的」。所以这里统一转成时间戳再比。
  // 无法解析时返回 null（该条不参与区间判定，而不是悄悄被算进某个区间）。
  function txnTime(date) {
    if (date == null || date === '') return null;
    if (typeof date === 'number') return isFinite(date) ? date : null;
    if (typeof date === 'string') {
      const s = date.trim();
      if (!s) return null;
      // 纯数字字符串按时间戳处理
      if (/^\d+$/.test(s)) return Number(s);
      // 'YYYY-MM-DD' / 'YYYY/MM/DD' / 'YYYY-MM-DD HH:mm(:ss)' / ISO
      const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
          Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
        const t = d.getTime();
        return isFinite(t) ? t : null;
      }
      const t = new Date(s).getTime();
      return isFinite(t) ? t : null;
    }
    return null;
  }

  // 是否落在 [from, to) 区间内（from 含、to 不含）。from/to 可以是时间戳或日期字符串。
  function inRange(date, from, to) {
    const t = txnTime(date);
    if (t == null) return false;
    const f = txnTime(from);
    const e = txnTime(to);
    if (f != null && t < f) return false;
    if (e != null && t >= e) return false;
    return true;
  }

  // 区间收支汇总（含 from，不含 to；transfer 不计入收支，仅影响账户余额）
  function monthlySummary(transactions, from, to) {
    let income = 0, expense = 0;
    (transactions || []).forEach(function (t) {
      if (!t || t.deleted) return;
      if (!inRange(t.date, from, to)) return;
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') income += amt;
      else if (t.type === 'expense') expense += amt;
    });
    return { income: income, expense: expense, net: income - expense };
  }

  // 分类汇总（收入/支出分开），返回按金额降序的 [{categoryId,name,color,type,amount}]
  function categoryBreakdown(transactions, categories, from, to) {
    const agg = {};
    (transactions || []).forEach(function (t) {
      if (!t || t.deleted) return;
      if (t.type !== 'income' && t.type !== 'expense') return;
      if (!t.categoryId) return;
      if (!inRange(t.date, from, to)) return;
      const key = t.categoryId + '|' + t.type;
      if (!agg[key]) agg[key] = { categoryId: t.categoryId, type: t.type, amount: 0 };
      agg[key].amount += Number(t.amount) || 0;
    });
    const catById = {};
    (categories || []).forEach(function (c) { catById[c.id] = c; });
    return Object.keys(agg).map(function (k) {
      const c = catById[agg[k].categoryId] || {};
      return { categoryId: agg[k].categoryId, name: c.name || '未分类', color: c.color || '#8a8f98', type: agg[k].type, amount: agg[k].amount };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  // 预算状态：每项预算 { budget, spent, remaining, ratio(0..+), over }；categoryId 为空 = 总预算
  function budgetStatus(budgets, transactions, from, to) {
    const spentByCat = {};
    let uncategorized = 0;
    (transactions || []).forEach(function (t) {
      if (!t || t.deleted || t.type !== 'expense') return;
      if (!inRange(t.date, from, to)) return;
      const amt = Number(t.amount) || 0;
      if (t.categoryId) spentByCat[t.categoryId] = (spentByCat[t.categoryId] || 0) + amt;
      else uncategorized += amt;
    });
    return (budgets || []).filter(function (b) { return b && !b.deleted; }).map(function (b) {
      let spent = 0;
      if (b.categoryId) spent = spentByCat[b.categoryId] || 0;
      else {
        Object.keys(spentByCat).forEach(function (k) { spent += spentByCat[k]; });
        spent += uncategorized;
      }
      const amount = Number(b.amount) || 0;
      const remaining = amount - spent;
      return {
        budget: b,
        spent: spent,
        remaining: remaining,
        ratio: amount > 0 ? spent / amount : 0,
        over: remaining < 0,
      };
    });
  }

  // 构建转账流水（含信用卡还款：从银行卡/现金转到信用卡账户）
  function buildTransfer(fromAccountId, toAccountId, amount, date, note) {
    return {
      type: 'transfer',
      amount: Number(amount) || 0,
      accountId: fromAccountId,
      toAccountId: toAccountId,
      categoryId: null,
      date: date,
      note: note || '',
    };
  }

  return {
    formatCents: formatCents,
    yuanToCents: yuanToCents,
    txnFlow: txnFlow,
    accountBalance: accountBalance,
    txnTime: txnTime,
    inRange: inRange,
    monthlySummary: monthlySummary,
    categoryBreakdown: categoryBreakdown,
    budgetStatus: budgetStatus,
    buildTransfer: buildTransfer,
  };
}));
