/*
 * inbox.js — 收件箱（GTD Inbox）。
 * 「未整理」= 未完成且没有截止时间的待办（想法先丢进来，之后再处理）。
 * 提供快速捕捉（全局快捷键 Ctrl+Shift+N 或界面按钮），以及整理/排程/完成/删除操作。
 */
window.Modules = window.Modules || {};
window.Modules.inbox = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const L = window.LinkUtil;

  // 批量整理用的选中集合（手机一次收集几十条时，逐条整理是最大的痛点）
  let selected = {};

  function inboxTodos() {
    return L.inboxTodos(Store.get().todos);
  }

  function render() {
    const root = document.getElementById('view-inbox');
    clear(root);
    const items = inboxTodos();

    // 清理已不在收件箱里的选中项（被整理/完成后不应再算作已选）
    const aliveIds = {};
    items.forEach(function (t) { aliveIds[t.id] = true; });
    Object.keys(selected).forEach(function (id) { if (!aliveIds[id]) delete selected[id]; });

    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '收件箱（未整理）'));
    const btns = el('div', 'cal-nav');
    const captureBtn = el('button', 'btn btn-primary', '⚡ 快速捕捉');
    captureBtn.addEventListener('click', openQuickCapture);
    btns.appendChild(captureBtn);
    header.appendChild(btns);
    root.appendChild(header);

    const hint = el('div', 'item-meta', 'GTD：把想法先丢进来，之后在这里「整理」——补截止时间、预估耗时，或直接排到日程。全局快捷键 Ctrl+Shift+N 可随时捕捉。');
    hint.style.marginBottom = '12px';
    root.appendChild(hint);

    // 来源说明：手机收集的条目会被标出来，避免「不知道这条哪来的」
    const mobileCount = items.filter(function (t) { return L.sourceLabel(t); }).length;
    if (mobileCount) {
      const srcLine = el('div', 'item-meta', '其中 ' + mobileCount + ' 条来自手机「收集」直传');
      srcLine.style.marginBottom = '8px';
      srcLine.style.color = 'var(--primary)';
      root.appendChild(srcLine);
    }

    if (items.length) root.appendChild(selectBar(items));
    if (Object.keys(selected).length > 0) root.appendChild(batchBar());

    const list = el('div');
    if (!items.length) list.appendChild(el('div', 'placeholder', '收件箱是空的，按 Ctrl+Shift+N 快速捕捉一条想法'));
    items.forEach(function (t) { list.appendChild(inboxRow(t)); });
    root.appendChild(list);
  }

  // 全选 / 反选
  function selectBar(items) {
    const bar = el('div', 'toolbar');
    const allSelected = items.every(function (t) { return selected[t.id]; });
    const btn = el('button', 'btn btn-sm', allSelected ? '取消全选' : '全选（' + items.length + '）');
    btn.addEventListener('click', function () {
      if (allSelected) selected = {};
      else items.forEach(function (t) { selected[t.id] = true; });
      render();
    });
    bar.appendChild(btn);
    return bar;
  }

  // 批量整理：一次给多条定截止时间 / 完成 / 删除，不用逐条开弹窗
  function batchBar() {
    const ids = Object.keys(selected);
    const bar = el('div', 'toolbar');
    bar.appendChild(el('span', 'item-meta', '已选 ' + ids.length + ' 条：'));

    function setDeadlineAt(ts, label) {
      // 先清选中再写库：Store 变更为同步触发重绘，顺序反了会残留一帧「已选 N 条」
      selected = {};
      ids.forEach(function (id) {
        // 给了截止时间就自动离开收件箱 —— 这正是「整理」的本质动作
        Store.updateTodo(id, { deadline: ts });
      });
      window.Toast.success('已把 ' + ids.length + ' 条设为' + label);
    }

    const todayBtn = el('button', 'btn btn-sm btn-primary', '设为今天');
    todayBtn.title = '截止时间设为今天 23:59，并移出收件箱';
    todayBtn.addEventListener('click', function () {
      const d = new Date();
      setDeadlineAt(window.Utils.parseDateTime(window.Utils.toDateStr(d.getTime()), '23:59'), '今天截止');
    });
    const tomorrowBtn = el('button', 'btn btn-sm', '设为明天');
    tomorrowBtn.addEventListener('click', function () {
      const d = new Date(Date.now() + 86400000);
      setDeadlineAt(window.Utils.parseDateTime(window.Utils.toDateStr(d.getTime()), '23:59'), '明天截止');
    });
    const doneBtn = el('button', 'btn btn-sm', '标为已完成');
    doneBtn.addEventListener('click', function () {
      selected = {};
      Store.updateTodos(ids, { status: 'done', completedAt: Date.now() });
      window.Toast.success('已标记 ' + ids.length + ' 条完成');
    });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('确定删除选中的 ' + ids.length + ' 条？')) return;
      selected = {};
      Store.deleteTodos(ids);
      window.Toast.success('已删除');
    });

    bar.appendChild(todayBtn);
    bar.appendChild(tomorrowBtn);
    bar.appendChild(doneBtn);
    bar.appendChild(delBtn);
    return bar;
  }

  function inboxRow(t) {
    const row = el('div', 'item');

    // 批量整理用的勾选框
    const sel = el('input', 'item-check');
    sel.type = 'checkbox';
    sel.checked = !!selected[t.id];
    sel.title = '选择（用于批量整理）';
    sel.addEventListener('change', function () {
      if (sel.checked) selected[t.id] = true; else delete selected[t.id];
      render();
    });

    const main = el('div', 'item-main');
    const title = el('div', 'item-title');
    const dot = el('span', 'dot');
    dot.style.background = t.categoryColor || '#8a8f98';
    title.appendChild(dot);
    title.appendChild(document.createTextNode(t.title));
    // 来源徽标：手机收集来的要能一眼认出（也解释了为什么这条没截止时间）
    const src = L.sourceLabel(t);
    if (src) {
      const b = el('span', 'badge', src);
      b.style.marginLeft = '8px';
      b.style.background = 'var(--primary)';
      b.style.color = '#fff';
      title.appendChild(b);
    }
    main.appendChild(title);
    const meta = el('div', 'item-meta');
    const parts = ['捕捉于 ' + (t.createdAt ? window.Utils.toDateTimeStr(t.createdAt) : '—')];
    if (t.description) parts.push(t.description);
    meta.textContent = parts.join(' · ');
    main.appendChild(meta);

    const side = el('div', 'item-side');
    const editBtn = el('button', 'btn btn-sm', '整理');
    editBtn.title = '补充截止时间、预估耗时等信息';
    editBtn.addEventListener('click', function () { window.Modules.todo.openTodoForm(t); });
    const schedBtn = el('button', 'btn btn-sm', '排到日程');
    schedBtn.addEventListener('click', function () { window.Modules.todo.scheduleTodo(t); });
    const doneBtn = el('button', 'btn btn-sm', '完成');
    doneBtn.addEventListener('click', function () { window.Modules.todo.toggle(t); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () { Store.deleteTodo(t.id); window.Toast.success('已删除'); });
    side.appendChild(editBtn);
    side.appendChild(schedBtn);
    side.appendChild(doneBtn);
    side.appendChild(delBtn);

    row.appendChild(sel);
    row.appendChild(main);
    row.appendChild(side);
    row.addEventListener('dblclick', function () { window.Modules.todo.openTodoForm(t); });
    return row;
  }

  // 由解析出的分类名查找分类（未命中/空 -> 未分类）
  function categoryInfo(name) {
    const c = name ? Store.get().categories.find(function (x) { return x.name === name; }) : null;
    return c ? { id: c.id, name: c.name, color: c.color } : { id: '', name: '未分类', color: '#8a8f98' };
  }

  // 由解析结果构造待办 / 日程记录（不静默改数据，仅返回结构，由确认时入库）
  function buildCapture(res, fallbackTitle) {
    const cat = categoryInfo(res.categoryName);
    const title = (res.title && res.title.trim()) ? res.title.trim() : fallbackTitle;
    const priority = res.priority || 'medium';
    const reminds = (res.remindBefore != null && res.remindBefore > 0) ? [res.remindBefore] : [];
    const remindBefore = reminds.length ? Math.min.apply(null, reminds) : 0;

    if (res.kind === 'event' && res.startTime != null) {
      let startTime = res.startTime;
      let endTime = res.endTime;
      if (res.allDay) {
        startTime = window.Utils.startOfDay(startTime);
        endTime = startTime + 24 * 3600 * 1000 - 1;
      } else if (endTime == null || endTime <= startTime) {
        endTime = startTime + 60 * 60000; // 兜底：无时长时默认 1 小时
      }
      return {
        type: 'event',
        record: {
          id: window.Utils.genId(), status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
          title: title, description: '', allDay: !!res.allDay,
          startTime: startTime, endTime: endTime, priority: priority,
          categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color,
          repeat: { type: 'none', interval: 1, endDate: null }, reminds: reminds, remindBefore: remindBefore, remindAt: null,
        },
      };
    }

    const est = res.estimatedMinutes;
    const estimatedMinutes = (est && est >= 1 && est <= 1440) ? Math.round(est) : null;
    return {
      type: 'todo',
      record: {
        id: window.Utils.genId(), status: 'pending', completedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
        title: title, description: '', deadline: res.deadline,
        priority: priority, categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color,
        importance: res.importance || 'important', repeat: { type: 'none', interval: 1, endDate: null },
        reminds: reminds, remindBefore: remindBefore, remindAt: null, estimatedMinutes: estimatedMinutes,
      },
    };
  }

  // 快速捕捉：输入自然语言 → 实时预览解析结果（规则优先，AI 兜底）→ 确认后入库
  function openQuickCapture() {
    const body = el('div');

    const titleRow = el('div', 'form-row');
    titleRow.appendChild(el('label', null, '捕捉内容（自然语言）'));
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.dataset.field = 'captureText';
    titleInput.placeholder = '如：明天下午3点开会2小时 #工作 提前30分钟提醒';
    titleRow.appendChild(titleInput);
    body.appendChild(titleRow);

    const hint = el('div', 'item-meta', '支持日期、时间、优先级、#分类、提前提醒、预估耗时；未识别的直接入收件箱。AI 兜底需在设置中开启。');
    hint.style.marginBottom = '10px';
    body.appendChild(hint);

    const preview = el('div', 'quick-preview');
    body.appendChild(preview);

    const names = Store.get().categories.map(function (c) { return c.name; });
    let currentResult = window.Nlp.parse('', { categories: names });
    let aiTimer = null;
    let aiEnhanced = false;

    function fmt(ts) { return ts != null ? window.Utils.toDateTimeStr(ts) : null; }

    function renderPreview(res) {
      clear(preview);
      const head = el('div', 'quick-preview-title', '解析预览' + (aiEnhanced ? ' · AI 增强' : ' · 规则'));
      preview.appendChild(head);

      const title = (res.title && res.title.trim()) ? res.title.trim() : res.raw;
      const lines = [['标题', title], ['类型', res.kind === 'event' ? '日程' : '待办']];
      if (res.kind === 'event') {
        lines.push(['开始', fmt(res.startTime)]);
        lines.push(['结束', fmt(res.endTime)]);
      } else if (res.deadline != null) {
        lines.push(['截止', fmt(res.deadline)]);
      } else {
        lines.push(['截止', '未识别（入收件箱）']);
      }
      if (res.priority) lines.push(['优先级', C.PRIORITY_LABEL[res.priority] || res.priority]);
      if (res.importance) lines.push(['重要性', C.IMPORTANCE_LABEL[res.importance] || res.importance]);
      if (res.categoryName) lines.push(['分类', res.categoryName]);
      if (res.remindBefore != null && res.remindBefore > 0) lines.push(['提醒', window.Utils.formatRemind(res.remindBefore)]);
      if (res.kind === 'todo' && res.estimatedMinutes != null) lines.push(['预估耗时', res.estimatedMinutes + ' 分钟']);

      const table = el('div', 'quick-preview-table');
      lines.forEach(function (pair) {
        const row = el('div', 'quick-preview-row');
        row.appendChild(el('span', 'quick-preview-key', pair[0]));
        row.appendChild(el('span', 'quick-preview-val', pair[1] || '—'));
        table.appendChild(row);
      });
      preview.appendChild(table);
    }

    function updatePreview() {
      const text = titleInput.value;
      const rules = window.Nlp.parse(text, { categories: names });
      aiEnhanced = false;
      currentResult = rules;
      renderPreview(rules);

      clearTimeout(aiTimer);
      aiTimer = setTimeout(function () {
        window.API.aiStatus().then(function (st) {
          if (!st || !st.enabled) return;
          if (rules.deadline != null || rules.startTime != null) return; // 规则已命中时间，无需 AI
          if (titleInput.value !== text) return;
          window.API.aiParse({ text: text }).then(function (r) {
            if (!r || titleInput.value !== text) return;
            aiEnhanced = !!(r.deadline != null || r.startTime != null);
            currentResult = r;
            renderPreview(r);
          }).catch(function () {});
        }).catch(function () {});
      }, 400);
    }

    titleInput.addEventListener('input', updatePreview);
    renderPreview(currentResult);

    window.Modal.open({
      title: '快速捕捉',
      content: body,
      okText: '确认入库',
      onOk: function () {
        const text = titleInput.value.trim();
        if (!text) { window.Toast.error('内容不能为空'); return false; }
        // 以当前输入为准：预览结果仍匹配则复用（含 AI 增强），否则用规则结果兜底
        const res = (currentResult && currentResult.raw === text) ? currentResult : window.Nlp.parse(text, { categories: names });
        const c = buildCapture(res, text);
        if (c.type === 'event') { Store.addEvent(c.record); window.Toast.success('已创建日程'); }
        else { Store.addTodo(c.record); window.Toast.success(c.record.deadline ? '已创建待办' : '已收入收件箱'); }
      },
    });

    setTimeout(function () { if (titleInput.focus) titleInput.focus(); }, 0);
  }

  return { render: render, openQuickCapture: openQuickCapture };
})();
