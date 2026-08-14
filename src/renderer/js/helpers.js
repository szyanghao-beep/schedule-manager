/*
 * helpers.js — 渲染层共享小工具：表单控件构建、分类查找、徽标、重复规则解析、月份加减。
 */
window.Helpers = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;

  // 构建 select，labels 可为对象或函数
  function select(options, labels, selected) {
    const s = el('select');
    options.forEach(function (o) {
      const opt = el('option');
      opt.value = o;
      opt.textContent = typeof labels === 'function' ? labels(o) : (labels ? labels[o] : o);
      s.appendChild(opt);
    });
    s.value = selected == null ? '' : selected;
    return s;
  }

  // 分类下拉（含「未分类」空选项）
  function categorySelect(currentId) {
    const s = el('select');
    const none = el('option');
    none.value = ''; none.textContent = '未分类';
    s.appendChild(none);
    Store.get().categories.forEach(function (c) {
      const opt = el('option');
      opt.value = c.id; opt.textContent = c.name;
      s.appendChild(opt);
    });
    s.value = currentId || '';
    return s;
  }

  function categoryOf(id) {
    const c = Store.get().categories.find(function (x) { return x.id === id; });
    return c || { name: '未分类', color: '#8a8f98' };
  }

  // 由表单数据构建重复规则
  function buildRepeat(d) {
    if (!d.repeatType || d.repeatType === 'none') return { type: 'none', interval: 1, endDate: null };
    return {
      type: d.repeatType,
      interval: d.repeatType === 'custom' ? (Number(d.repeatInterval) || 1) : 1,
      endDate: d.repeatEndDate ? window.Utils.parseDateTime(d.repeatEndDate, '00:00') : null,
    };
  }

  // 状态/优先级徽标
  function badge(kind, value) {
    const maps = {
      priority: { low: 'badge-low', medium: 'badge-medium', high: 'badge-high' },
      status: { pending: 'badge-pending', doing: 'badge-doing', done: 'badge-done', overdue: 'badge-overdue' },
    };
    const label = kind === 'priority' ? C.PRIORITY_LABEL[value] : C.STATUS_LABEL[value];
    return el('span', 'badge ' + (maps[kind][value] || 'badge-pending'), label || value);
  }

  // 月份加减（保留原始日，溢出钳制月末）
  function addMonths(ts, n) {
    const d = new Date(ts);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d.getTime();
  }

  return {
    select: select,
    categorySelect: categorySelect,
    categoryOf: categoryOf,
    buildRepeat: buildRepeat,
    badge: badge,
    addMonths: addMonths,
  };
})();
