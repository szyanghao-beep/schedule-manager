/*
 * permissions.js — 角色 / 账号状态 / 功能权限模型（桌面端 / 手机端 / 服务端 / 测试共用）
 *
 * 为什么单独成模块：
 *   权限判定如果三端各写一份，迟早出现「后端说没权限、界面还给点」这类不一致。
 *   这里只放纯函数与常量，服务端用它校验、客户端用它决定显示什么。
 *
 * 约定：
 *   - 角色（role）：'admin' 管理员 | 'user' 普通用户
 *   - 状态（status）：'active' 启用 | 'disabled' 停用（停用后拒绝登录、已发出的 token 也失效）
 *   - 权限（permissions）：功能模块 key 的数组。**空字符串/null 表示「未设置」= 全部模块**，
 *     而 `[]`（显式空数组）表示「一个模块都不给」。
 *     这个区分很重要：老版本建的账号没有该字段，必须默认可用，不能被当成"什么都没权限"。
 *   - 设置（settings）永远可用：否则用户连改密码/看引导都进不去。
 *   - 用户管理（admin）不进权限列表，只由角色决定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PermUtil = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROLE = { ADMIN: 'admin', USER: 'user' };
  var ROLE_LABEL = { admin: '管理员', user: '普通用户' };

  var STATUS = { ACTIVE: 'active', DISABLED: 'disabled' };
  var STATUS_LABEL = { active: '启用', disabled: '已停用' };

  // 可授权的功能模块（与渲染层的视图 key 一一对应）
  var MODULES = [
    { key: 'schedule', label: '日程', desc: '日历视图、日程新建与编辑' },
    { key: 'todo', label: '待办', desc: '待办清单、四象限、重复任务' },
    { key: 'customer', label: '客户商机', desc: '客户档案、金额流水、跟进记录' },
    { key: 'plan', label: '今日规划', desc: '按耗时把待办排成时间块' },
    { key: 'inbox', label: '收件箱', desc: '随手收集与整理（含手机端直传）' },
    { key: 'review', label: '周回顾', desc: '本周完成/新增/逾期汇总' },
    { key: 'memorials', label: '纪念日', desc: '生日、纪念日（支持农历）' },
    { key: 'bookkeeping', label: '记账', desc: '账户、流水、报表、预算' },
    { key: 'search', label: '搜索', desc: '全文检索日程与待办' },
    { key: 'stats', label: '统计', desc: '完成率、四象限分布、趋势' },
  ];

  var ALL_MODULE_KEYS = MODULES.map(function (m) { return m.key; });

  // 始终可用、不受权限控制的模块
  var ALWAYS_ALLOWED = ['settings'];

  function moduleLabel(key) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].key === key) return MODULES[i].label;
    }
    return key;
  }

  function normalizeRole(role) {
    return role === ROLE.ADMIN ? ROLE.ADMIN : ROLE.USER;
  }

  function normalizeStatus(status) {
    return status === STATUS.DISABLED ? STATUS.DISABLED : STATUS.ACTIVE;
  }

  function isAdmin(user) {
    return !!user && normalizeRole(user.role) === ROLE.ADMIN;
  }

  function isActive(user) {
    return !!user && normalizeStatus(user.status) === STATUS.ACTIVE;
  }

  // 全部模块（新建普通用户的默认权限）
  function defaultPermissions() {
    return ALL_MODULE_KEYS.slice();
  }

  // 把任意输入（数组 / JSON 字符串 / 逗号分隔串）规整成合法权限数组。
  // 未知 key 直接丢弃——避免把拼错的 key 存进库，之后永远匹配不上。
  function sanitizePermissions(raw) {
    var list = raw;
    if (typeof list === 'string') {
      var s = list.trim();
      if (!s) return [];
      if (s.charAt(0) === '[') {
        try { list = JSON.parse(s); } catch (e) { return []; }
      } else {
        list = s.split(',');
      }
    }
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    // 按 MODULES 的顺序输出，保证前后端与界面展示顺序稳定
    ALL_MODULE_KEYS.forEach(function (k) {
      if (list.indexOf(k) >= 0 && !seen[k]) { seen[k] = true; out.push(k); }
    });
    return out;
  }

  // 解析「可能未设置」的权限字段：未设置 → 全部模块；已设置 → 按设置来（可能是空数组）
  function resolvePermissions(raw) {
    if (raw == null) return defaultPermissions();
    if (typeof raw === 'string' && raw.trim() === '') return defaultPermissions();
    if (Array.isArray(raw) && raw.length === 0) return []; // 显式空数组 = 什么模块都不给
    return sanitizePermissions(raw);
  }

  // 该权限集合能否访问某模块
  function canAccess(rawPermissions, moduleKey) {
    if (!moduleKey) return true;
    if (ALWAYS_ALLOWED.indexOf(moduleKey) >= 0) return true;
    return resolvePermissions(rawPermissions).indexOf(moduleKey) >= 0;
  }

  // 序列化（存库/传输统一用 JSON 字符串；空数组存 '[]'，不存 ''）
  function serializePermissions(raw) {
    return JSON.stringify(sanitizePermissions(raw));
  }

  function permissionSummary(rawPermissions) {
    var list = resolvePermissions(rawPermissions);
    if (list.length === ALL_MODULE_KEYS.length) return '全部功能';
    if (!list.length) return '无功能权限';
    return list.map(moduleLabel).join('、');
  }

  return {
    ROLE: ROLE,
    ROLE_LABEL: ROLE_LABEL,
    STATUS: STATUS,
    STATUS_LABEL: STATUS_LABEL,
    MODULES: MODULES,
    ALL_MODULE_KEYS: ALL_MODULE_KEYS,
    ALWAYS_ALLOWED: ALWAYS_ALLOWED,
    moduleLabel: moduleLabel,
    normalizeRole: normalizeRole,
    normalizeStatus: normalizeStatus,
    isAdmin: isAdmin,
    isActive: isActive,
    defaultPermissions: defaultPermissions,
    sanitizePermissions: sanitizePermissions,
    resolvePermissions: resolvePermissions,
    canAccess: canAccess,
    serializePermissions: serializePermissions,
    permissionSummary: permissionSummary,
  };
}));
