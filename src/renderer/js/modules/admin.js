/*
 * admin.js — 用户管理（管理员专属视图，v2.3.5）
 *
 * 能力：查看账号列表、新建账号、给账号勾选可用的功能模块、开停账号、重置密码、
 *       提升/取消管理员、删除账号。
 *
 * 两条设计原则：
 *   1. **权限只在服务端生效**，这个页面只是把服务端的规则「可视化」。
 *      所以任何操作都以服务端返回为准（失败就把错误原样提示给用户），
 *      不在前端假装成功 —— 否则会出现「界面显示改了、其实没改」。
 *   2. 把服务端的保护规则在界面上**提前禁掉**（不能停用自己、不能删最后一个管理员），
 *      让用户不必靠报错才知道不能点。
 */
window.Modules = window.Modules || {};
window.Modules.admin = (function () {
  'use strict';
  const el = window.Dom.el;
  const clear = window.Dom.clear;
  const P = window.PermUtil;

  let state = {
    loading: false,
    loaded: false, // 是否已经拉过一次列表（用于「首帧自动加载」判断）
    error: '',
    users: [],
    modules: P.MODULES,
    meId: null,
    status: null, // syncStatus() 结果
    overview: null, // /api/admin/overview（含超级管理员与默认密码告警）
  };
  // 正在编辑权限的账号 id（展开权限勾选面板）
  let editingPermId = null;

  function fmtTime(ts) {
    if (!ts) return '—';
    return window.Utils.toDateTimeStr(ts);
  }

  function render() {
    const root = document.getElementById('view-admin');
    if (!root) return;

    // 首次进入（或从未成功加载过）时自动拉取账号列表。
    // 不加这一步，页面会一直显示 0 个账号，用户必须自己点「刷新」才看得到 —— 实际踩到过。
    if (!state.loaded && !state.loading) {
      load(true);
      return;
    }

    clear(root);

    const header = el('div', 'panel-header');
    header.appendChild(el('div', 'panel-title', '用户管理'));
    const btns = el('div', 'cal-nav');
    const refreshBtn = el('button', 'btn btn-sm', '刷新');
    refreshBtn.addEventListener('click', function () { load(true); });
    btns.appendChild(refreshBtn);
    const newBtn = el('button', 'btn btn-primary btn-sm', '+ 新建账号');
    newBtn.addEventListener('click', function () { openCreateForm(); });
    btns.appendChild(newBtn);
    header.appendChild(btns);
    root.appendChild(header);

    const hint = el('div', 'item-meta',
      '管理员可以给每个账号勾选「能使用哪些功能」、随时开停账号。' +
      '被停用的账号会立即掉线且无法登录；改动无需对方重新登录即刻生效。');
    hint.style.marginBottom = '12px';
    root.appendChild(hint);

    if (state.status && !state.status.loggedIn) {
      root.appendChild(el('div', 'placeholder',
        '请先在「设置 → 多端同步」登录服务器。用户管理需要连接服务器上的账号库。'));
      return;
    }
    if (state.status && !state.status.isAdmin) {
      root.appendChild(el('div', 'placeholder',
        '当前账号不是管理员，无法管理其他用户。如需权限请联系管理员。'));
      return;
    }
    if (state.loading) {
      root.appendChild(el('div', 'placeholder', '正在加载账号列表…'));
      return;
    }
    if (state.error) {
      const box = el('div', 'placeholder', '加载失败：' + state.error);
      root.appendChild(box);
      const retry = el('button', 'btn btn-sm', '重试');
      retry.style.marginTop = '8px';
      retry.addEventListener('click', function () { load(true); });
      root.appendChild(retry);
      return;
    }

    root.appendChild(overviewCards());
    root.appendChild(defaultPasswordWarning());
    root.appendChild(userTable());
  }

  // 内置超级管理员仍在用默认弱口令时给出醒目告警。
  // 这条不是「唠叨」：本仓库是公开仓库，默认凭据等于公开的；同步服务又在局域网上，
  // 同网段任何人凭它就能拿到最高权限、读写或删除所有人的数据。
  function defaultPasswordWarning() {
    const sup = state.overview && state.overview.superAdmin;
    if (!sup || !sup.usingDefaultPassword) return el('span');
    const box = el('div', 'card danger-card');
    box.style.marginTop = '12px';
    box.appendChild(el('div', 'panel-title', '⚠ 安全提醒：内置超级管理员仍在使用默认密码'));

    const p1 = el('div', 'item-meta',
      '内置超级管理员「' + sup.username + '」的密码还是默认值。这个默认值是公开的，' +
      '而同步服务监听在局域网上 —— 同一网络里任何人都能凭它取得最高权限，' +
      '读取、修改或删除所有账号的数据。');
    p1.style.marginTop = '6px';
    p1.style.color = 'var(--danger)';
    box.appendChild(p1);

    const p2 = el('div', 'item-meta',
      '建议立刻用「' + sup.username + '」登录后在下方改密码；' +
      '或在服务端设置环境变量 SUPER_ADMIN_PASSWORD 后重启，' +
      '需要把改过的密码重置回该值时设 SUPER_ADMIN_RESET=1 重启一次。');
    p2.style.marginTop = '6px';
    box.appendChild(p2);

    return box;
  }

  function overviewCards() {
    const users = state.users;
    const active = users.filter(function (u) { return u.status === 'active'; }).length;
    // 「管理员」要含超级管理员 —— 只看 role==='admin' 会漏掉它，与顶部的角色徽标自相矛盾
    const admins = users.filter(function (u) { return P.isAdmin(u); }).length;
    const records = users.reduce(function (n, u) { return n + (u.recordCount || 0); }, 0);
    const cards = el('div', 'stat-cards');
    [
      ['账号总数', String(users.length), '含已停用'],
      ['启用中', String(active), '已停用 ' + (users.length - active)],
      ['管理员', String(admins), '拥有用户管理权限'],
      ['同步记录', String(records), '所有账号合计'],
    ].forEach(function (p) {
      const c = el('div', 'stat-card');
      c.appendChild(el('div', 'stat-label', p[0]));
      c.appendChild(el('div', 'stat-value', p[1]));
      c.appendChild(el('div', 'stat-sub', p[2]));
      cards.appendChild(c);
    });
    return cards;
  }

  function userTable() {
    const wrap = el('div');
    wrap.style.marginTop = '16px';

    state.users.forEach(function (u) {
      const card = el('div', 'card');
      card.style.marginBottom = '10px';

      const head = el('div', 'panel-header');
      head.style.marginBottom = '8px';
      const left = el('div');
      left.style.flex = '1';

      const titleRow = el('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.gap = '8px';
      titleRow.appendChild(el('div', 'item-title', u.username + (u.displayName ? '（' + u.displayName + '）' : '')));
      const roleBadge = el('span', 'badge', P.ROLE_LABEL[u.role] || u.role);
      roleBadge.style.background = u.role === 'super' ? '#8e6fd8' : (u.role === 'admin' ? '#4f8ef7' : '#8a8f98');
      roleBadge.style.color = '#fff';
      titleRow.appendChild(roleBadge);
      const stBadge = el('span', 'badge', P.STATUS_LABEL[u.status] || u.status);
      stBadge.style.background = u.status === 'active' ? '#4caf7d' : '#e05b5b';
      stBadge.style.color = '#fff';
      titleRow.appendChild(stBadge);
      if (u.isSelf) {
        const meBadge = el('span', 'badge', '当前登录');
        meBadge.style.background = '#8e6fd8';
        meBadge.style.color = '#fff';
        titleRow.appendChild(meBadge);
      }
      left.appendChild(titleRow);

      const meta = el('div', 'item-meta');
      meta.textContent = '创建 ' + fmtTime(u.createdAt) +
        ' · 最近登录 ' + fmtTime(u.lastLoginAt) +
        ' · 记录 ' + (u.recordCount || 0) + ' 条';
      left.appendChild(meta);

      const permLine = el('div', 'item-meta');
      // 超级管理员不受权限勾选限制，别显示「无功能权限」误导人
      const isSuperRow = P.isSuper(u) || P.isSuperUsername(u.username);
      permLine.textContent = '功能权限：' + (isSuperRow ? '全部功能（超级管理员不受限制）' : P.permissionSummary(u.permissions));
      permLine.style.marginTop = '4px';
      permLine.style.color = (!isSuperRow && !P.resolvePermissions(u.permissions).length)
        ? 'var(--danger)' : 'var(--muted)';
      left.appendChild(permLine);

      head.appendChild(left);

      const isSelf = !!u.isSelf;
      // 内置超级管理员：谁都不能停用/降级/删除它（服务端也会拒绝，这里提前禁用）。
      // 判定同时看 role 与固定用户名 —— 名字固定为 admin，改不了。
      const targetIsSuper = P.isSuper(u) || P.isSuperUsername(u.username);
      const activeAdminCount = state.users.filter(function (x) {
        return P.isAdmin(x) && x.status === 'active';
      }).length;
      // 与后端同规则：不能停用/降级/删除自己；不能动掉最后一个启用的管理员
      const isLastActiveAdmin = P.isAdmin(u) && u.status === 'active' && activeAdminCount <= 1;

      const actions = el('div', 'cal-nav');
      actions.style.flexWrap = 'wrap';

      const permBtn = el('button', 'btn btn-sm', editingPermId === u.id ? '收起权限' : '设置权限');
      if (targetIsSuper) {
        permBtn.disabled = true;
        permBtn.title = '超级管理员不受功能权限限制，无需设置';
      }
      permBtn.addEventListener('click', function () {
        editingPermId = (editingPermId === u.id) ? null : u.id;
        render();
      });
      actions.appendChild(permBtn);

      const toggleBtn = el('button', 'btn btn-sm', u.status === 'active' ? '停用账号' : '启用账号');
      if (targetIsSuper) {
        toggleBtn.disabled = true;
        toggleBtn.title = '内置超级管理员不可停用（停掉就没人能进后台了）';
      } else if (isSelf) {
        toggleBtn.disabled = true;
        toggleBtn.title = '不能停用当前登录的账号';
      } else if (isLastActiveAdmin && u.status === 'active') {
        toggleBtn.disabled = true;
        toggleBtn.title = '系统必须保留至少一个启用的管理员';
      }
      toggleBtn.addEventListener('click', function () {
        patchUser(u, { status: u.status === 'active' ? 'disabled' : 'active' },
          u.status === 'active' ? '已停用「' + u.username + '」' : '已启用「' + u.username + '」');
      });
      actions.appendChild(toggleBtn);

      // 超级管理员的密码只能由它本人改 —— 这是改掉默认弱口令的正规途径，必须留着
      const pwBtn = el('button', 'btn btn-sm', '重置密码');
      if (targetIsSuper && !isSelf) {
        pwBtn.disabled = true;
        pwBtn.title = '内置超级管理员的密码只能由该账号本人修改';
      }
      pwBtn.addEventListener('click', function () { openPasswordForm(u); });
      actions.appendChild(pwBtn);

      const roleBtn = el('button', 'btn btn-sm', P.isAdmin(u) ? '取消管理员' : '设为管理员');
      if (targetIsSuper) {
        roleBtn.disabled = true;
        roleBtn.title = '不能修改内置超级管理员的角色';
      } else if (isSelf) {
        roleBtn.disabled = true;
        roleBtn.title = '不能取消自己的管理员角色';
      } else if (isLastActiveAdmin) {
        roleBtn.disabled = true;
        roleBtn.title = '系统必须保留至少一个启用的管理员';
      }
      roleBtn.addEventListener('click', function () {
        const nextRole = P.isAdmin(u) ? 'user' : 'admin';
        patchUser(u, { role: nextRole },
          nextRole === 'admin' ? '已把「' + u.username + '」设为管理员' : '已取消「' + u.username + '」的管理员角色');
      });
      actions.appendChild(roleBtn);

      const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
      if (targetIsSuper) {
        delBtn.disabled = true;
        delBtn.title = '内置超级管理员不可删除';
      } else if (isSelf) {
        delBtn.disabled = true;
        delBtn.title = '不能删除当前登录的账号';
      } else if (isLastActiveAdmin) {
        delBtn.disabled = true;
        delBtn.title = '系统必须保留至少一个管理员';
      }
      delBtn.addEventListener('click', function () { confirmDelete(u); });
      actions.appendChild(delBtn);

      head.appendChild(actions);
      card.appendChild(head);

      if (editingPermId === u.id) card.appendChild(permEditor(u));
      wrap.appendChild(card);
    });

    return wrap;
  }

  // 权限勾选面板
  function permEditor(u) {
    const box = el('div');
    box.style.marginTop = '8px';

    box.appendChild(el('div', 'item-meta', '勾选该账号可以使用的功能（「设置」始终可用，否则用户无法查看引导或改密码）：'));

    const grid = el('div', 'perm-grid');
    const selected = {};
    P.resolvePermissions(u.permissions).forEach(function (k) { selected[k] = true; });

    const boxes = {};
    P.MODULES.forEach(function (m) {
      const label = el('label', 'perm-item');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!selected[m.key];
      boxes[m.key] = cb;
      label.appendChild(cb);
      const text = el('span', 'perm-item-text');
      text.appendChild(el('span', 'perm-item-name', m.label));
      text.appendChild(el('span', 'perm-item-desc', m.desc));
      label.appendChild(text);
      grid.appendChild(label);
    });
    box.appendChild(grid);

    const bar = el('div', 'toolbar');
    bar.style.marginTop = '8px';
    // 「未设置 = 全部功能」与「显式空数组 = 什么都不给」是两回事，
    // 这里给一个明确的「恢复默认（全部功能）」按钮，避免用户以为取消勾选就等于默认
    const allBtn = el('button', 'btn btn-sm', '全选');
    allBtn.addEventListener('click', function () {
      Object.keys(boxes).forEach(function (k) { boxes[k].checked = true; });
    });
    const noneBtn = el('button', 'btn btn-sm', '全不选');
    noneBtn.addEventListener('click', function () {
      Object.keys(boxes).forEach(function (k) { boxes[k].checked = false; });
    });
    const resetBtn = el('button', 'btn btn-sm', '恢复默认（全部功能）');
    resetBtn.title = '把权限设回「未设置」，等同全部功能（新账号的默认状态）';
    resetBtn.addEventListener('click', function () {
      patchUser(u, { permissions: null }, '已把「' + u.username + '」的权限恢复为默认（全部功能）');
    });
    const saveBtn = el('button', 'btn btn-primary btn-sm', '保存权限');
    saveBtn.addEventListener('click', function () {
      const list = P.MODULES.filter(function (m) { return boxes[m.key].checked; })
        .map(function (m) { return m.key; });
      patchUser(u, { permissions: list }, '已更新「' + u.username + '」的功能权限：' + P.permissionSummary(list));
    });
    bar.appendChild(allBtn);
    bar.appendChild(noneBtn);
    bar.appendChild(saveBtn);
    bar.appendChild(resetBtn);
    box.appendChild(bar);

    const warn = el('div', 'item-meta',
      '提示：取消勾选后对方界面上会隐藏对应功能，并且立即生效、无需重新登录。');
    warn.style.marginTop = '6px';
    box.appendChild(warn);

    return box;
  }

  function patchUser(u, patch, successMsg) {
    window.API.adminUpdateUser(u.id, patch).then(function () {
      window.Toast.success(successMsg);
      // 改到自己时角色/权限变了，需要重算「是否管理员」，因此刷新登录态
      return window.API.syncStatus().then(function (st) { state.status = st; });
    }).then(function () {
      load(true);
    }).catch(function (e) {
      window.Toast.error('操作失败：' + (e && e.message ? e.message : e));
    });
  }

  function openCreateForm() {
    const body = el('div');
    const rows = {};
    [['username', '用户名 *', 'text'], ['displayName', '显示名（可选）', 'text'],
      ['password', '密码 *（至少 6 位）', 'password']].forEach(function (p) {
      const row = el('div', 'form-row');
      row.appendChild(el('label', null, p[1]));
      const input = el('input');
      input.type = p[2];
      row.appendChild(input);
      body.appendChild(row);
      rows[p[0]] = input;
    });

    const roleRow = el('div', 'form-row');
    roleRow.appendChild(el('label', null, '角色'));
    const roleSel = el('select');
    roleSel.appendChild((function () { const o = el('option'); o.value = 'user'; o.textContent = '普通用户'; return o; })());
    roleSel.appendChild((function () { const o = el('option'); o.value = 'admin'; o.textContent = '管理员'; return o; })());
    roleRow.appendChild(roleSel);
    body.appendChild(roleRow);

    body.appendChild(el('div', 'item-meta', '新建后可在列表里逐项勾选该账号能使用的功能。默认给全部功能。'));

    window.Modal.open({
      title: '新建账号',
      content: body,
      okText: '创建',
      onOk: function () {
        const username = rows.username.value.trim();
        const password = rows.password.value;
        if (!username) { window.Toast.error('请填写用户名'); return false; }
        if (password.length < 6) { window.Toast.error('密码至少 6 位'); return false; }
        window.API.adminCreateUser({
          username: username,
          password: password,
          displayName: rows.displayName.value.trim(),
          role: roleSel.value,
        }).then(function () {
          window.Toast.success('已创建账号「' + username + '」');
          load(true);
        }).catch(function (e) {
          window.Toast.error('创建失败：' + (e && e.message ? e.message : e));
        });
        return true;
      },
    });
  }

  function openPasswordForm(u) {
    const body = el('div');
    body.appendChild(el('div', 'item-meta', '为「' + u.username + '」设置新密码。改完后对方需用新密码登录。'));
    const row = el('div', 'form-row');
    row.appendChild(el('label', null, '新密码（至少 6 位）'));
    const input = el('input');
    input.type = 'password';
    row.appendChild(input);
    body.appendChild(row);

    window.Modal.open({
      title: '重置密码',
      content: body,
      okText: '保存',
      onOk: function () {
        if (input.value.length < 6) { window.Toast.error('密码至少 6 位'); return false; }
        patchUser(u, { password: input.value }, '已重置「' + u.username + '」的密码');
        return true;
      },
    });
  }

  function confirmDelete(u) {
    const body = el('div');
    body.appendChild(el('div', 'item-meta',
      '确定删除账号「' + u.username + '」？'));
    const warn = el('div', 'item-meta',
      '该账号的 ' + (u.recordCount || 0) + ' 条同步数据会一起被删除，且**无法恢复**。' +
      '如果只是想让对方暂时不能用，建议改用「停用账号」。');
    warn.style.marginTop = '8px';
    warn.style.color = 'var(--danger)';
    body.appendChild(warn);

    window.Modal.open({
      title: '删除账号',
      content: body,
      okText: '确认删除',
      onOk: function () {
        window.API.adminDeleteUser(u.id).then(function (res) {
          window.Toast.success('已删除账号（连带 ' + ((res && res.removedRecords) || 0) + ' 条数据）');
          load(true);
        }).catch(function (e) {
          window.Toast.error('删除失败：' + (e && e.message ? e.message : e));
        });
        return true;
      },
    });
  }

  function load(showLoading) {
    state.loading = true;
    state.error = '';
    if (showLoading) render(); // 立刻画出「正在加载…」，避免看着像卡住
    window.API.syncStatus().then(function (st) {
      state.status = st;
      if (!st.loggedIn) return null;
      if (!st.isAdmin) return null;
      return window.API.adminListUsers().then(function (res) {
        state.users = (res && res.users) || [];
        if (res && Array.isArray(res.modules) && res.modules.length) state.modules = res.modules;
        state.meId = res && res.me;
        // 概览里带「超级管理员是否仍在用默认密码」，用于顶部安全告警
        return window.API.adminOverview().then(function (ov) {
          state.overview = ov || null;
        }).catch(function () { state.overview = null; });
      });
    }).catch(function (e) {
      state.error = (e && e.message) ? e.message : String(e);
    }).then(function () {
      state.loading = false;
      // 无论成功失败都标记「已加载」，否则失败时每次重绘都会再自动重试，形成循环
      state.loaded = true;
      render();
    });
  }

  // 供设置页/其他地方调用：登录状态变化后刷新本页
  function refresh() { load(true); }

  return { render: render, refresh: refresh };
})();
