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
      opt.textContent = window.Utils.formatRemind(m);
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

    // 日历显示（农历/节气/节假日）
    root.appendChild(calendarCard());

    // 节假日数据导入（A5）
    root.appendChild(holidayCard());

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

    // 邮件提醒
    root.appendChild(emailCard());

    // AI（自然语言快速捕捉）
    root.appendChild(aiCard());

    // 本机同步服务（内嵌后端）
    root.appendChild(syncServerCard());

    // 多端同步 + 账号
    root.appendChild(syncCard());

    // 新手引导与功能提示（老用户可在这里一键关掉全部提示，也能随时重新打开）
    root.appendChild(guideCard());
  }

  // 新手引导与功能提示
  function guideCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '新手引导与功能提示'));

    const G = window.Guide;
    const hint = el('div', 'item-meta',
      '每个功能第一次进入时会弹出一个小卡片，说明它是做什么的、有哪些关键操作。' +
      '已经熟悉的话可以关掉；以后想再看，随时回到这里。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);

    if (!G) {
      card.appendChild(el('div', 'placeholder', '引导模块未加载'));
      return card;
    }

    const status = el('div', 'item-meta');
    const dismissed = G.dismissedCount();
    status.textContent = G.tipsDisabled()
      ? '功能提示：已全部关闭'
      : ('功能提示：开启中' + (dismissed ? '（已单独关闭 ' + dismissed + ' 个）' : ''));
    status.style.color = 'var(--muted)';
    card.appendChild(status);

    const bar = el('div', 'toolbar');
    bar.style.marginTop = '8px';

    const replay = el('button', 'btn btn-primary btn-sm', '重新查看新手引导');
    replay.addEventListener('click', function () { G.openOnboarding({ force: true }); });
    bar.appendChild(replay);

    const overview = el('button', 'btn btn-sm', '各功能说明一览');
    overview.title = '不用逐个点进去，先看一遍每个功能是干什么的';
    overview.addEventListener('click', function () { G.openTipsOverview(); });
    bar.appendChild(overview);

    if (G.tipsDisabled()) {
      const enable = el('button', 'btn btn-sm', '恢复功能提示');
      enable.addEventListener('click', function () { G.enableAllTips(); render(); });
      bar.appendChild(enable);
    } else {
      const disable = el('button', 'btn btn-sm', '关闭全部功能提示');
      disable.title = '适合已经熟悉的老用户；随时可以恢复';
      disable.addEventListener('click', function () { G.disableAllTips(); render(); });
      bar.appendChild(disable);
    }

    card.appendChild(bar);
    return card;
  }

  // 日历显示（农历/节气/节假日开关）
  function calendarCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '日历显示'));
    const hint = el('div', 'item-meta', '在月/周/日视图显示农历日期、二十四节气与法定节假日（休/班）。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);
    const cal = Store.get().settings.calendar || {};
    [['showLunar', '显示农历日期'], ['showSolarTerms', '显示节气'], ['showHolidays', '显示法定节假日（休/班）'], ['restDayAffectsPlanning', '休息日/调休日暂停自动排程']].forEach(function (pair) {
      const row = el('div', 'form-row');
      row.appendChild(el('label', null, pair[1]));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = cal[pair[0]] !== false;
      cb.addEventListener('change', function () {
        const next = Object.assign({}, Store.get().settings.calendar || {});
        next[pair[0]] = cb.checked;
        Store.set({ settings: Object.assign({}, Store.get().settings, { calendar: next }) });
        window.Toast.success('已保存');
      });
      row.appendChild(cb);
      card.appendChild(row);
    });
    return card;
  }

  // 节假日数据导入（A5）：内置 2026 年，跨年后手动导入新年度 JSON 覆盖表
  function holidayCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '节假日数据'));
    const hint = el('div', 'item-meta', '内置 2026 年法定节假日与调休。跨年后在此导入新年度数据：JSON 对象 {"YYYY-MM-DD":{"name":"春节","isWork":false}}，isWork=false 为放假、true 为调休上班。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);

    const countRow = el('div', 'item-meta', '已导入自定义节假日：' + Object.keys(Store.get().settings.holidayData || {}).length + ' 天');
    card.appendChild(countRow);

    const ta = el('textarea');
    ta.rows = 5;
    ta.placeholder = '粘贴 JSON，例如：\n{"2027-01-01":{"name":"元旦","isWork":false},"2027-01-04":{"name":"元旦调休","isWork":true}}';
    ta.style.width = '100%';
    ta.style.marginTop = '8px';
    card.appendChild(ta);

    const btnRow = el('div', 'toolbar');
    btnRow.style.marginTop = '8px';
    const importBtn = el('button', 'btn btn-primary btn-sm', '导入 / 合并');
    importBtn.addEventListener('click', function () {
      const text = ta.value.trim();
      if (!text) { window.Toast.error('请粘贴 JSON 数据'); return; }
      let obj;
      try { obj = JSON.parse(text); } catch (e) { window.Toast.error('JSON 解析失败：' + (e.message || e)); return; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { window.Toast.error('格式应为 JSON 对象'); return; }
      const merged = Object.assign({}, Store.get().settings.holidayData || {});
      let n = 0;
      Object.keys(obj).forEach(function (k) {
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.isWork === 'boolean') {
          merged[k] = { name: v.name || '节假日', isWork: !!v.isWork };
          n++;
        }
      });
      if (!n) { window.Toast.error('未找到有效日期条目（需含 isWork 布尔字段）'); return; }
      Store.set({ settings: Object.assign({}, Store.get().settings, { holidayData: merged }) });
      window.Toast.success('已导入 ' + n + ' 天');
    });
    const clearBtn = el('button', 'btn btn-sm', '清空自定义数据');
    clearBtn.addEventListener('click', function () {
      if (!confirm('清空全部自定义节假日数据？（内置 2026 年数据不受影响）')) return;
      Store.set({ settings: Object.assign({}, Store.get().settings, { holidayData: {} }) });
      window.Toast.success('已清空');
    });
    btnRow.appendChild(importBtn);
    btnRow.appendChild(clearBtn);
    card.appendChild(btnRow);
    return card;
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

  // ---------- 本机同步服务（内嵌后端，本机作为同步中心） ----------
  function syncServerCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '本机同步服务（同步中心）'));
    const hint = el('div', 'item-meta', '启用后本机即作为同步服务器运行在 8787 端口，且下次开机自动启动；安卓手机连本机局域网 IP 即可互通，无需单独安装 Node。同时支持手机端「收集」直传（免登录，凭配对码）。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);

    const row = el('div', 'form-row');
    row.style.marginTop = '10px';
    const cb = el('input');
    cb.type = 'checkbox';
    const statusBox = el('div');
    statusBox.style.marginTop = '8px';

    function refresh(st) {
      cb.checked = !!(st && st.running);
      window.Dom.clear(statusBox);
      if (st && st.running) {
        statusBox.appendChild(el('div', 'item-meta', '运行中：' + st.url));

        // 局域网 IP —— 手机端要填的服务器地址（免去用户自己查 IP）
        const ips = (st.ips && st.ips.length) ? st.ips : [];
        if (ips.length) {
          const ipLine = el('div', 'item-meta');
          ipLine.style.marginTop = '6px';
          ipLine.textContent = '手机端填这个地址：' + ips.map(function (ip) { return 'http://' + ip + ':' + st.port; }).join('　或　');
          statusBox.appendChild(ipLine);
        } else {
          statusBox.appendChild(el('div', 'item-meta', '未检测到局域网 IP（请确认电脑已连 WiFi 或网线）'));
        }

        // 配对码 —— 手机端「收集 → 同步到电脑」时填写
        if (st.pairingCode) {
          const codeRow = el('div', 'item-meta');
          codeRow.style.marginTop = '6px';
          codeRow.appendChild(document.createTextNode('收集口令：'));
          const code = el('span', null, st.pairingCode);
          code.style.cssText = 'font-family:monospace;font-size:16px;font-weight:700;letter-spacing:2px;color:var(--primary);margin-left:4px;';
          codeRow.appendChild(code);
          statusBox.appendChild(codeRow);
        }

        const usage = el('div', 'item-meta');
        usage.style.marginTop = '6px';
        usage.textContent = '手机用法：在「收集」页随手记待办/想法（离线可记）→ 连上同一 WiFi → 点「同步到电脑」并填上面的地址与口令 → 条目会出现在本机「收件箱」等待整理。';
        statusBox.appendChild(usage);
      } else if (st && st.error) {
        statusBox.appendChild(el('div', 'item-meta', '启动失败：' + st.error));
      } else {
        statusBox.appendChild(el('div', 'item-meta', '已停止'));
      }
    }

    cb.addEventListener('change', function () {
      const p = cb.checked ? window.API.syncServerStart() : window.API.syncServerStop();
      p.then(refresh).catch(function (e) {
        window.Toast.error('操作失败：' + (e.message || e));
        refresh(null);
      });
    });

    row.appendChild(cb);
    row.appendChild(el('label', null, '启用本机同步服务'));
    card.appendChild(row);
    card.appendChild(statusBox);
    window.API.syncServerStatus().then(refresh)
      .catch(function () { statusBox.appendChild(el('div', 'placeholder', '同步服务不可用')); });
    return card;
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
      const infoRow = el('div', 'item-meta');
      infoRow.textContent = '已登录服务器：' + st.serverUrl;
      box.appendChild(infoRow);

      // 多账号：显示当前账号与角色，并允许刷新权限
      // （管理员改了你的权限后，点一下即可生效，不必退出重登）
      const P = window.PermUtil;
      const who = el('div', 'item-meta');
      const roleLabel = P.ROLE_LABEL[P.normalizeRole(st.role)] || st.role;
      who.textContent = '当前账号：' + (st.username || '（未命名）') + ' · ' + roleLabel +
        ' · 可用功能：' + P.permissionSummary(st.permissions);
      who.style.marginTop = '4px';
      if (st.isAdmin) who.style.color = 'var(--primary)';
      box.appendChild(who);

      const refreshRow = el('div', 'toolbar');
      refreshRow.style.marginTop = '6px';
      const refreshPermBtn = el('button', 'btn btn-sm', '刷新我的权限');
      refreshPermBtn.title = '管理员刚改过你的权限时，点这里立即生效';
      refreshPermBtn.addEventListener('click', function () {
        window.API.syncMe().then(function (res) {
          window.Toast.success('权限已更新：' + P.permissionSummary(res.permissions));
          if (window.App && window.App.refreshAccess) window.App.refreshAccess();
          window.Modules.settings.render();
        }).catch(function (e) {
          window.Toast.error('刷新失败：' + (e.message || e));
        });
      });
      refreshRow.appendChild(refreshPermBtn);
      if (st.isAdmin) {
        const goAdmin = el('button', 'btn btn-sm', '打开用户管理');
        goAdmin.addEventListener('click', function () {
          if (window.App && window.App.switchView) window.App.switchView('admin');
        });
        refreshRow.appendChild(goAdmin);
      }
      box.appendChild(refreshRow);

      // 「修改地址」：保留登录态，无需退出重登（换网络/服务端 IP 变更时的常用操作）
      const editBox = el('div');
      editBox.style.display = 'none';
      editBox.style.marginTop = '8px';
      const ipRow = el('div', 'form-row');
      ipRow.appendChild(el('label', null, '服务器地址'));
      const ipInput = el('input');
      ipInput.type = 'text';
      ipInput.value = st.serverUrl || '';
      ipInput.placeholder = 'http://192.168.0.106:8787（可省略 http://）';
      ipRow.appendChild(ipInput);
      editBox.appendChild(ipRow);
      const editBtns = el('div', 'toolbar');
      const saveIpBtn = el('button', 'btn btn-primary btn-sm', '保存地址');
      saveIpBtn.addEventListener('click', function () {
        window.API.syncSetServer(ipInput.value).then(function (res) {
          window.Toast.success(res && res.changed ? '地址已更新，下次同步将全量对齐' : '地址未变化');
          window.Modules.settings.render();
        }).catch(function (e) {
          window.Toast.error('保存失败：' + (e.message || e));
        });
      });
      const cancelIpBtn = el('button', 'btn btn-sm', '取消');
      cancelIpBtn.addEventListener('click', function () { editBox.style.display = 'none'; });
      editBtns.appendChild(saveIpBtn);
      editBtns.appendChild(cancelIpBtn);
      editBox.appendChild(editBtns);
      box.appendChild(editBox); // 修复：editBox 之前只创建未挂载，「修改地址」点了没有任何反应

      const btnRow = el('div', 'toolbar');
      btnRow.style.marginTop = '8px';
      const syncBtn = el('button', 'btn btn-primary btn-sm', '立即同步');
      syncBtn.addEventListener('click', doSync);
      const editBtn = el('button', 'btn btn-sm', '修改地址');
      editBtn.addEventListener('click', function () {
        editBox.style.display = (editBox.style.display === 'none') ? '' : 'none';
        if (editBox.style.display !== 'none') ipInput.focus();
      });
      const logoutBtn = el('button', 'btn btn-sm', '退出登录');
      logoutBtn.addEventListener('click', function () {
        window.API.syncLogout().then(function () {
          window.Toast.success('已退出登录');
          // 退出后要收回管理员入口，并恢复按「未登录」的导航显隐
          if (window.App && window.App.refreshAccess) window.App.refreshAccess();
          window.API.syncStatus().then(function (s) { renderSyncContent(box, s); });
        });
      });
      btnRow.appendChild(syncBtn);
      btnRow.appendChild(editBtn);
      btnRow.appendChild(logoutBtn);
      box.appendChild(btnRow);
    } else {
      // 预填上次用过的地址（退出登录不再清空 serverUrl），避免用户反复手输 IP
      const server = syncField('服务器地址', 'http://192.168.0.106:8787（可省略 http://）');
      if (st && st.serverUrl) server.input.value = st.serverUrl;
      const user = syncField('用户名', '');
      const pass = syncField('密码', '', 'password');
      box.appendChild(server.row);
      box.appendChild(user.row);
      box.appendChild(pass.row);

      // 一键填入本机局域网地址：手机/队友要连的就是这台电脑时最常用，
      // 免去用户自己查 IP（曾出现手输成 192.168.1.x 与真实网段不符导致同步失败）
      const fillLine = el('div', 'toolbar');
      fillLine.style.marginTop = '6px';
      const fillBtn = el('button', 'btn btn-sm', '填入本机地址');
      const fillHint = el('span', 'item-meta', '');
      fillHint.style.marginLeft = '8px';
      fillBtn.addEventListener('click', function () {
        window.API.syncServerStatus().then(function (s) {
          const ips = (s && s.ips) || [];
          if (!ips.length) {
            window.Toast.error('未检测到局域网 IP，请确认已连 WiFi 或网线，并先启用下方「本机同步服务」');
            return;
          }
          server.input.value = 'http://' + ips[0] + ':' + (s.port || 8787);
          window.Toast.success('已填入本机地址 ' + ips[0]);
        }).catch(function () { window.Toast.error('无法读取本机地址'); });
      });
      fillLine.appendChild(fillBtn);
      fillLine.appendChild(fillHint);
      box.appendChild(fillLine);
      // 顺带提示本机是否已开同步服务，否则填了也连不上
      window.API.syncServerStatus().then(function (s) {
        fillHint.textContent = (s && s.running)
          ? '本机同步服务运行中'
          : '提示：本机同步服务未启用，需先到下方「本机同步服务」开启';
      }).catch(function () {});

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
      const res = await window.API.loginSync({ serverUrl: serverUrl, username: username, password: password, register: register });
      const P = window.PermUtil;
      const isAdmin = P.isAdmin(res && res.user);
      window.Toast.success(register ? '注册并登录成功' : '登录成功');
      // 登录后按新账号的角色/权限重算导航显隐（管理员会出现「用户管理」入口）
      if (window.App && window.App.refreshAccess) await window.App.refreshAccess();
      if (isAdmin) {
        window.Toast.info('你已登录为管理员，左侧「用户管理」可管理账号与权限');
      }
      window.Modules.settings.render();
    } catch (e) {
      window.Toast.error('登录失败：' + (e.message || e));
    }
  }

  async function doSync() {
    try {
      // 统一走 push-then-pull（先推本地修改，再拉其他设备变更）
      const res = await window.API.syncNow();
      window.Toast.success('同步完成：推送 ' + res.pushed + ' 条，拉取 ' + res.pulled + ' 条');
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

  // ---------- 邮件提醒 ----------
  function emailCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', '邮件提醒'));
    const hint = el('div', 'item-meta', '每天自动发送一封待办摘要到指定邮箱（通过你自己的 SMTP 邮箱发送；仅桌面端，电脑关机当天可能漏发）。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);
    const box = el('div');
    card.appendChild(box);
    window.API.emailStatus().then(function (st) { renderEmailContent(box, st); })
      .catch(function () { box.appendChild(el('div', 'placeholder', '邮件功能不可用')); });
    return card;
  }

  function emailField(label, value, placeholder, type) {
    const row = el('div', 'form-row');
    row.appendChild(el('label', null, label));
    const input = el('input');
    input.type = type || 'text';
    input.value = value == null ? '' : String(value);
    input.placeholder = placeholder || '';
    row.appendChild(input);
    return { row: row, input: input };
  }

  function renderEmailContent(box, st) {
    window.Dom.clear(box);

    const enableRow = el('div', 'form-row');
    enableRow.appendChild(el('label', null, '启用每日邮件'));
    const enableCheck = el('input');
    enableCheck.type = 'checkbox';
    enableCheck.checked = !!st.enabled;
    enableRow.appendChild(enableCheck);
    box.appendChild(enableRow);

    const to = emailField('收件邮箱', st.to, 'you@example.com');
    const time = emailField('发送时间', st.time, '08:00');
    const host = emailField('SMTP 主机', st.host, 'smtp.example.com');
    const port = emailField('端口', st.port, '465', 'number');
    const user = emailField('SMTP 用户名', st.user, 'you@example.com');
    const fromName = emailField('发件人名称', st.fromName, '日程管理');
    const pass = emailField('密码/授权码', '', st.hasPassword ? '已保存（留空不修改）' : 'SMTP 授权码', 'password');

    const secureRow = el('div', 'form-row');
    secureRow.appendChild(el('label', null, '使用 SSL/TLS（端口 465 通常开启）'));
    const secureCheck = el('input');
    secureCheck.type = 'checkbox';
    secureCheck.checked = st.secure !== false;
    secureRow.appendChild(secureCheck);

    box.appendChild(to.row);
    box.appendChild(time.row);
    box.appendChild(host.row);
    box.appendChild(port.row);
    box.appendChild(user.row);
    box.appendChild(fromName.row);
    box.appendChild(secureRow);
    box.appendChild(pass.row);

    const btnRow = el('div', 'toolbar');
    btnRow.style.marginTop = '8px';
    const saveBtn = el('button', 'btn btn-primary btn-sm', '保存邮件设置');
    const testBtn = el('button', 'btn btn-sm', '发送测试邮件');
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(testBtn);
    box.appendChild(btnRow);

    if (st.lastSentDate) {
      box.appendChild(el('div', 'item-meta', '最近发送：' + st.lastSentDate));
    }

    function collect() {
      return {
        reminder: { enabled: enableCheck.checked, time: time.input.value.trim() || '08:00', to: to.input.value.trim() },
        smtp: {
          host: host.input.value.trim(),
          port: Number(port.input.value) || 465,
          secure: secureCheck.checked,
          user: user.input.value.trim(),
          fromName: fromName.input.value.trim(),
        },
        password: pass.input.value, // 空字符串 = 保持原密码
      };
    }

    function syncLocal(reminder, smtp) {
      Store.set({
        settings: Object.assign({}, Store.get().settings, {
          emailReminder: reminder,
          emailSmtp: smtp,
        }),
      });
    }

    saveBtn.addEventListener('click', async function () {
      try {
        const payload = collect();
        const st2 = await window.API.emailSaveSettings(payload);
        syncLocal(payload.reminder, payload.smtp);
        window.Toast.success('已保存');
        renderEmailContent(box, st2);
      } catch (e) {
        window.Toast.error('保存失败：' + (e.message || e));
      }
    });

    testBtn.addEventListener('click', async function () {
      try {
        const payload = collect();
        // 若填了新密码，先保存再测试，保证测试用最新配置
        await window.API.emailSaveSettings(payload);
        syncLocal(payload.reminder, payload.smtp);
        await window.API.emailTest({ to: payload.reminder.to });
        window.Toast.success('测试邮件已发送');
      } catch (e) {
        window.Toast.error('发送失败：' + (e.message || e));
      }
    });
  }

  // ---------- AI（自然语言快速捕捉） ----------
  const AI_PROVIDERS = [
    { value: 'ollama', label: 'Ollama（本地）', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
    { value: 'openai', label: 'OpenAI 兼容', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ];

  function aiCard() {
    const card = el('div', 'card');
    card.style.marginTop = '16px';
    card.appendChild(el('div', 'panel-title', 'AI 自然语言'));
    const hint = el('div', 'item-meta', '默认关闭。开启后，快速捕捉里输入自然语言，规则解析不了时间时会调用 AI 兜底（不静默改数据，始终由你确认）。');
    hint.style.margin = '8px 0';
    card.appendChild(hint);
    const box = el('div');
    card.appendChild(box);
    window.API.aiStatus().then(function (st) { renderAiContent(box, st); })
      .catch(function () { box.appendChild(el('div', 'placeholder', 'AI 功能不可用')); });
    return card;
  }

  function renderAiContent(box, st) {
    window.Dom.clear(box);

    const enableRow = el('div', 'form-row');
    enableRow.appendChild(el('label', null, '启用 AI 兜底'));
    const enableCheck = el('input');
    enableCheck.type = 'checkbox';
    enableCheck.checked = !!st.enabled;
    enableRow.appendChild(enableCheck);
    box.appendChild(enableRow);

    const provRow = el('div', 'form-row');
    provRow.appendChild(el('label', null, '提供商'));
    const provSel = el('select');
    AI_PROVIDERS.forEach(function (p) {
      const opt = el('option');
      opt.value = p.value;
      opt.textContent = p.label;
      provSel.appendChild(opt);
    });
    provSel.value = st.provider || 'ollama';
    provRow.appendChild(provSel);
    box.appendChild(provRow);

    const endpoint = emailField('Endpoint', st.endpoint, 'http://localhost:11434/v1');
    const model = emailField('模型名', st.model, 'qwen2.5:7b');
    const key = emailField('API Key', '', st.hasApiKey ? '已保存（留空不修改）' : '（Ollama 本地通常无需）', 'password');
    box.appendChild(endpoint.row);
    box.appendChild(model.row);
    box.appendChild(key.row);

    // 切换提供商时填入对应默认 endpoint/模型（可再手改）
    provSel.addEventListener('change', function () {
      const p = AI_PROVIDERS.find(function (x) { return x.value === provSel.value; });
      if (p) { endpoint.input.value = p.endpoint; model.input.value = p.model; }
    });

    const btnRow = el('div', 'toolbar');
    btnRow.style.marginTop = '8px';
    const saveBtn = el('button', 'btn btn-primary btn-sm', '保存 AI 设置');
    const testBtn = el('button', 'btn btn-sm', '测试连接');
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(testBtn);
    box.appendChild(btnRow);

    function collect() {
      return {
        ai: {
          enabled: enableCheck.checked,
          provider: provSel.value,
          endpoint: endpoint.input.value.trim(),
          model: model.input.value.trim(),
        },
        apiKey: key.input.value, // 空 = 保持原 key
      };
    }

    saveBtn.addEventListener('click', async function () {
      try {
        const payload = collect();
        const st2 = await window.API.aiSaveSettings(payload);
        Store.set({ settings: Object.assign({}, Store.get().settings, { ai: payload.ai }) });
        window.Toast.success('已保存');
        renderAiContent(box, st2);
      } catch (e) {
        window.Toast.error('保存失败：' + (e.message || e));
      }
    });

    testBtn.addEventListener('click', async function () {
      try {
        await window.API.aiSaveSettings(collect());
        const reply = await window.API.aiTest();
        window.Toast.success('连接成功：' + reply);
      } catch (e) {
        window.Toast.error('连接失败：' + (e.message || e));
      }
    });
  }

  return { render: render };
})();
