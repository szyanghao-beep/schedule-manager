/*
 * bookkeeping.js — 记账模块（2.3.0）：多账户单式记账，四个子页：明细 / 账户 / 报表 / 预算。
 * 金额整数「分」存储，显示用 shared/bookkeeping.js 的 formatCents 转元。
 * 转账 / 信用卡还款为「转出账户 -> 转入账户」的特殊流水（B6）。
 */
window.Modules = window.Modules || {};
window.Modules.bookkeeping = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const H = window.Helpers;
  const Utils = window.Utils;
  const BK = window.Bookkeeping || null;

  let tab = 'detail'; // detail | accounts | reports | budgets
  let monthAnchor = Date.now();

  function render() {
    const root = document.getElementById('view-bookkeeping');
    clear(root);
    root.appendChild(toolbar());
    if (tab === 'detail') root.appendChild(renderDetail());
    else if (tab === 'accounts') root.appendChild(renderAccounts());
    else if (tab === 'reports') root.appendChild(renderReports());
    else root.appendChild(renderBudgets());
  }

  // ---------- 通用 ----------
  function monthRange() {
    const from = Utils.startOfMonth(monthAnchor);
    const to = Utils.startOfMonth(H.addMonths(from, 1));
    return { from: from, to: to };
  }

  function monthTitle() {
    const d = new Date(monthAnchor);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  }

  function accountName(id) {
    const a = Store.get().accounts.find(function (x) { return x.id === id; });
    return a ? a.name : '已删除账户';
  }

  function bookCategory(id) {
    const c = Store.get().bookkeepingCategories.find(function (x) { return x.id === id; });
    return c || { name: '未分类', color: '#8a8f98', type: '' };
  }

  function summaryItem(label, value) {
    const it = el('div', 'plan-summary-item');
    it.appendChild(el('div', 'plan-summary-label', label));
    it.appendChild(el('div', 'plan-summary-value', String(value)));
    return it;
  }

  function toolbar() {
    const bar = el('div', 'cal-toolbar');
    const left = el('div', 'cal-nav');
    if (tab !== 'accounts') {
      const prev = el('button', 'btn btn-sm', '‹');
      prev.title = '上一月';
      prev.addEventListener('click', function () { monthAnchor = H.addMonths(monthAnchor, -1); render(); });
      const next = el('button', 'btn btn-sm', '›');
      next.title = '下一月';
      next.addEventListener('click', function () { monthAnchor = H.addMonths(monthAnchor, 1); render(); });
      left.appendChild(prev);
      left.appendChild(next);
      left.appendChild(el('span', 'cal-title', monthTitle()));
    }
    bar.appendChild(left);

    const right = el('div', 'cal-nav');
    const seg = el('div', 'seg');
    [['detail', '明细'], ['accounts', '账户'], ['reports', '报表'], ['budgets', '预算']].forEach(function (p) {
      const b = el('button', 'seg-btn' + (tab === p[0] ? ' active' : ''), p[1]);
      b.addEventListener('click', function () { tab = p[0]; render(); });
      seg.appendChild(b);
    });
    right.appendChild(seg);
    if (tab === 'detail') {
      const addBtn = el('button', 'btn btn-primary', '+ 记一笔');
      addBtn.addEventListener('click', function () { openTxnForm(null); });
      right.appendChild(addBtn);
    } else if (tab === 'accounts') {
      const addBtn = el('button', 'btn btn-primary', '+ 新增账户');
      addBtn.addEventListener('click', function () { openAccountForm(null); });
      right.appendChild(addBtn);
    }
    bar.appendChild(right);
    return bar;
  }

  // ---------- 明细 ----------
  function renderDetail() {
    const wrap = el('div');
    const state = Store.get();
    const r = monthRange();
    const summary = BK.monthlySummary(state.transactions, r.from, r.to);

    const sumCard = el('div', 'plan-summary');
    sumCard.appendChild(summaryItem('收入', '+' + BK.formatCents(summary.income)));
    sumCard.appendChild(summaryItem('支出', '-' + BK.formatCents(summary.expense)));
    sumCard.appendChild(summaryItem('结余', BK.formatCents(summary.net)));
    wrap.appendChild(sumCard);

    const list = el('div');
    const txns = state.transactions
      .filter(function (t) { return t.date >= r.from && t.date < r.to; })
      .sort(function (a, b) { return b.date - a.date || b.updatedAt - a.updatedAt; });
    txns.forEach(function (t) { list.appendChild(txnRow(t)); });
    if (!txns.length) list.appendChild(el('div', 'placeholder', '本月暂无流水，点右上角「+ 记一笔」'));
    wrap.appendChild(list);
    return wrap;
  }

  function txnColor(t) {
    if (t.type === 'income') return '#4caf7d';
    if (t.type === 'expense') return '#e05b5b';
    return '#4f8ef7'; // transfer
  }

  function txnTitle(t) {
    if (t.type === 'transfer') return '转账 · ' + accountName(t.accountId) + ' → ' + accountName(t.toAccountId);
    const cat = bookCategory(t.categoryId);
    return (cat.name || (t.type === 'income' ? '收入' : '支出')) + (t.note ? ' · ' + t.note : '');
  }

  function txnMeta(t) {
    return Utils.toDateStr(t.date) + ' · ' + accountName(t.accountId);
  }

  function txnAmountText(t) {
    if (t.type === 'income') return '+' + BK.formatCents(t.amount);
    if (t.type === 'expense') return '-' + BK.formatCents(t.amount);
    return BK.formatCents(t.amount);
  }

  function txnRow(t) {
    const row = el('div', 'item');
    const dot = el('span', 'dot');
    dot.style.background = txnColor(t);
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', txnTitle(t)));
    main.appendChild(el('div', 'item-meta', txnMeta(t)));
    const amt = el('div', 'item-amount', txnAmountText(t));
    amt.style.color = txnColor(t);
    row.appendChild(dot);
    row.appendChild(main);
    row.appendChild(amt);
    row.addEventListener('dblclick', function () { openTxnForm(t); });
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      window.ContextMenu.show(e.clientX, e.clientY, [
        { label: '编辑', onClick: function () { openTxnForm(t); } },
        '-',
        { label: '删除', danger: true, onClick: function () {
          if (!confirm('删除这笔流水？')) return;
          Store.deleteTransaction(t.id); window.Toast.success('已删除');
        } },
      ]);
    });
    return row;
  }

  // ---------- 流水表单（收入/支出/转账） ----------
  function accountSelect(currentId) {
    const s = el('select');
    Store.get().accounts.forEach(function (a) {
      const o = el('option');
      o.value = a.id;
      o.textContent = (C.ACCOUNT_ICON[a.type] || '🏷️') + ' ' + a.name;
      s.appendChild(o);
    });
    s.value = currentId || '';
    return s;
  }

  function fillCategorySelect(sel, type) {
    clear(sel);
    const none = el('option');
    none.value = ''; none.textContent = '未分类';
    sel.appendChild(none);
    Store.get().bookkeepingCategories.filter(function (c) { return c.type === type; }).forEach(function (c) {
      const o = el('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    sel.value = '';
  }

  function defaultAccountId() {
    const s = Store.get().settings.bookkeeping || {};
    if (s.defaultAccountId && Store.get().accounts.some(function (a) { return a.id === s.defaultAccountId; })) return s.defaultAccountId;
    return Store.get().accounts[0] ? Store.get().accounts[0].id : '';
  }

  function openTxnForm(t, opts) {
    opts = opts || {};
    const state = Store.get();
    if (!state.accounts.length) { window.Toast.error('请先到「账户」页创建账户'); return; }
    const initialType = t ? t.type : (opts.type || 'expense');

    const body = el('div');

    const typeRow = el('div', 'form-row');
    typeRow.appendChild(el('label', null, '类型'));
    const typeSel = H.select(C.TXN_TYPES, C.TXN_TYPE_LABEL, initialType);
    typeSel.dataset.field = 'type';
    typeRow.appendChild(typeSel);
    body.appendChild(typeRow);

    const amtRow = el('div', 'form-row');
    amtRow.appendChild(el('label', null, '金额（元）'));
    const amtInput = el('input');
    amtInput.type = 'number'; amtInput.min = 0; amtInput.step = '0.01'; amtInput.placeholder = '0.00';
    amtInput.dataset.field = 'amountYuan';
    amtInput.value = t ? BK.formatCents(t.amount) : '';
    amtRow.appendChild(amtInput);
    body.appendChild(amtRow);

    const acctRow = el('div', 'form-row');
    acctRow.appendChild(el('label', null, '账户'));
    const acctSel = accountSelect(t ? t.accountId : defaultAccountId());
    acctSel.dataset.field = 'accountId';
    acctRow.appendChild(acctSel);
    body.appendChild(acctRow);

    const toAcctRow = el('div', 'form-row');
    toAcctRow.appendChild(el('label', null, '转入账户'));
    const toAcctSel = accountSelect(t ? t.toAccountId : '');
    toAcctSel.dataset.field = 'toAccountId';
    toAcctRow.appendChild(toAcctSel);
    body.appendChild(toAcctRow);

    const catRow = el('div', 'form-row');
    catRow.appendChild(el('label', null, '分类'));
    const catSel = el('select');
    catSel.dataset.field = 'categoryId';
    fillCategorySelect(catSel, initialType === 'transfer' ? 'expense' : initialType);
    if (t && t.categoryId) catSel.value = t.categoryId;
    catRow.appendChild(catSel);
    body.appendChild(catRow);

    const dateRow = el('div', 'form-row');
    dateRow.appendChild(el('label', null, '日期'));
    const dateInput = el('input');
    dateInput.type = 'date';
    dateInput.dataset.field = 'date';
    dateInput.value = t ? Utils.toDateStr(t.date) : Utils.toDateStr(Date.now());
    dateRow.appendChild(dateInput);
    body.appendChild(dateRow);

    const noteRow = el('div', 'form-row');
    noteRow.appendChild(el('label', null, '备注'));
    const noteInput = el('input');
    noteInput.type = 'text';
    noteInput.dataset.field = 'note';
    noteInput.value = t ? (t.note || '') : '';
    noteRow.appendChild(noteInput);
    body.appendChild(noteRow);

    function sync() {
      const isTransfer = typeSel.value === 'transfer';
      toAcctRow.style.display = isTransfer ? '' : 'none';
      catRow.style.display = isTransfer ? 'none' : '';
    }
    typeSel.addEventListener('change', function () {
      sync();
      if (typeSel.value !== 'transfer') fillCategorySelect(catSel, typeSel.value);
    });
    sync();

    window.Modal.open({
      title: t ? '编辑流水' : (initialType === 'transfer' ? '转账 / 信用卡还款' : '记一笔'),
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const cents = BK.yuanToCents(d.amountYuan);
        if (cents == null || cents <= 0) { window.Toast.error('请输入正确的金额'); return false; }
        const type = d.type;
        if (!d.accountId) { window.Toast.error('请选择账户'); return false; }
        if (type === 'transfer' && !d.toAccountId) { window.Toast.error('请选择转入账户'); return false; }
        if (type === 'transfer' && d.accountId === d.toAccountId) { window.Toast.error('转入账户不能与转出账户相同'); return false; }
        const input = {
          type: type,
          amount: cents,
          accountId: d.accountId,
          toAccountId: type === 'transfer' ? d.toAccountId : null,
          categoryId: type === 'transfer' ? null : (d.categoryId || null),
          date: d.date ? Utils.parseDateTime(d.date, '00:00') : Date.now(),
          note: d.note.trim(),
        };
        if (t) Store.updateTransaction(t.id, input);
        else Store.addTransaction(Object.assign({ id: Utils.genId(), createdAt: Date.now(), updatedAt: Date.now() }, input));
        if (type === 'expense') warnOverBudget(input.categoryId);
        window.Toast.success('已保存');
      },
    });
  }

  // 超支预警（B4）：新增支出后检查相关预算是否超支
  function warnOverBudget(categoryId) {
    const state = Store.get();
    const r = monthRange();
    const over = BK.budgetStatus(state.budgets, state.transactions, r.from, r.to).find(function (bs) {
      return bs.over && (!bs.budget.categoryId || bs.budget.categoryId === categoryId);
    });
    if (over) {
      const name = over.budget.categoryId ? bookCategory(over.budget.categoryId).name : '总预算';
      window.Toast.warning('预算超支：「' + name + '」已超支 ' + BK.formatCents(Math.abs(over.remaining)) + ' 元');
    }
  }

  // ---------- 账户 ----------
  function renderAccounts() {
    const wrap = el('div');
    const state = Store.get();

    const acctCard = el('div', 'card');
    acctCard.appendChild(el('div', 'panel-title', '账户'));
    const acctList = el('div');
    state.accounts.forEach(function (a) { acctList.appendChild(accountRow(a)); });
    if (!state.accounts.length) acctList.appendChild(el('div', 'placeholder', '暂无账户，点右上角「+ 新增账户」添加'));
    acctCard.appendChild(acctList);
    wrap.appendChild(acctCard);

    // 转账 / 信用卡还款快捷入口
    if (state.accounts.length >= 2) {
      const tCard = el('div', 'card');
      tCard.style.marginTop = '16px';
      tCard.appendChild(el('div', 'panel-title', '转账 / 信用卡还款'));
      const hint = el('div', 'item-meta', '转账 = 从转出账户划转到转入账户；信用卡还款 = 从银行卡/现金转到信用卡账户。');
      hint.style.margin = '8px 0';
      tCard.appendChild(hint);
      const btnRow = el('div', 'toolbar');
      const transferBtn = el('button', 'btn btn-sm', '转账');
      transferBtn.addEventListener('click', function () { openTxnForm(null, { type: 'transfer' }); });
      const repayBtn = el('button', 'btn btn-sm', '信用卡还款');
      repayBtn.addEventListener('click', function () { openTxnForm(null, { type: 'transfer' }); });
      btnRow.appendChild(transferBtn);
      btnRow.appendChild(repayBtn);
      tCard.appendChild(btnRow);
      wrap.appendChild(tCard);
    }

    wrap.appendChild(categoryManagerCard());
    return wrap;
  }

  function accountRow(a) {
    const row = el('div', 'item');
    const dot = el('span', 'dot');
    dot.style.background = a.color || '#4f8ef7';
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', (C.ACCOUNT_ICON[a.type] || '🏷️') + ' ' + a.name + (a.isArchived ? '（已归档）' : '')));
    const bal = BK.accountBalance(a, Store.get().transactions);
    main.appendChild(el('div', 'item-meta', C.ACCOUNT_TYPE_LABEL[a.type] + ' · 余额 ' + BK.formatCents(bal) + ' 元'));
    row.appendChild(dot);
    row.appendChild(main);
    const archiveBtn = el('button', 'btn btn-sm', a.isArchived ? '取消归档' : '归档');
    archiveBtn.addEventListener('click', function () {
      Store.updateAccount(a.id, { isArchived: !a.isArchived });
      window.Toast.success(a.isArchived ? '已取消归档' : '已归档');
    });
    const editBtn = el('button', 'btn btn-sm', '编辑');
    editBtn.addEventListener('click', function () { openAccountForm(a); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('删除账户「' + a.name + '」？其流水将保留但不再归属账户。')) return;
      Store.deleteAccount(a.id);
      window.Toast.success('已删除');
    });
    row.appendChild(archiveBtn);
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    return row;
  }

  function openAccountForm(a) {
    const body = el('div');
    const nameRow = el('div', 'form-row');
    nameRow.appendChild(el('label', null, '账户名称'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.dataset.field = 'name';
    nameInput.value = a ? a.name : '';
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    const typeRow = el('div', 'form-row');
    typeRow.appendChild(el('label', null, '账户类型'));
    const typeSel = H.select(C.ACCOUNT_TYPES, C.ACCOUNT_TYPE_LABEL, a ? a.type : 'cash');
    typeSel.dataset.field = 'type';
    typeRow.appendChild(typeSel);
    body.appendChild(typeRow);

    const balRow = el('div', 'form-row');
    balRow.appendChild(el('label', null, '初始余额（元）'));
    const balInput = el('input');
    balInput.type = 'number'; balInput.step = '0.01'; balInput.placeholder = '0.00';
    balInput.dataset.field = 'initialYuan';
    balInput.value = a ? BK.formatCents(a.initialBalance) : '0.00';
    balRow.appendChild(balInput);
    body.appendChild(balRow);

    const colorRow = el('div', 'form-row');
    colorRow.appendChild(el('label', null, '颜色'));
    const swatches = el('div', 'color-swatches');
    let selected = a ? (a.color || C.CATEGORY_COLORS[0]) : C.CATEGORY_COLORS[0];
    C.CATEGORY_COLORS.forEach(function (color) {
      const sw = el('div', 'swatch' + (color === selected ? ' selected' : ''));
      sw.style.background = color;
      sw.addEventListener('click', function () {
        swatches.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        selected = color;
      });
      swatches.appendChild(sw);
    });
    colorRow.appendChild(swatches);
    body.appendChild(colorRow);

    window.Modal.open({
      title: a ? '编辑账户' : '新增账户',
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const name = d.name.trim();
        if (!name) { window.Toast.error('账户名称不能为空'); return false; }
        const initialBalance = BK.yuanToCents(d.initialYuan);
        if (initialBalance == null) { window.Toast.error('请输入正确的初始余额'); return false; }
        const input = {
          name: name, type: d.type, initialBalance: initialBalance,
          currency: 'CNY', color: selected, icon: C.ACCOUNT_ICON[d.type],
        };
        if (a) {
          Store.updateAccount(a.id, input);
        } else {
          const id = Utils.genId();
          Store.addAccount(Object.assign({ id: id, isArchived: false, sortOrder: 0, createdAt: Date.now(), updatedAt: Date.now() }, input));
          // 首个账户设为默认
          const bk = Store.get().settings.bookkeeping || {};
          if (!bk.defaultAccountId) Store.set({ settings: Object.assign({}, Store.get().settings, { bookkeeping: Object.assign({}, bk, { defaultAccountId: id }) }) });
        }
        window.Toast.success('已保存');
      },
    });
  }

  // ---------- 记账分类 ----------
  function categoryManagerCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '记账分类'));
    const addBtn = el('button', 'btn btn-primary btn-sm', '+ 新增分类');
    addBtn.addEventListener('click', function () { openBookCategoryForm(null); });
    header.appendChild(addBtn);
    card.appendChild(header);

    const cats = Store.get().bookkeepingCategories;
    if (!cats.length) {
      const initBtn = el('button', 'btn btn-sm', '初始化默认分类');
      initBtn.style.margin = '8px 0';
      initBtn.addEventListener('click', initDefaultCategories);
      card.appendChild(initBtn);
    }
    const list = el('div');
    cats.forEach(function (c) { list.appendChild(bookCategoryRow(c)); });
    if (!cats.length) list.appendChild(el('div', 'placeholder', '暂无记账分类，可初始化默认或新增'));
    card.appendChild(list);
    return card;
  }

  function initDefaultCategories() {
    C.BOOKKEEPING_DEFAULT_CATEGORIES.forEach(function (c) {
      Store.addBookkeepingCategory({
        id: Utils.genId(), name: c.name, type: c.type, color: c.color,
        parentId: null, isDefault: true, sortOrder: 0, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    window.Toast.success('已初始化默认分类');
  }

  function bookCategoryRow(c) {
    const row = el('div', 'item');
    const dot = el('span', 'dot');
    dot.style.background = c.color;
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', c.name + (c.isDefault ? '（默认）' : '')));
    main.appendChild(el('div', 'item-meta', C.TXN_TYPE_LABEL[c.type]));
    row.appendChild(dot);
    row.appendChild(main);
    const editBtn = el('button', 'btn btn-sm', '编辑');
    editBtn.addEventListener('click', function () { openBookCategoryForm(c); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('删除分类「' + c.name + '」？关联流水将归为未分类。')) return;
      Store.deleteBookkeepingCategory(c.id);
      window.Toast.success('已删除');
    });
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    return row;
  }

  function openBookCategoryForm(c) {
    const body = el('div');
    const nameRow = el('div', 'form-row');
    nameRow.appendChild(el('label', null, '分类名称'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.dataset.field = 'name';
    nameInput.value = c ? c.name : '';
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    const typeRow = el('div', 'form-row');
    typeRow.appendChild(el('label', null, '收支类型'));
    const typeSel = H.select(['expense', 'income'], { expense: '支出', income: '收入' }, c ? c.type : 'expense');
    typeSel.dataset.field = 'type';
    typeRow.appendChild(typeSel);
    body.appendChild(typeRow);

    const colorRow = el('div', 'form-row');
    colorRow.appendChild(el('label', null, '颜色'));
    const swatches = el('div', 'color-swatches');
    let selected = c ? (c.color || C.CATEGORY_COLORS[0]) : C.CATEGORY_COLORS[0];
    C.CATEGORY_COLORS.forEach(function (color) {
      const sw = el('div', 'swatch' + (color === selected ? ' selected' : ''));
      sw.style.background = color;
      sw.addEventListener('click', function () {
        swatches.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        selected = color;
      });
      swatches.appendChild(sw);
    });
    colorRow.appendChild(swatches);
    body.appendChild(colorRow);

    window.Modal.open({
      title: c ? '编辑分类' : '新增分类',
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const name = d.name.trim();
        if (!name) { window.Toast.error('分类名称不能为空'); return false; }
        const input = { name: name, type: d.type, color: selected };
        if (c) {
          Store.updateBookkeepingCategory(c.id, input);
        } else {
          Store.addBookkeepingCategory(Object.assign({ id: Utils.genId(), parentId: null, isDefault: false, sortOrder: 0, createdAt: Date.now(), updatedAt: Date.now() }, input));
        }
        window.Toast.success('已保存');
      },
    });
  }

  // ---------- 报表 ----------
  function renderReports() {
    const wrap = el('div');
    const state = Store.get();
    const r = monthRange();
    const summary = BK.monthlySummary(state.transactions, r.from, r.to);
    const rate = summary.income > 0 ? Math.round(summary.net / summary.income * 100) : 0;

    // 结余率
    const rateCard = el('div', 'plan-summary');
    rateCard.appendChild(summaryItem('本月结余率', rate + '%'));
    rateCard.appendChild(summaryItem('本月收入', BK.formatCents(summary.income)));
    rateCard.appendChild(summaryItem('本月支出', BK.formatCents(summary.expense)));
    wrap.appendChild(rateCard);

    // 分类支出构成
    const expenseBreakdown = BK.categoryBreakdown(state.transactions, state.bookkeepingCategories, r.from, r.to)
      .filter(function (b) { return b.type === 'expense'; });
    wrap.appendChild(breakdownCard(expenseBreakdown, summary.expense, '分类支出构成'));

    // 近 6 个月趋势
    wrap.appendChild(trendCard(state));

    // 消费日历
    wrap.appendChild(consumptionCard(state, r.from, r.to));
    return wrap;
  }

  function donutGradient(breakdown, total) {
    if (!total || !breakdown.length) return 'conic-gradient(#eee 0 100%)';
    let acc = 0;
    const stops = [];
    breakdown.forEach(function (b) {
      const s = (acc / total * 100).toFixed(2);
      acc += b.amount;
      const e = (acc / total * 100).toFixed(2);
      stops.push(b.color + ' ' + s + '% ' + e + '%');
    });
    return 'conic-gradient(' + stops.join(', ') + ')';
  }

  function breakdownCard(breakdown, total, title) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', title));
    const row = el('div', 'bk-donut-row');

    const donut = el('div', 'bk-donut');
    donut.style.background = donutGradient(breakdown, total);
    const hole = el('div', 'bk-donut-hole', total > 0 ? BK.formatCents(total) : '0');
    donut.appendChild(hole);
    row.appendChild(donut);

    const legend = el('div', 'bk-legend');
    if (!breakdown.length) legend.appendChild(el('div', 'placeholder', '本月暂无支出'));
    breakdown.forEach(function (b) {
      const pct = total > 0 ? Math.round(b.amount / total * 100) : 0;
      const item = el('div', 'bk-legend-item');
      const dot = el('span', 'dot');
      dot.style.background = b.color;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(b.name + ' ' + BK.formatCents(b.amount) + '（' + pct + '%）'));
      legend.appendChild(item);
    });
    row.appendChild(legend);
    card.appendChild(row);
    return card;
  }

  function trendCard(state) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '近 6 个月收支趋势'));

    const rows = [];
    let maxAmt = 0;
    for (let i = 5; i >= 0; i--) {
      const mts = H.addMonths(monthAnchor, -i);
      const from = Utils.startOfMonth(mts);
      const to = Utils.startOfMonth(H.addMonths(from, 1));
      const s = BK.monthlySummary(state.transactions, from, to);
      rows.push({ label: (new Date(from).getFullYear() % 100) + '/' + (new Date(from).getMonth() + 1), income: s.income, expense: s.expense });
      maxAmt = Math.max(maxAmt, s.income, s.expense);
    }
    rows.forEach(function (r) {
      const line = el('div', 'bk-bar-row');
      line.appendChild(el('div', 'bk-bar-label', r.label));
      const incBar = el('div', 'bk-bar bk-bar-income');
      incBar.style.width = (maxAmt ? Math.max(2, Math.round(r.income / maxAmt * 100)) : 0) + '%';
      const expBar = el('div', 'bk-bar bk-bar-expense');
      expBar.style.width = (maxAmt ? Math.max(2, Math.round(r.expense / maxAmt * 100)) : 0) + '%';
      line.appendChild(incBar);
      line.appendChild(expBar);
      line.appendChild(el('div', 'bk-bar-val', '收 ' + BK.formatCents(r.income) + ' / 支 ' + BK.formatCents(r.expense)));
      card.appendChild(line);
    });
    return card;
  }

  function consumptionCard(state, from, to) {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '消费日历'));
    const daily = {};
    state.transactions.forEach(function (t) {
      if (t.deleted || t.type !== 'expense') return;
      if (t.date < from || t.date >= to) return;
      const k = Utils.toDateStr(t.date);
      daily[k] = (daily[k] || 0) + Number(t.amount) || 0;
    });
    const vals = Object.keys(daily).map(function (k) { return daily[k]; });
    const max = vals.length ? Math.max.apply(null, vals) : 0;

    const grid = el('div', 'bk-cal');
    const first = new Date(from);
    const startWeekday = (first.getDay() + 6) % 7; // 周一=0
    for (let i = 0; i < startWeekday; i++) grid.appendChild(el('div', 'bk-cal-cell empty'));
    const daysInMonth = Math.round((to - from) / 86400000);
    for (let d = 1; d <= daysInMonth; d++) {
      const ts = from + (d - 1) * 86400000;
      const k = Utils.toDateStr(ts);
      const amt = daily[k] || 0;
      const cell = el('div', 'bk-cal-cell');
      cell.appendChild(el('div', 'bk-cal-day', String(d)));
      if (amt > 0) cell.appendChild(el('div', 'bk-cal-amt', BK.formatCents(amt)));
      if (amt > 0 && max > 0) {
        cell.style.background = 'rgba(224,91,91,' + (0.12 + 0.78 * (amt / max)).toFixed(2) + ')';
      }
      grid.appendChild(cell);
    }
    card.appendChild(grid);
    return card;
  }

  // ---------- 预算 ----------
  function renderBudgets() {
    const wrap = el('div');
    const state = Store.get();
    const r = monthRange();
    const statuses = BK.budgetStatus(state.budgets, state.transactions, r.from, r.to);

    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '预算（' + monthTitle() + '）'));
    const addBtn = el('button', 'btn btn-primary', '+ 新增预算');
    addBtn.addEventListener('click', function () { openBudgetForm(null); });
    header.appendChild(addBtn);
    wrap.appendChild(header);

    const list = el('div');
    statuses.forEach(function (bs) { list.appendChild(budgetRow(bs)); });
    if (!statuses.length) list.appendChild(el('div', 'placeholder', '暂无预算，可为「总预算」或某分类设置月度限额'));
    wrap.appendChild(list);
    return wrap;
  }

  function budgetRow(bs) {
    const b = bs.budget;
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    const label = b.categoryId ? bookCategory(b.categoryId).name : '总预算';
    main.appendChild(el('div', 'item-title', label + (bs.over ? '（已超支）' : '')));
    const pct = Math.min(100, Math.round(bs.ratio * 100));
    main.appendChild(el('div', 'item-meta', '已用 ' + BK.formatCents(bs.spent) + ' / ' + BK.formatCents(b.amount) + ' · 剩余 ' + BK.formatCents(bs.remaining)));
    const bar = el('div', 'bk-budget-bar');
    const fill = el('div', 'bk-budget-fill' + (bs.over ? ' over' : ''));
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
    row.appendChild(main);
    const editBtn = el('button', 'btn btn-sm', '编辑');
    editBtn.addEventListener('click', function () { openBudgetForm(b); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('删除该预算？')) return;
      Store.deleteBudget(b.id);
      window.Toast.success('已删除');
    });
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    return row;
  }

  function openBudgetForm(b) {
    const body = el('div');
    const catRow = el('div', 'form-row');
    catRow.appendChild(el('label', null, '预算对象'));
    const catSel = el('select');
    catSel.dataset.field = 'categoryId';
    const none = el('option');
    none.value = ''; none.textContent = '总预算（全部支出）';
    catSel.appendChild(none);
    Store.get().bookkeepingCategories.filter(function (c) { return c.type === 'expense'; }).forEach(function (c) {
      const o = el('option');
      o.value = c.id; o.textContent = c.name;
      catSel.appendChild(o);
    });
    catSel.value = b ? (b.categoryId || '') : '';
    catRow.appendChild(catSel);
    body.appendChild(catRow);

    const amtRow = el('div', 'form-row');
    amtRow.appendChild(el('label', null, '月度限额（元）'));
    const amtInput = el('input');
    amtInput.type = 'number'; amtInput.min = 0; amtInput.step = '0.01'; amtInput.placeholder = '0.00';
    amtInput.dataset.field = 'amountYuan';
    amtInput.value = b ? BK.formatCents(b.amount) : '';
    amtRow.appendChild(amtInput);
    body.appendChild(amtRow);

    window.Modal.open({
      title: b ? '编辑预算' : '新增预算',
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const cents = BK.yuanToCents(d.amountYuan);
        if (cents == null || cents <= 0) { window.Toast.error('请输入正确的预算金额'); return false; }
        const input = { categoryId: d.categoryId || null, period: 'monthly', amount: cents };
        if (b) Store.updateBudget(b.id, input);
        else Store.addBudget(Object.assign({ id: Utils.genId(), createdAt: Date.now(), updatedAt: Date.now() }, input));
        window.Toast.success('已保存');
      },
    });
  }

  return { render: render };
})();
