/*
 * settings.js — 设置模块：分类管理（CRUD+颜色）、提醒默认值、数据导出/导入/恢复。
 */
window.Modules = window.Modules || {};
window.Modules.settings = (function () {
  'use strict';
  const C = window.API.constants;
  const el = window.Dom.el;
  const clear = window.Dom.clear;

  function render() {
    const root = document.getElementById('view-settings');
    clear(root);

    // 分类管理
    const catCard = el('div', 'card');
    const catHeader = el('div', 'panel-header');
    catHeader.appendChild(el('div', 'panel-title', '分类管理'));
    const addCatBtn = el('button', 'btn btn-primary btn-sm', '+ 新增分类');
    addCatBtn.addEventListener('click', function () { openCategoryForm(null); });
    catHeader.appendChild(addCatBtn);
    catCard.appendChild(catHeader);
    const list = el('div');
    Store.get().categories.forEach(function (c) { list.appendChild(categoryRow(c)); });
    if (!Store.get().categories.length) list.appendChild(el('div', 'placeholder', '暂无分类'));
    catCard.appendChild(list);
    root.appendChild(catCard);

    // 提醒默认值
    const remindCard = el('div', 'card');
    remindCard.style.marginTop = '16px';
    remindCard.appendChild(el('div', 'panel-title', '提醒默认值'));
    const remindRow = el('div', 'form-row');
    remindRow.style.marginTop = '12px';
    remindRow.appendChild(el('label', null, '新建日程/待办时默认提前提醒时间'));
    const sel = el('select');
    C.REMIND_OPTIONS.forEach(function (m) {
      const opt = el('option');
      opt.value = m;
      opt.textContent = m === 0 ? '不提醒' : '提前 ' + m + ' 分钟';
      sel.appendChild(opt);
    });
    sel.value = Store.get().settings.defaultRemindBefore || 0;
    sel.addEventListener('change', function () {
      Store.set({ settings: Object.assign({}, Store.get().settings, { defaultRemindBefore: Number(sel.value) }) });
      window.Toast.success('已保存');
    });
    remindRow.appendChild(sel);
    remindCard.appendChild(remindRow);
    root.appendChild(remindCard);

    // 外观主题
    const themeCard = el('div', 'card');
    themeCard.style.marginTop = '16px';
    themeCard.appendChild(el('div', 'panel-title', '外观'));
    const themeRow = el('div', 'form-row');
    themeRow.style.marginTop = '12px';
    themeRow.appendChild(el('label', null, '界面主题'));
    const themeSel = el('select');
    [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].forEach(function (pair) {
      const opt = el('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      themeSel.appendChild(opt);
    });
    themeSel.value = Store.get().settings.theme || 'system';
    themeSel.addEventListener('change', function () {
      Store.set({ settings: Object.assign({}, Store.get().settings, { theme: themeSel.value }) });
      window.Toast.success('已保存');
    });
    themeRow.appendChild(themeSel);
    themeCard.appendChild(themeRow);
    root.appendChild(themeCard);

    // 时间管理四象限
    const quadCard = el('div', 'card');
    quadCard.style.marginTop = '16px';
    quadCard.appendChild(el('div', 'panel-title', '时间管理四象限'));
    const quadHint = el('div', 'item-meta', '待办截止前多少小时内视为「紧急」，用于自动划分四象限（重要 × 紧急）。');
    quadHint.style.margin = '8px 0';
    quadCard.appendChild(quadHint);
    const quadRow = el('div', 'form-row');
    quadRow.appendChild(el('label', null, '紧急阈值'));
    const quadSel = el('select');
    [6, 12, 24, 48, 72].forEach(function (h) {
      const opt = el('option');
      opt.value = h;
      opt.textContent = '截止前 ' + h + ' 小时';
      quadSel.appendChild(opt);
    });
    quadSel.value = Store.get().settings.urgentThresholdHours || 24;
    quadSel.addEventListener('change', function () {
      Store.set({ settings: Object.assign({}, Store.get().settings, { urgentThresholdHours: Number(quadSel.value) }) });
      window.Toast.success('已保存');
    });
    quadRow.appendChild(quadSel);
    quadCard.appendChild(quadRow);
    root.appendChild(quadCard);

    // 数据管理
    const dataCard = el('div', 'card');
    dataCard.style.marginTop = '16px';
    dataCard.appendChild(el('div', 'panel-title', '数据管理'));
    const desc = el('div', 'item-meta', '数据自动保存在本地，可随时导出备份，或从备份文件恢复。');
    desc.style.margin = '8px 0';
    dataCard.appendChild(desc);
    const btnRow = el('div', 'toolbar');
    btnRow.appendChild(actionBtn('导出数据', exportData));
    btnRow.appendChild(actionBtn('导入数据', importData));
    btnRow.appendChild(actionBtn('从备份恢复', restoreData));
    dataCard.appendChild(btnRow);
    root.appendChild(dataCard);

    // 多端同步
    root.appendChild(syncCard());
  }

  // 分类行
  function categoryRow(c) {
    const row = el('div', 'item');
    const dot = el('span', 'dot');
    dot.style.background = c.color;
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', c.name + (c.isDefault ? '（默认）' : '')));
    row.appendChild(dot);
    row.appendChild(main);
    const editBtn = el('button', 'btn btn-sm', '编辑');
    editBtn.addEventListener('click', function () { openCategoryForm(c); });
    const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
    delBtn.addEventListener('click', function () {
      if (!confirm('删除分类「' + c.name + '」？关联条目将归为未分类。')) return;
      Store.deleteCategory(c.id);
      window.Toast.success('已删除');
    });
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    return row;
  }

  // 分类新增/编辑弹窗
  function openCategoryForm(cat) {
    const body = el('div');
    const nameRow = el('div', 'form-row');
    nameRow.appendChild(el('label', null, '分类名称'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = cat ? cat.name : '';
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    const colorRow = el('div', 'form-row');
    colorRow.appendChild(el('label', null, '颜色'));
    const swatches = el('div', 'color-swatches');
    let selected = cat ? cat.color : C.CATEGORY_COLORS[0];
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
      title: cat ? '编辑分类' : '新增分类',
      content: body,
      okText: '保存',
      onOk: function () {
        const name = nameInput.value.trim();
        if (!name) { window.Toast.error('分类名称不能为空'); return false; }
        if (cat) {
          Store.updateCategory(cat.id, { name: name, color: selected });
        } else {
          Store.addCategory({ id: window.Utils.genId(), name: name, color: selected, isDefault: false, createdAt: Date.now() });
        }
        window.Toast.success('已保存');
      },
    });
  }

  function actionBtn(label, handler) {
    const b = el('button', 'btn', label);
    b.addEventListener('click', handler);
    return b;
  }

  // ---------- 多端同步 ----------
  function syncCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '多端同步'));
    const hint = el('div', 'item-meta', '登录自建同步服务器（server/ 目录）后，日程与待办可在电脑、手机间双向同步。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);
    const box = el('div');
    card.appendChild(box);
    window.API.syncStatus().then(function (st) { renderSyncContent(box, st); })
      .catch(function () { box.appendChild(el('div', 'placeholder', '同步功能不可用')); });
    return card;
  }

  function syncField(label, placeholder, type) {
    const row = el('div', 'form-row');
    row.appendChild(el('label', null, label));
    const input = el('input');
    input.type = type || 'text';
    input.placeholder = placeholder || '';
    row.appendChild(input);
    return { row: row, input: input };
  }

  function renderSyncContent(box, st) {
    window.Dom.clear(box);
    if (st && st.loggedIn) {
      box.appendChild(el('div', 'item-meta', '已登录服务器：' + st.serverUrl));
      const btnRow = el('div', 'toolbar');
      btnRow.style.marginTop = '8px';
      const syncBtn = el('button', 'btn btn-primary btn-sm', '立即同步');
      syncBtn.addEventListener('click', doSync);
      const logoutBtn = el('button', 'btn btn-sm', '退出登录');
      logoutBtn.addEventListener('click', function () {
        window.API.syncLogout().then(function () {
          window.Toast.success('已退出登录');
          window.API.syncStatus().then(function (s) { renderSyncContent(box, s); });
        });
      });
      btnRow.appendChild(syncBtn);
      btnRow.appendChild(logoutBtn);
      box.appendChild(btnRow);
    } else {
      const server = syncField('服务器地址', 'http://192.168.1.100:8787');
      const user = syncField('用户名', '');
      const pass = syncField('密码', '', 'password');
      box.appendChild(server.row);
      box.appendChild(user.row);
      box.appendChild(pass.row);
      const btnRow = el('div', 'toolbar');
      const loginBtn = el('button', 'btn btn-primary btn-sm', '登录');
      const regBtn = el('button', 'btn btn-sm', '注册并登录');
      loginBtn.addEventListener('click', function () { doLogin(server.input.value, user.input.value, pass.input.value, false); });
      regBtn.addEventListener('click', function () { doLogin(server.input.value, user.input.value, pass.input.value, true); });
      btnRow.appendChild(loginBtn);
      btnRow.appendChild(regBtn);
      box.appendChild(btnRow);
    }
  }

  async function doLogin(serverUrl, username, password, register) {
    if (!serverUrl || !username || !password) {
      window.Toast.error('请填写服务器地址、用户名和密码');
      return;
    }
    try {
      await window.API.loginSync({ serverUrl: serverUrl, username: username, password: password, register: register });
      window.Toast.success(register ? '注册并登录成功' : '登录成功');
      window.Modules.settings.render();
    } catch (e) {
      window.Toast.error('登录失败：' + (e.message || e));
    }
  }

  async function doSync() {
    try {
      const pull = await window.API.syncPull();
      const push = await window.API.syncPush();
      window.Toast.success('同步完成：拉取 ' + pull.pulled + ' 条，推送 ' + push.pushed + ' 条');
    } catch (e) {
      window.Toast.error('同步失败：' + (e.message || e));
    }
  }

  async function exportData() {
    const res = await window.API.exportData();
    if (res.ok) window.Toast.success('已导出');
    else if (!res.canceled) window.Toast.error('导出失败：' + (res.error || ''));
  }

  async function importData() {
    if (!confirm('导入将覆盖当前数据，是否继续？')) return;
    const res = await window.API.importData();
    if (res.ok) { Store.set(res.data); window.Toast.success('已导入'); }
    else if (!res.canceled) window.Toast.error('导入失败：' + (res.error || ''));
  }

  async function restoreData() {
    if (!confirm('恢复将覆盖当前数据，是否继续？')) return;
    const res = await window.API.restoreData();
    if (res.ok) { Store.set(res.data); window.Toast.success('已恢复'); }
    else if (!res.canceled) window.Toast.error('恢复失败：' + (res.error || ''));
  }

  return { render: render };
})();
