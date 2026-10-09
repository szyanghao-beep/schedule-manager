/*
 * ui-audit.js — 界面交付审计（真实 Electron + 真实渲染层）
 *
 * 目的：把「UI 设计问题」变成**可自动发现**的问题，而不是等用户截图反馈。
 * 用户已经因为界面问题返工多次（元素创建了没挂到页面、按钮点不到、
 * 卡片被裁掉、窄窗口下内容挤成一团、错误提示看不清……），所以这里按
 * 「多种窗口宽度 × 全部视图 × 真实数据」逐个视图做静态体检：
 *
 *   1. 整页横向滚动（documentElement.scrollWidth > clientWidth）
 *   2. 元素超出内容区右边界，且祖先里没有可横向滚动的容器（用户根本看不到）
 *   3. overflow:hidden 把内容裁掉（scrollHeight/scrollWidth 大于可视区）
 *   4. 可点击元素太小 / 不可见（点不到）
 *   5. 文字对比度过低（看不清）
 *   6. 视图渲染时抛出异常、渲染完为空
 *
 * 另外会把每个视图截图存到临时目录，便于人工复看（DOM 检查抓不到「难看」）。
 *
 * 运行：npx electron scripts/ui-audit.js   （或 npm run audit:ui）
 * 退出码：0 = 未发现错误；1 = 有错误（warning 不影响退出码）
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = path.join(os.tmpdir(), 'schedule-uiaudit-' + Date.now());
process.env.SCHEDULE_USER_DATA_DIR = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const shotDir = path.join(os.tmpdir(), 'schedule-uiaudit-shots');
fs.mkdirSync(shotDir, { recursive: true });

const { app, BrowserWindow } = require('electron');
require('../main.js');

// 审计用窗口宽度：覆盖常见显示器到「小窗口／分屏」
const WIDTHS = [1440, 1200, 1000, 820];
const HEIGHT = 820;
const VIEWS = ['schedule', 'todo', 'customer', 'plan', 'inbox', 'review',
  'memorials', 'bookkeeping', 'search', 'stats', 'settings', 'admin'];

let errors = 0;
let warnings = 0;

// 在渲染层里执行的审计函数（字符串化后注入）
const AUDIT_FN = `
window.__UA = (function () {
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function auditPage() {
  const out = { kinds: {}, counts: {}, examples: {} };
  const content = document.querySelector('.content');
  const cRect = content ? content.getBoundingClientRect() : { right: window.innerWidth, bottom: window.innerHeight };

  function sig(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (typeof el.className === 'string' ? el.className : '').trim();
    if (cls) s += '.' + cls.split(/\\s+/).slice(0, 2).join('.');
    return s;
  }
  function add(kind, el, detail) {
    out.counts[kind] = (out.counts[kind] || 0) + 1;
    const key = kind + ' | ' + sig(el);
    out.kinds[key] = (out.kinds[key] || 0) + 1;
    if (!out.examples[key]) {
      out.examples[key] = (detail || '') + ' @' + sig(el) +
        (el.parentElement ? ' in ' + sig(el.parentElement) : '');
    }
  }
  function shown(el) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return false;
    if (el.hasAttribute('hidden')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  }
  // 祖先里是否有可横向滚动的容器（有的话内容只是「需要滚动」，不算丢）
  function xScrollable(el) {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const st = getComputedStyle(n);
      if (st.overflowX === 'auto' || st.overflowX === 'scroll') return true;
      n = n.parentElement;
    }
    return false;
  }
  // 有效背景色（向上找不透明的背景）
  function bgOf(el) {
    let n = el;
    while (n) {
      const c = getComputedStyle(n).backgroundColor;
      const m = c.match(/rgba?\\(([^)]+)\\)/);
      if (m) {
        const p = m[1].split(',').map(function (x) { return parseFloat(x); });
        if (p.length < 4 || p[3] >= 0.95) return [p[0], p[1], p[2]];
      }
      n = n.parentElement;
    }
    return [255, 255, 255];
  }
  function lum(rgb) {
    const a = rgb.map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function parseColor(c) {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    return m[1].split(',').map(function (x) { return parseFloat(x); });
  }

  // 1) 整页横向滚动
  const de = document.documentElement;
  const docOver = de.scrollWidth - de.clientWidth;
  out.docOverflowX = docOver;
  if (docOver > 1) {
    out.counts['整页横向滚动'] = 1;
    out.examples['整页横向滚动'] = '超出 ' + docOver + 'px（窗口 ' + window.innerWidth + 'px）';
  }
  // 内容区横向溢出（>24px 才算「挤」）
  const cOver = content ? content.scrollWidth - content.clientWidth : 0;
  out.contentOverflowX = cOver;

  const all = document.querySelectorAll('.view.active *');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!shown(el)) continue;
    // SVG（图表）里的 text 尺寸由 viewBox 缩放决定，按 CSS 盒模型判断会误报
    if (typeof SVGElement !== 'undefined' && el instanceof SVGElement) continue;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    // 2) 超出内容区右边界且无处可滚
    if (r.right > cRect.right + 4 && !xScrollable(el)) {
      add('溢出右边界(看不到)', el, 'right=' + Math.round(r.right) + ' > ' + Math.round(cRect.right));
    }
    // 3) overflow:hidden 裁掉内容
    const clipY = st.overflowY === 'hidden' || st.overflowY === 'clip';
    const clipX = st.overflowX === 'hidden' || st.overflowX === 'clip';
    if (clipY && el.scrollHeight > el.clientHeight + 6) {
      add('内容被纵向裁掉', el, 'scrollH=' + el.scrollHeight + ' clientH=' + el.clientHeight);
    }
    if (clipX && el.scrollWidth > el.clientWidth + 6 && st.textOverflow !== 'ellipsis') {
      add('内容被横向裁掉(无省略号)', el, 'scrollW=' + el.scrollWidth + ' clientW=' + el.clientWidth);
    }
    // 3b) nowrap 且不可裁 → 文字会压到别的元素上
    if (st.whiteSpace === 'nowrap' && st.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 4) {
      add('文字撑破容器', el, 'scrollW=' + el.scrollWidth + ' clientW=' + el.clientWidth);
    }

    // 4) 可点击元素太小
    const clickable = el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button';
    if (clickable && (r.width < 18 || r.height < 14)) {
      add('可点击元素过小', el, Math.round(r.width) + 'x' + Math.round(r.height));
    }

    // 5) 对比度（只看直接含文字的叶子节点）
    const hasDirectText = Array.prototype.some.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.textContent.trim().length > 1;
    });
    if (hasDirectText && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
      const fg = parseColor(st.color);
      if (fg && (fg.length < 4 || fg[3] >= 0.9)) {
        const ratio = contrast(fg.slice(0, 3), bgOf(el));
        if (ratio < 2.6) {
          add('文字对比度过低', el, '对比度 ' + ratio.toFixed(2) + '（' + st.color + '）');
        }
      }
    }
  }
  out.viewHtmlLen = (document.querySelector('.view.active') || {}).innerHTML
    ? document.querySelector('.view.active').innerHTML.length : 0;
  out.activeView = (document.querySelector('.view.active') || {}).id || '';
  return out;
  }

  // 审计一个「弹窗」容器（弹窗是 UI 问题高发区，必须单独体检）
  function auditRoot(sel) {
    const root = document.querySelector(sel);
    if (!root) return null;
    const out = { kinds: {}, counts: {}, examples: {}, rootFound: true, len: root.innerHTML.length, docOverflowX: 0 };
    const nodes = root.querySelectorAll('*');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (typeof SVGElement !== 'undefined' && el instanceof SVGElement) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      function add(kind, detail) {
        out.counts[kind] = (out.counts[kind] || 0) + 1;
        const key = kind + ' | ' + el.tagName.toLowerCase() +
          (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '');
        out.kinds[key] = (out.kinds[key] || 0) + 1;
        if (!out.examples[key]) out.examples[key] = (detail || '') + ' @' + key;
      }
      // 祖先里有可纵向滚动的容器时，元素超出视口是正常的（滚动就能看到），
      // 只有「滚动也够不着」（比如被顶出窗口的弹窗底栏按钮）才算问题
      function yScrollable(node) {
        let n = node.parentElement;
        while (n && n !== root.parentElement) {
          const s = getComputedStyle(n);
          if (s.overflowY === 'auto' || s.overflowY === 'scroll') return true;
          n = n.parentElement;
        }
        return false;
      }
      // 弹窗内容超出窗口（超出后按钮点不到 —— 这正是用户会骂的那类问题）
      if (!yScrollable(el) && (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1)) {
        add('弹窗内容超出窗口', 'right=' + Math.round(r.right) + ' bottom=' + Math.round(r.bottom) +
          ' 窗口=' + window.innerWidth + 'x' + window.innerHeight);
      }
      if (st.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 6) {
        add('弹窗内容被裁掉', 'scrollH=' + el.scrollHeight + ' clientH=' + el.clientHeight);
      }
      const clickable = el.tagName === 'BUTTON' || el.tagName === 'A';
      if (clickable && (r.width < 18 || r.height < 14)) add('弹窗按钮过小', Math.round(r.width) + 'x' + Math.round(r.height));
      // 内容比容器高却设了 overflow:hidden（内容被裁掉、又没有滚动条）→ 信息直接丢失
      if (st.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 6 && el.clientHeight > 0) {
        add('弹窗内容被裁掉且不可滚动', 'scrollH=' + el.scrollHeight + ' clientH=' + el.clientHeight);
      }
    }
    return out;
  }

  // 打开指定视图（并等渲染）
  async function open(view) {
    window.Guide.closeTip();
    window.App.switchView(view);
    await sleep(220);
    return (document.querySelector('.view.active') || {}).id || '';
  }

  // 该视图里可切换的子状态（分段按钮的索引 + 文案）
  function subStates(view) {
    const root = document.getElementById('view-' + view);
    if (!root) return [];
    return Array.prototype.map.call(root.querySelectorAll('.seg-btn'), function (b, i) {
      return { i: i, label: b.textContent.trim() };
    });
  }
  function segCount(view) {
    const root = document.getElementById('view-' + view);
    return root ? root.querySelectorAll('.seg-btn').length : 0;
  }
  function clickSeg(view, idx) {
    const root = document.getElementById('view-' + view);
    const b = root && root.querySelectorAll('.seg-btn')[idx];
    if (b) b.click();
  }
  // 搜索页要有结果才有意义（空页面审计不出排版问题）
  function fillSearch(q) {
    const root = document.getElementById('view-search');
    const input = root && root.querySelector('input[type="text"]');
    if (!input) return false;
    input.value = q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  // 打开该视图的第一个「新增/添加/编辑」弹窗；返回是否打开
  function openFirstModal(view) {
    const root = document.getElementById('view-' + view);
    if (!root) return false;
    const btn = Array.prototype.find.call(root.querySelectorAll('button'), function (b) {
      // 按钮文案常带前缀（「+ 新增客户」「+ 记一笔」），所以不能锚定开头
      return /(新增|添加|记一笔|导入|新建)/.test(b.textContent.trim()) && !b.disabled &&
        b.offsetParent !== null;
    });
    if (!btn) return false;
    btn.click();
    return !!document.querySelector('#modal-root .modal');
  }
  function closeModal() {
    const c = document.querySelector('#modal-root .modal-close');
    if (c) c.click();
    else window.Modal.close();
  }
  // 管理员视图需要管理员登录态（否则 switchView 会被挡回上一个视图）
  function loginAsAdmin(on) {
    if (on) {
      window.__UA._saved = { syncStatus: window.API.syncStatus, list: window.API.adminListUsers, ov: window.API.adminOverview };
      window.API.syncStatus = function () {
        return Promise.resolve({ serverUrl: 'http://192.168.0.106:8787', loggedIn: true, lastPulledAt: 0,
          lastPushedAt: 0, userId: 1, username: 'audit-admin', role: 'admin', isAdmin: true,
          permissions: ['schedule','todo','customer','plan','inbox','review','memorials','bookkeeping','search','stats'] });
      };
      window.API.adminListUsers = function () {
        return Promise.resolve({ users: [
          { id: 9, username: 'admin', displayName: '超级管理员', role: 'super', status: 'active',
            permissions: [], createdAt: Date.now(), lastLoginAt: Date.now(), recordCount: 0, isSelf: false },
          { id: 1, username: 'audit-admin', displayName: '审计管理员', role: 'admin', status: 'active',
            permissions: [], createdAt: Date.now(), lastLoginAt: Date.now(), recordCount: 12, isSelf: true },
          { id: 2, username: 'verylongusername-for-layout-test', displayName: '一个名字特别长的普通用户用于测试布局',
            role: 'user', status: 'disabled', permissions: ['todo','stats'], createdAt: Date.now(),
            lastLoginAt: 0, recordCount: 3, isSelf: false },
        ], me: 1 });
      };
      window.API.adminOverview = function () {
        return Promise.resolve({ totalUsers: 3, activeUsers: 2, disabledUsers: 1, adminUsers: 2,
          totalRecords: 15, superAdmin: { exists: true, username: 'admin', status: 'active', usingDefaultPassword: true } });
      };
      return window.App.refreshAccess();
    }
    if (window.__UA._saved) {
      window.API.syncStatus = window.__UA._saved.syncStatus;
      window.API.adminListUsers = window.__UA._saved.list;
      window.API.adminOverview = window.__UA._saved.ov;
    }
    return window.App.refreshAccess();
  }

  return { auditPage: auditPage, auditRoot: auditRoot, open: open, subStates: subStates,
    segCount: segCount, clickSeg: clickSeg, fillSearch: fillSearch,
    openFirstModal: openFirstModal, closeModal: closeModal, loginAsAdmin: loginAsAdmin };
})();
`;

async function main() {
  await app.whenReady();
  await new Promise(function (r) { setTimeout(r, 2500); });

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('✘ 未创建主窗口'); app.exit(1); return; }

  const rendererErrors = [];
  win.webContents.on('console-message', function (event) {
    const level = event && event.level;
    if (level === 'error' || level === 3) rendererErrors.push(event.message);
  });

  // 关掉新手引导遮罩（引导有自己的冒烟测试，这里要看的是它后面的界面）
  // 并灌入「会长」的数据：长标题、多条目、金额、纪念日……窄窗口最容易暴露问题
  await win.webContents.executeJavaScript(`(async function () {
    try {
      window.localStorage.setItem('schedule.guide.v1', JSON.stringify({
        doneVersion: 99,
        dismissedTips: { schedule:1, todo:1, customer:1, plan:1, inbox:1, review:1,
          memorials:1, bookkeeping:1, search:1, stats:1, settings:1, admin:1 },
      }));
    } catch (e) {}
    if (window.Guide && window.Guide.closeTip) window.Guide.closeTip();
    document.getElementById('modal-root').innerHTML = '';

    const S = window.Store;
    const now = Date.now();
    const day = 86400000;
    const LONG = '季度复盘与客户回访安排（含跨部门协调会议纪要整理与后续跟进事项分配）';
    // 注意：一定要用**本地日期**。用 toISOString() 会得到 UTC 日期，
    // 在月初/月末会和本地月份错开一天，导致「本月流水」被过滤成空
    // （审计数据出错会让人误以为界面有 bug，白查一轮）。
    function localDate(ts) {
      const d = new Date(ts);
      const p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function localMonth(ts) {
      const d = new Date(ts);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    S.addCategory({ id: 'seed-cat-1', name: '工作', color: '#4c8dff' });
    S.addCategory({ id: 'seed-cat-2', name: '生活', color: '#41c98a' });

    for (let i = 0; i < 8; i++) {
      S.addEvent({
        id: 'seed-ev-' + i, title: i === 0 ? LONG : ('示例日程 ' + i),
        description: '描述文本', allDay: false, status: 'pending',
        startTime: now + i * 3600000, endTime: now + i * 3600000 + 3600000,
        priority: 'medium', categoryId: 'seed-cat-1', categoryName: '工作', categoryColor: '#4c8dff',
        repeat: { type: 'none', interval: 1, endDate: null }, remindBefore: 0, reminds: [],
        createdAt: now, updatedAt: now,
      });
    }
    for (let i = 0; i < 10; i++) {
      S.addTodo({
        id: 'seed-td-' + i, title: i === 1 ? LONG : ('待办事项 ' + i), description: '',
        status: i % 4 === 0 ? 'done' : 'pending', completedAt: null,
        createdAt: now, updatedAt: now,
        deadline: i < 4 ? now + i * day : null, priority: ['high','medium','low'][i % 3],
        categoryId: 'seed-cat-1', categoryName: '工作', categoryColor: '#4c8dff',
        importance: i % 2 ? 'important' : 'urgent', repeat: { type: 'none', interval: 1, endDate: null },
        reminds: [], remindBefore: 0, remindAt: null, estimatedMinutes: 30,
      });
    }
    for (let i = 0; i < 6; i++) {
      const c = S.addCustomer({
        id: 'seed-cu-' + i,
        name: i === 0 ? '某某某集团股份有限公司（华东大区重点客户）' : ('客户' + i),
        company: i === 0 ? '某某某集团股份有限公司华东大区事业部' : ('第' + i + '家公司'),
        contact: '张经理', phone: '1380000000' + i, owner: i % 2 ? '王五' : '张三',
        stage: ['lead','contacted','proposal','negotiation','won','lost'][i],
        remark: '备注：客户希望下季度初完成验收，需要技术团队配合做一次现场演示。',
      });
      S.addCustomerAmount(c.id, { kind: 'estimate', amount: 100000 * (i + 1) });
    }
    S.recordFollowup('seed-cu-0', { content: '电话沟通了需求和预算，对方希望下周看方案', at: now, nextAt: now + day });
    S.recordFollowup('seed-cu-0', { content: '已发送方案初稿，等待反馈', at: now - day, nextAt: now + 3 * day });

    S.addMemorial({ id: 'seed-mem-1', title: '结婚纪念日', date: '2019-05-20', type: 'anniversary', lunar: false, remindBefore: 3 });
    S.addMemorial({ id: 'seed-mem-2', title: '父亲生日（农历）', date: '1962-08-15', type: 'birthday', lunar: true, remindBefore: 1 });

    S.addAccount({ id: 'seed-acc-1', name: '招商银行储蓄卡', type: 'bank', balance: 125000.5, currency: 'CNY' });
    S.addAccount({ id: 'seed-acc-2', name: '支付宝', type: 'alipay', balance: 3200, currency: 'CNY' });
    S.addBookkeepingCategory({ id: 'seed-bkc-1', name: '餐饮', type: 'expense', color: '#ff7a45' });
    S.addBookkeepingCategory({ id: 'seed-bkc-2', name: '工资', type: 'income', color: '#41c98a' });
    for (let i = 0; i < 12; i++) {
      S.addTransaction({
        id: 'seed-tx-' + i, type: i % 5 === 0 ? 'income' : 'expense',
        amount: 50 + i * 33.5, categoryId: i % 5 === 0 ? 'seed-bkc-2' : 'seed-bkc-1',
        accountId: 'seed-acc-1', date: localDate(now - i * day),
        note: i === 0 ? '一笔备注特别长的支出记录用于测试窄窗口下的排版是否会被裁掉' : ('流水 ' + i),
      });
    }
    S.addBudget({ id: 'seed-bg-1', month: localMonth(now), amount: 5000, categoryId: 'seed-bkc-1' });
    return true;
  })()`);

  console.log('== 界面交付审计（窗口宽度 ' + WIDTHS.join(' / ') + '）==\n');

  const js = function (code) { return win.webContents.executeJavaScript(code); };

  // 收集一个状态的审计结果并打印
  const report = [];
  function collect(width, view, state, a, extra) {
    const problems = Object.keys(a.kinds || {});
    const isError = (a.viewError != null) || a.docOverflowX > 1 || a.viewHtmlLen < 30 ||
      problems.some(function (k) {
        return k.indexOf('溢出右边界') === 0 || k.indexOf('内容被') === 0 ||
          k.indexOf('可点击元素过小') === 0 || k.indexOf('文字撑破') === 0 ||
          k.indexOf('弹窗内容超出窗口') === 0 || k.indexOf('弹窗内容被裁') === 0 ||
          k.indexOf('弹窗按钮过小') === 0;
      });
    if (isError) errors++;
    if (problems.length) warnings++;
    report.push({ width: width, view: view, state: state, r: a, isError: isError });

    const tag = isError ? '✘' : (problems.length ? '△' : '✔');
    let line = '  ' + tag + ' ' + String(width).padStart(4) + 'px  ' + (view + (state ? '/' + state : '')).padEnd(22) +
      ' 长度' + String(a.viewHtmlLen || 0).padStart(5) +
      ' 横向溢出' + a.docOverflowX + 'px';
    if (a.viewError) line += '  ⚠ 渲染异常: ' + a.viewError;
    if (extra) line += '  ' + extra;
    console.log(line);
    Object.keys(a.kinds || {}).forEach(function (k) {
      console.log('        · ' + k + ' ×' + a.kinds[k] + (a.examples[k] ? '  例：' + a.examples[k] : ''));
    });
  }

  // 注意：注入的脚本最后必须返回可结构化克隆的值（window.__UA 里有函数，
  // 直接返回会报 "An object could not be cloned"），所以补一个 0。
  await js(AUDIT_FN + '\n0;');
  let adminOn = false;

  for (const w of WIDTHS) {
    win.setContentSize(w, HEIGHT);
    await new Promise(function (r) { setTimeout(r, 400); });

    for (const v of VIEWS) {
      // 用户管理页需要管理员登录态，否则 switchView 会被挡回上一个视图
      if (v === 'admin' && !adminOn) { await js('window.__UA.loginAsAdmin(true)'); adminOn = true; }

      let activeId = null, err = null;
      try {
        activeId = await js('window.__UA.open(' + JSON.stringify(v) + ')');
      } catch (e) { err = String(e && e.message || e); }

      const a0 = await js('window.__UA.auditPage()');
      a0.viewError = err;
      collect(w, v, '', a0, activeId === 'view-' + v ? '' : '⚠ 实际停在 ' + activeId);

      // 分段按钮（月/周/日/列表、记账的分页签、统计的维度切换）逐个切过去审
      const segs = await js('window.__UA.subStates(' + JSON.stringify(v) + ')');
      for (const s of segs) {
        await js('window.__UA.clickSeg(' + JSON.stringify(v) + ',' + s.i + ')');
        await new Promise(function (r) { setTimeout(r, 200); });
        const a = await js('window.__UA.auditPage()');
        collect(w, v, '页签:' + s.label, a);
      }
      if (segs.length) {
        await js('window.__UA.clickSeg(' + JSON.stringify(v) + ',0)');
        await new Promise(function (r) { setTimeout(r, 150); });
      }

      // 搜索页：空页面审不出排版问题，填个关键词再看有结果的形态
      if (v === 'search') {
        const ok = await js('window.__UA.fillSearch("客户")');
        await new Promise(function (r) { setTimeout(r, 250); });
        const a = await js('window.__UA.auditPage()');
        collect(w, v, '有结果', a, ok ? '' : '⚠ 未找到搜索框');
      }
    }
  }

  // 弹窗体检：新增/编辑弹窗是 UI 问题高发区（字段多，窗口一矮按钮就跑出屏幕点不到）。
  // 特意用「矮窗口」再跑一遍 —— 这是真实用户会把窗口拉小的场景。
  for (const size of [{ w: 1200, h: 820 }, { w: 900, h: 560 }, { w: 900, h: 380 }]) {
    console.log('\n== 弹窗体检（' + size.w + '×' + size.h + '）==');
    win.setContentSize(size.w, size.h);
    await new Promise(function (r) { setTimeout(r, 400); });
    for (const v of VIEWS) {
      await js('window.__UA.open(' + JSON.stringify(v) + ')');
      let opened = false;
      try { opened = await js('window.__UA.openFirstModal(' + JSON.stringify(v) + ')'); } catch (e) {}
      if (!opened) { console.log('  · ' + v.padEnd(12) + ' 无「新增」弹窗可审（跳过）'); continue; }
      await new Promise(function (r) { setTimeout(r, 350); });
      const a = await js('window.__UA.auditRoot("#modal-root .modal")');
      if (a) {
        a.viewHtmlLen = a.len;
        collect(size.w, v, '弹窗@' + size.h, a);
      }
      // 弹窗底栏按钮必须真的在窗口内且可点（这才是「能提交」的前提）
      const footer = await js(`(function () {
        const btns = Array.prototype.slice.call(document.querySelectorAll('#modal-root .modal-footer button'));
        return { n: btns.length, outOfWindow: btns.filter(function (b) {
          const r = b.getBoundingClientRect();
          return r.bottom > window.innerHeight + 1 || r.top < -1 || r.right > window.innerWidth + 1;
        }).map(function (b) { return b.textContent.trim(); }) };
      })()`);
      if (footer.n && footer.outOfWindow.length) {
        console.log('  ✘ ' + v + ' 弹窗底栏按钮跑到窗口外（点不到）：' + footer.outOfWindow.join('、'));
        errors++;
      }
      await js('window.__UA.closeModal()');
      await new Promise(function (r) { setTimeout(r, 200); });
      const leftover = await js('!!document.querySelector("#modal-root .modal")');
      if (leftover) { console.log('  ✘ ' + v + ' 的弹窗关不掉（点 × 后仍然存在）'); errors++; }
    }
  }

  // 截图：DOM 检查抓不到「难看」，留下来人工复看。
  // 两种尺寸都截：标准窗口看整体观感，窄窗口最容易出现文字截断/贴边。
  const shots = [];
  for (const size of [{ w: 1200, h: HEIGHT, tag: 'w1200' }, { w: 820, h: 700, tag: 'w820' }]) {
    console.log('\n== 截图（' + size.w + '×' + size.h + '，存 ' + shotDir + '）==');
    win.setContentSize(size.w, size.h);
    await new Promise(function (r) { setTimeout(r, 400); });
    for (const v of VIEWS) {
      const active = await js('window.__UA.open(' + JSON.stringify(v) + ')');
      // 等两帧再截，否则 capturePage 可能拿到上一帧（会拍到上一个视图的画面，
      // 直接导致 OCR 复检张冠李戴）
      await js('new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); })');
      await new Promise(function (r) { setTimeout(r, 200); });
      if (active !== 'view-' + v) {
        console.log('  ⚠ ' + v + ' 截图前未能切换到该视图（当前 ' + active + '）');
        errors++;
      }
      const img = await win.webContents.capturePage();
      const p = path.join(shotDir, size.tag + '-' + v + '.png');
      fs.writeFileSync(p, img.toPNG());
      shots.push({ view: v + '@' + size.tag, file: p });
    }
    console.log('  共 ' + VIEWS.length + ' 张');
  }

  // 报错提示可读性：错误提示是用户唯一的「出事了」信号，
  // 必须看得清（对比度）、不被裁掉、不出窗口 —— 直接渲染四种提示再量一遍。
  console.log('\n== 报错/提示可读性（toast）==');
  win.setContentSize(1000, HEIGHT);
  await new Promise(function (r) { setTimeout(r, 300); });
  for (const kind of ['error', 'warning', 'success', 'info']) {
    const r = await js(`(function () {
      const t = window.Toast;
      window.__t = null;
      const fn = { error: 'error', warning: 'warning', success: 'success', info: 'info' }[${JSON.stringify(kind)}];
      t[fn]('这是一条较长的提示文案，用来检验提示条在窄窗口下会不会被裁掉、颜色是否看得清');
      const el = document.querySelector('#toast-root > *');
      if (!el) return { missing: true };
      const st = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        color: cs.color, bg: cs.backgroundColor,
        w: Math.round(rect.width), h: Math.round(rect.height),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
        clippedX: el.scrollWidth > el.clientWidth + 4,
        winW: window.innerWidth, winH: window.innerHeight,
        fontSize: parseFloat(cs.fontSize),
      };
    })()`);
    if (r.missing) { console.log('  ✘ ' + kind + ' 提示没有渲染出来（用户看不到提示）'); errors++; continue; }
    const bad = r.clippedX || r.right > r.winW + 1 || r.bottom > r.winH + 1 || r.fontSize < 11;
    if (bad) errors++;
    console.log('  ' + (bad ? '✘' : '✔') + ' ' + kind.padEnd(8) +
      ' 尺寸 ' + r.w + '×' + r.h + ' 字号 ' + r.fontSize +
      (r.clippedX ? '  ⚠ 文字被裁掉' : '') +
      (r.right > r.winW + 1 || r.bottom > r.winH + 1 ? '  ⚠ 超出窗口' : ''));
    await js('window.Toast && document.getElementById("toast-root") && (document.getElementById("toast-root").innerHTML = ""); true');
    await new Promise(function (r2) { setTimeout(r2, 120); });
  }

  // 截图 OCR 复检：DOM 看不到的问题（文字重叠、贴边被裁、报错文案留在界面上）
  // 用本机「看图解析工具」做，工具不存在时跳过（不让审计因此失败）
  const PY = 'E:\\DSH\\看图解析工具\\venv\\Scripts\\python.exe';
  const OCR_TOOL = 'E:\\DSH\\看图解析工具\\ui_analyzer.py';
  if (fs.existsSync(PY) && fs.existsSync(OCR_TOOL)) {
    console.log('\n== 截图 OCR 复检（重叠 / 贴边截断 / 残留报错文案）==');
    const pyScript = [
      'import sys, json',
      'sys.path.insert(0, ' + JSON.stringify(path.dirname(OCR_TOOL)) + ')',
      'import ui_analyzer',
      'out = []',
      'for item in json.loads(sys.argv[1]):',
      '    r = ui_analyzer.analyze(item["file"])',
      '    W = r["meta"]["width"]; H = r["meta"]["height"]',
      '    def edge(b):',
      '        x0, y0, x1, y1 = b["bbox"]',
      '        es = []',
      '        if x0 <= 3: es.append("left")',
      '        if x1 >= W - 3: es.append("right")',
      '        if y0 <= 3: es.append("top")',
      '        if y1 >= H - 3: es.append("bottom")',
      '        return es',
      '    out.append({"view": item["view"], "n": r["text_count"],',
      '                "overlaps": len(r["overlaps"]),',
      '                "trunc": [{"text": b["text"], "edges": edge(b)} for b in r["truncated"]],',
      '                "errs": r["error_messages"][:4], "text": r["full_text"][:400]})',
      'print(json.dumps(out, ensure_ascii=False))',
    ].join('\n');
    const res = require('child_process').spawnSync(PY, ['-c', pyScript, JSON.stringify(shots)], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 600000,
      // 必须显式指定 UTF-8：Windows 上 Python 默认按本地编码（GBK）写 stdout，
      // 读成 UTF-8 就会全是乱码，后面按关键词判断内容会全部误判
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
    });
    if (res.status !== 0 || !res.stdout) {
      console.log('  ⚠ OCR 复检未完成（跳过）：' + String(res.stderr || '').slice(0, 300));
    } else {
      let ocr = [];
      try { ocr = JSON.parse(res.stdout.trim().split('\n').pop()); } catch (e) {
        console.log('  ⚠ OCR 输出无法解析（跳过）：' + String(res.stdout).slice(0, 200));
      }
      ocr.forEach(function (o) {
        // 关键词表很宽（含「权限」「警告」），正常文案也会被命中；
        // 只把真正的运行期报错算作问题，其余的只打印出来人工看
        const realErrs = (o.errs || []).filter(function (e) {
          // 真正的报错文案都很短；说明性长句（如管理员页的功能介绍）会带「无法登录」，
          // 按长度过滤掉，避免把正常文案当成报错
          return e.length <= 40 && /失败|错误|无法|异常|崩溃|Error|Exception|invalid/i.test(e);
        });
        // 贴边要分方向看：
        //   左右贴边 = 文字被窗口横向截断（内容比窗口宽）→ 真问题；
        //   上下贴边 = 列表还能滚动（内容本来就会顶到视口边缘）→ 正常，只记一笔。
        const trunc = o.trunc || [];
        const sideClipped = trunc.filter(function (t) {
          return t.edges.indexOf('left') >= 0 || t.edges.indexOf('right') >= 0;
        });
        const vertical = trunc.filter(function (t) {
          return t.edges.indexOf('left') < 0 && t.edges.indexOf('right') < 0;
        });
        const bad = o.overlaps > 0 || sideClipped.length > 0 || realErrs.length > 0 || o.n < 3;
        if (bad) errors++;
        console.log('  ' + (bad ? '✘' : '✔') + ' ' + o.view.padEnd(14) +
          ' 文字块 ' + String(o.n).padStart(3) +
          '  重叠 ' + o.overlaps + '  横向截断 ' + sideClipped.length +
          (vertical.length ? '（另有 ' + vertical.length + ' 处纵向贴边=可滚动，正常）' : '') +
          (realErrs.length ? '  ⚠ 界面残留报错: ' + realErrs.join(' / ') : ''));
        sideClipped.slice(0, 3).forEach(function (t) {
          console.log('        · 被窗口横向截断的文字：' + JSON.stringify(t.text) + '（贴 ' + t.edges.join('+') + '）');
        });
        if (o.n < 3) console.log('        ⚠ 几乎没有文字，视图可能是空白的');
      });
      // 关键内容是否真的画出来了（防「页面渲染了但数据没显示」）
      const expect = {
        bookkeeping: '记一笔', customer: '客户', memorials: '纪念',
        schedule: '日程', todo: '待办', stats: '统计', settings: '设置',
      };
      ocr.forEach(function (o) {
        const view = String(o.view).split('@')[0];
        const want = expect[view];
        if (want && o.text.indexOf(want) < 0) {
          console.log('  ✘ ' + o.view + ' 截图上找不到关键词「' + want + '」，界面可能没渲染出内容');
          errors++;
        }
      });
    }
  } else {
    console.log('\n（跳过截图 OCR 复检：未找到看图解析工具）');
  }

  console.log('\n== 汇总 ==');
  const badViews = report.filter(function (x) { return x.isError; });
  console.log('  错误状态数: ' + badViews.length + ' / ' + report.length);
  if (badViews.length) {
    const seen = {};
    badViews.forEach(function (x) {
      Object.keys(x.r.kinds || {}).forEach(function (k) {
        if (!seen[k]) seen[k] = [];
        seen[k].push(x.width + 'px/' + x.view + (x.state ? '/' + x.state : ''));
      });
      if (x.r.docOverflowX > 1) {
        const k = '整页横向滚动 ' + x.r.docOverflowX + 'px';
        if (!seen[k]) seen[k] = [];
        seen[k].push(x.width + 'px/' + x.view);
      }
    });
    Object.keys(seen).forEach(function (k) {
      console.log('   ✘ ' + k + '  → ' + seen[k].slice(0, 6).join(', ') +
        (seen[k].length > 6 ? ' 等 ' + seen[k].length + ' 处' : ''));
    });
  }
  if (rendererErrors.length) {
    console.log('  渲染层错误日志 ' + rendererErrors.length + ' 条：');
    rendererErrors.slice(0, 5).forEach(function (m) { console.log('    · ' + m); });
  }

  // 警告类问题（不算错但影响观感/可读性），按类型汇总：这些也是「UI 设计问题」
  const warnMap = {};
  report.forEach(function (x) {
    Object.keys(x.r.kinds || {}).forEach(function (k) {
      if (x.isError) return;
      if (!warnMap[k]) warnMap[k] = { views: {}, total: 0 };
      warnMap[k].views[x.view] = (warnMap[k].views[x.view] || 0) + x.r.kinds[k];
      warnMap[k].total += x.r.kinds[k];
    });
  });
  const warnKeys = Object.keys(warnMap).sort(function (a, b) { return warnMap[b].total - warnMap[a].total; });
  if (warnKeys.length) {
    console.log('\n  观感/可读性警告（' + warnKeys.length + ' 类）：');
    warnKeys.forEach(function (k) {
      const w = warnMap[k];
      console.log('   △ ' + k + ' ×' + w.total + '  → ' +
        Object.keys(w.views).slice(0, 6).join(', '));
    });
  }

  // 审计脚本自身也要能跑出「有内容」的结果，否则说明审计根本没生效
  const totalLen = report.reduce(function (a, x) { return a + (x.r.viewHtmlLen || 0); }, 0);
  if (totalLen < 5000 || report.length < VIEWS.length) {
    console.log('✘ 审计结果异常：状态数 ' + report.length + '，内容长度合计 ' + totalLen +
      '，审计可能未真正执行');
    errors += 1;
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(errors === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('审计异常:', e);
  app.exit(1);
});
