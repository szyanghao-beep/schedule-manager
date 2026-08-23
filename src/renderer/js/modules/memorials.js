/*
 * memorials.js — 纪念日模块（2.3.0）：生日 / 纪念日 / 其他，支持公历与农历（含闰月），
 * 按「下一次发生日期」倒计时，并可提前 N 天提醒（主进程 checkMemorialReminders 负责弹通知）。
 */
window.Modules = window.Modules || {};
window.Modules.memorials = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const H = window.Helpers;
  const Utils = window.Utils;
  const LunarUtil = window.LunarUtil || null;

  function render() {
    const root = document.getElementById('view-memorials');
    clear(root);

    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '纪念日'));
    const addBtn = el('button', 'btn btn-primary', '+ 新增纪念日');
    addBtn.addEventListener('click', function () { openForm(null); });
    header.appendChild(addBtn);
    root.appendChild(header);

    const list = el('div');
    const items = Store.get().memorials.slice().sort(function (a, b) {
      const oa = nextOcc(a), ob = nextOcc(b);
      return (oa ? oa.ts : Number.MAX_SAFE_INTEGER) - (ob ? ob.ts : Number.MAX_SAFE_INTEGER);
    });
    items.forEach(function (m) { list.appendChild(row(m)); });
    if (!items.length) list.appendChild(el('div', 'placeholder', '暂无纪念日，点右上角「+ 新增纪念日」添加'));
    root.appendChild(list);
  }

  function nextOcc(m) {
    return LunarUtil ? LunarUtil.nextMemorialOccurrence(m, Date.now()) : null;
  }

  function kindColor(kind) {
    if (kind === 'birthday') return '#e05b5b';
    if (kind === 'anniversary') return '#8e6fd8';
    return '#4f8ef7';
  }

  function row(m) {
    const row = el('div', 'item');
    const dot = el('span', 'dot');
    dot.style.background = kindColor(m.kind);
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', m.name));
    main.appendChild(el('div', 'item-meta', describe(m)));
    row.appendChild(dot);
    row.appendChild(main);
    const editBtn = el('button', 'btn btn-sm', '编辑');
    editBtn.addEventListener('click', function () { openForm(m); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('删除纪念日「' + m.name + '」？')) return;
      Store.deleteMemorial(m.id);
      window.Toast.success('已删除');
    });
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    row.addEventListener('dblclick', function () { openForm(m); });
    return row;
  }

  // 描述：类型 · 日期 · 倒计时/年龄 · 提醒
  function describe(m) {
    const kind = C.MEMORIAL_KIND_LABEL[m.kind] || '纪念日';
    const parts = [kind, dateLabel(m)];
    const occ = nextOcc(m);
    if (occ && LunarUtil) {
      const remain = LunarUtil.countdownDays(occ.ts, Date.now());
      if (remain === 0) parts.push('就在今天');
      else parts.push('还有 ' + remain + ' 天');
      if (occ.age != null) parts.push(occ.age + ' 岁');
    }
    const before = Number(m.remindBeforeDays);
    if (isFinite(before) && before > 0) parts.push('提前 ' + before + ' 天提醒');
    return parts.join(' · ');
  }

  // 日期展示：公历「公历 5月27日」；农历「农历 五月初四」（闰月带「闰」前缀）
  function dateLabel(m) {
    const mth = Number(m.month);
    const day = Number(m.day);
    if (m.calendar === 'lunar') {
      if (!LunarUtil) return '农历 ' + Math.abs(mth) + '月' + day + '日';
      return '农历 ' + LunarUtil.lunarMonthCn(mth) + LunarUtil.lunarDayCn(day);
    }
    return '公历 ' + mth + '月' + day + '日';
  }

  function openForm(m) {
    const body = el('div');

    const nameRow = el('div', 'form-row');
    nameRow.appendChild(el('label', null, '名称'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.dataset.field = 'name';
    nameInput.value = m ? m.name : '';
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    const kindRow = el('div', 'form-row');
    kindRow.appendChild(el('label', null, '类型'));
    const kindSel = H.select(C.MEMORIAL_KINDS, C.MEMORIAL_KIND_LABEL, m ? m.kind : 'birthday');
    kindSel.dataset.field = 'kind';
    kindRow.appendChild(kindSel);
    body.appendChild(kindRow);

    const calRow = el('div', 'form-row');
    calRow.appendChild(el('label', null, '历法'));
    const calSel = H.select(['solar', 'lunar'], { solar: '公历', lunar: '农历' }, m ? (m.calendar || 'solar') : 'solar');
    calSel.dataset.field = 'calendar';
    calRow.appendChild(calSel);
    body.appendChild(calRow);

    const dateRow = el('div', 'form-row');
    dateRow.appendChild(el('label', null, '日期'));
    const grid = el('div', 'form-grid');
    const monthInput = el('input');
    monthInput.type = 'number'; monthInput.min = 1; monthInput.max = 12; monthInput.placeholder = '月';
    monthInput.dataset.field = 'month';
    monthInput.value = m ? Math.abs(Number(m.month) || 1) : '';
    const dayInput = el('input');
    dayInput.type = 'number'; dayInput.min = 1; dayInput.max = 31; dayInput.placeholder = '日';
    dayInput.dataset.field = 'day';
    dayInput.value = m ? (Number(m.day) || '') : '';
    const yearInput = el('input');
    yearInput.type = 'number'; yearInput.min = 1900; yearInput.max = 2100; yearInput.placeholder = '年（可选，算年龄）';
    yearInput.dataset.field = 'year';
    yearInput.value = m && m.year ? m.year : '';
    grid.appendChild(monthInput);
    grid.appendChild(dayInput);
    grid.appendChild(yearInput);
    dateRow.appendChild(grid);
    body.appendChild(dateRow);

    const leapRow = el('div', 'form-row');
    leapRow.appendChild(el('label', null, '闰月（仅农历）'));
    const leapInput = el('input');
    leapInput.type = 'checkbox';
    leapInput.dataset.field = 'isLeap';
    leapInput.checked = !!(m && Number(m.month) < 0);
    leapRow.appendChild(leapInput);
    body.appendChild(leapRow);
    leapRow.style.display = calSel.value === 'lunar' ? '' : 'none';
    calSel.addEventListener('change', function () {
      leapRow.style.display = calSel.value === 'lunar' ? '' : 'none';
    });

    const remindRow = el('div', 'form-row');
    remindRow.appendChild(el('label', null, '提前提醒（0 = 不提醒）'));
    const remindSel = el('select');
    remindSel.dataset.field = 'remindBeforeDays';
    [0, 1, 3, 7, 14, 30].forEach(function (n) {
      const o = el('option');
      o.value = n;
      o.textContent = n === 0 ? '不提醒' : n + ' 天前';
      remindSel.appendChild(o);
    });
    remindSel.value = m && m.remindBeforeDays != null ? m.remindBeforeDays : 7;
    remindRow.appendChild(remindSel);
    body.appendChild(remindRow);

    const noteRow = el('div', 'form-row');
    noteRow.appendChild(el('label', null, '备注'));
    const noteInput = el('textarea');
    noteInput.rows = 2;
    noteInput.dataset.field = 'note';
    noteInput.value = m ? (m.note || '') : '';
    noteRow.appendChild(noteInput);
    body.appendChild(noteRow);

    window.Modal.open({
      title: m ? '编辑纪念日' : '新增纪念日',
      content: body,
      okText: '保存',
      onOk: function () {
        const d = window.Dom.readForm(body);
        const month = Number(d.month);
        const day = Number(d.day);
        if (!month || !day) { window.Toast.error('请填写月份和日期'); return false; }
        const cal = d.calendar === 'lunar' ? 'lunar' : 'solar';
        if (month < 1 || month > 12) { window.Toast.error('月份需在 1-12 之间'); return false; }
        if (cal === 'lunar') {
          if (day < 1 || day > 30) { window.Toast.error('农历日期需在 1-30 之间'); return false; }
        } else if (day < 1 || day > 31) {
          window.Toast.error('日期需在 1-31 之间'); return false;
        }
        const storedMonth = (cal === 'lunar' && d.isLeap) ? -month : month;
        const input = {
          name: d.name.trim(),
          kind: d.kind,
          calendar: cal,
          month: storedMonth,
          day: day,
          year: d.year ? Number(d.year) : null,
          remindBeforeDays: Number(d.remindBeforeDays) || 0,
          note: d.note.trim(),
        };
        if (!input.name) { window.Toast.error('名称不能为空'); return false; }
        if (m) {
          Store.updateMemorial(m.id, input);
        } else {
          Store.addMemorial(Object.assign({ id: Utils.genId(), createdAt: Date.now(), updatedAt: Date.now() }, input));
        }
        window.Toast.success('已保存');
      },
    });
  }

  return { render: render };
})();
