/*
 * guide.js — 新手引导与功能提示（window.Guide）
 *
 * 目的：初学者打开后不知道每个功能是干什么的。这里提供两层帮助：
 *   1. 首次使用引导：一串步骤，讲清「这套工具怎么用」，可随时跳过；
 *   2. 功能提示卡：进入每个视图时弹出一个小卡片，解释这个功能是干什么的、
 *      有哪些关键操作；看过的可以「不再提示」，老用户也能一键全部关闭。
 *
 * 为什么状态存 localStorage 而不是 settings：
 *   settings 是**会同步**的实体。引导是否看过属于「这台设备上这个人的 UI 偏好」，
 *   不该跟着账号同步到其他设备（否则新设备上就看不到引导了）。
 *
 * 兼容性：所有状态读写都容错，localStorage 不可用时退化为「不记住」而不是报错。
 */
window.Guide = (function () {
  'use strict';

  var STORAGE_KEY = 'schedule.guide.v1';
  // 引导内容有实质更新时 +1，老用户会重新看到一次引导
  var GUIDE_VERSION = 1;

  // 每个视图的提示文案：说清「这是什么、能做什么」
  var TIPS = {
    schedule: {
      title: '日程',
      body: '左侧日历按日/周/月查看安排。点空白时段可直接新建日程，双击已有日程可编辑。\n' +
        '日程适合「有明确时间点的事」，比如会议、见面。',
    },
    todo: {
      title: '待办',
      body: '所有要做但还没定死时间的事都放这里。每条待办会自动按「重要性 × 紧急度」落到四象限，' +
        '所以不用自己排序，看 Q1 那一档就是最该先做的。\n' +
        '还有预估耗时的待办，可以去「今日规划」自动排成时间块。',
    },
    customer: {
      title: '客户商机',
      body: '管理客户档案与跟进。金额是按「流水」记的：先填预估（可反复改），落单时才确认成交额，' +
        '之后增购会累加上去——所以过程不会丢。\n' +
        '每次记录跟进都要求填「下次跟进时间」，系统会自动生成一条待办，到点提醒你，不会漏跟。',
    },
    plan: {
      title: '今日规划',
      body: '把「今天该做、且有预估耗时」的待办，按时间自动排成一段段时间块。\n' +
        '确认后可以一键落到日程里，等于给今天排好了一张时间表。',
    },
    inbox: {
      title: '收件箱',
      body: 'GTD 的「收集箱」：想到什么先丢进来，不用当场想清楚分类和时间。\n' +
        '之后在这里逐条「整理」——补截止时间、预估耗时，或直接排到日程。\n' +
        '手机端的「收集」页可以把内容直传到这里（连同一个 WiFi 即可）。' +
        '一次收集很多条时，用左边的勾选框批量整理更快。',
    },
    review: {
      title: '周回顾',
      body: '每周花几分钟看看：这周完成了多少、新增了多少、有哪些逾期、收件箱积压了多少。\n' +
        '目的是及时发现「事情只进不出」的情况。',
    },
    memorials: {
      title: '纪念日',
      body: '生日、纪念日等一年一次的日子，支持农历（含闰月），会按「还有多少天」排序提醒。',
    },
    bookkeeping: {
      title: '记账',
      body: '多账户记账：明细 / 账户 / 报表 / 预算 四个子页。\n' +
        '先建账户，再记流水，就能看到本月收支与预算剩余。',
    },
    search: {
      title: '搜索',
      body: '全文检索日程与待办的标题、描述、分类名。\n' +
        '任何时候按 Ctrl+F（Mac 为 Cmd+F）可直接唤起。',
    },
    stats: {
      title: '统计',
      body: '完成率、逾期情况、四象限分布与近 30 天趋势。\n' +
        '顶部数字卡片可以点开看「具体是哪些条目」，方便核对。',
    },
    settings: {
      title: '设置',
      body: '分类管理、提醒默认值、数据导出/导入/恢复、多端同步与账号。\n' +
        '想知道每个功能怎么用，可以随时回到这里点「重新查看新手引导」。',
    },
    admin: {
      title: '用户管理',
      body: '这是管理员专属页面：新建账号、给每个账号勾选能用的功能、开停账号、重置密码。\n' +
        '被停用的账号会立刻被踢下线（不是等登录过期），也不能再登录。',
    },
  };

  // 首次使用引导的步骤
  var STEPS = [
    {
      title: '欢迎使用日程管理',
      body: '这套工具把「日程、待办、客户、记账」放在一起，核心思路只有一句话：\n' +
        '**先把事情记下来，再逐步把它变清楚。**\n\n' +
        '接下来用 1 分钟带你走一遍，随时可以点「跳过引导」。',
    },
    {
      title: '日程 vs 待办：什么时候用哪个？',
      body: '· **日程**：时间已经定死的事（会议、见面、预约）。\n' +
        '· **待办**：要做但还没定时间的事。\n\n' +
        '两者可以打通：待办上点「排到日程」，就会按预估耗时生成一个时间块。',
      view: 'todo',
    },
    {
      title: '想到什么先丢进「收件箱」',
      body: '别在忙的时候纠结分类和截止时间。按 **Ctrl+Shift+N** 随时随地记一条，' +
        '丢进「收件箱」，等有空再整理。\n' +
        '手机端也能收集，回到同一网络后一键直传到电脑的收件箱。',
      view: 'inbox',
    },
    {
      title: '不用自己排序：四象限自动分好',
      body: '每条待办会根据「重要性 × 紧急度」自动落到 Q1~Q4。\n' +
        '看「今日规划」还能把今天的待办自动排成时间表。',
      view: 'plan',
    },
    {
      title: '客户跟进不会漏',
      body: '在「客户商机」里记录每次跟进时，**必须**填下次跟进时间——' +
        '系统会自动生成一条待办并到点提醒。\n' +
        '金额按流水记：先预估，落单才确认，之后增购累加，过程都留痕。',
      view: 'customer',
    },
    {
      title: '每个功能都有提示，随时可查',
      body: '进入任何一个功能时，右上角都会有一个小卡片告诉你它能做什么。\n' +
        '看过的可以选「不再提示」，老用户可以一键关掉全部提示。\n' +
        '以后想再看，随时到「设置 → 新手引导」重新打开。',
    },
  ];

  function readState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== 'object') s = {};
      if (typeof s.doneVersion !== 'number') s.doneVersion = 0;
      if (!s.dismissedTips || typeof s.dismissedTips !== 'object') s.dismissedTips = {};
      if (typeof s.tipsDisabled !== 'boolean') s.tipsDisabled = false;
      return s;
    } catch (e) {
      // 隐私模式 / 存储不可用：退化为「不记住」，功能仍可用
      return { doneVersion: 0, dismissedTips: {}, tipsDisabled: false };
    }
  }

  function writeState(s) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* 忽略 */ }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // 把 **加粗** 与换行渲染成元素（不引入 Markdown 依赖）
  function richText(text) {
    const box = el('div', 'guide-body');
    String(text).split('\n').forEach(function (line) {
      const p = el('div', 'guide-line');
      const parts = line.split(/\*\*(.+?)\*\*/g);
      parts.forEach(function (part, i) {
        if (!part) return;
        if (i % 2 === 1) p.appendChild(el('strong', null, part));
        else p.appendChild(document.createTextNode(part));
      });
      box.appendChild(p);
    });
    return box;
  }

  // ---------------- 功能提示卡 ----------------
  let tipNode = null;

  function closeTip() {
    if (tipNode && tipNode.parentNode) tipNode.parentNode.removeChild(tipNode);
    tipNode = null;
  }

  function showTip(view, opts) {
    opts = opts || {};
    // 先收掉上一张卡，再做「是否允许提示」的判断。
    // 顺序不能反：若先判断再关闭，切到一个已关闭提示的功能时，上一张卡会留在屏幕上
    // （人在「待办」、卡片讲的却是「日程」），属于明显的错位。
    closeTip();

    const tip = TIPS[view];
    if (!tip) return false;
    const state = readState();
    if (!opts.force && (state.tipsDisabled || state.dismissedTips[view])) return false;

    const root = document.getElementById('guide-root') || document.body;

    const card = el('div', 'guide-tip');
    const head = el('div', 'guide-tip-head');
    head.appendChild(el('span', 'guide-tip-badge', '这是做什么的'));
    head.appendChild(el('span', 'guide-tip-title', tip.title));
    card.appendChild(head);
    card.appendChild(richText(tip.body));

    const actions = el('div', 'guide-tip-actions');
    const ok = el('button', 'btn btn-primary btn-sm', '知道了');
    ok.addEventListener('click', closeTip);
    const never = el('button', 'btn btn-sm', '不再提示');
    never.title = '以后进入这个功能时不再自动弹出（随时可在设置里恢复）';
    never.addEventListener('click', function () {
      const s = readState();
      s.dismissedTips[view] = true;
      writeState(s);
      closeTip();
      window.Toast.success('已关闭「' + tip.title + '」的提示');
    });
    actions.appendChild(ok);
    actions.appendChild(never);
    card.appendChild(actions);

    // 手动打开时（force）额外给一个「全部关闭」的入口，方便老用户一次清干净
    if (opts.force) {
      const all = el('button', 'btn btn-sm', '关闭全部功能提示');
      all.addEventListener('click', function () {
        disableAllTips();
        closeTip();
      });
      actions.appendChild(all);
    }

    root.appendChild(card);
    tipNode = card;
    return true;
  }

  function disableAllTips() {
    const s = readState();
    s.tipsDisabled = true;
    writeState(s);
    closeTip();
    window.Toast.success('已关闭全部功能提示（可在设置 → 新手引导 恢复）');
  }

  function enableAllTips() {
    const s = readState();
    s.tipsDisabled = false;
    s.dismissedTips = {};
    writeState(s);
    window.Toast.success('已恢复全部功能提示');
  }

  function tipsDisabled() { return readState().tipsDisabled; }
  function dismissedCount() { return Object.keys(readState().dismissedTips).length; }

  // ---------------- 首次使用引导 ----------------
  function shouldShowOnboarding() {
    return readState().doneVersion < GUIDE_VERSION;
  }

  function markOnboardingDone() {
    const s = readState();
    s.doneVersion = GUIDE_VERSION;
    writeState(s);
    // 通知 App：引导结束了，功能提示卡可以开始工作
    if (window.App && window.App.onGuideDone) window.App.onGuideDone();
  }

  function openOnboarding(opts) {
    opts = opts || {};
    let step = 0;

    const body = el('div', 'guide-onboard');
    const progress = el('div', 'guide-progress');
    const stepBox = el('div', 'guide-step');
    const nav = el('div', 'guide-nav');
    body.appendChild(progress);
    body.appendChild(stepBox);
    body.appendChild(nav);

    function renderStep() {
      const s = STEPS[step];
      progress.textContent = '第 ' + (step + 1) + ' / ' + STEPS.length + ' 步';
      stepBox.innerHTML = '';
      stepBox.appendChild(el('div', 'guide-step-title', s.title));
      stepBox.appendChild(richText(s.body));

      nav.innerHTML = '';
      const skip = el('button', 'btn btn-sm', '跳过引导');
      skip.title = '不再显示引导（可随时在设置里重新打开）';
      skip.addEventListener('click', function () {
        markOnboardingDone();
        window.Modal.close();
        window.Toast.success('已跳过引导，可在设置中重新查看');
      });
      nav.appendChild(skip);

      if (s.view && window.App) {
        const go = el('button', 'btn btn-sm', '去这个功能看看');
        go.addEventListener('click', function () {
          window.App.switchView(s.view);
          window.Modal.close();
        });
        nav.appendChild(go);
      }

      const spacer = el('span', 'guide-spacer');
      nav.appendChild(spacer);

      if (step > 0) {
        const prev = el('button', 'btn btn-sm', '上一步');
        prev.addEventListener('click', function () { step -= 1; renderStep(); });
        nav.appendChild(prev);
      }
      const next = el('button', 'btn btn-primary btn-sm', step === STEPS.length - 1 ? '开始使用' : '下一步');
      next.addEventListener('click', function () {
        if (step === STEPS.length - 1) {
          markOnboardingDone();
          window.Modal.close();
          window.Toast.success('开始使用吧！每个功能右上角都有提示可看');
          return;
        }
        step += 1;
        renderStep();
      });
      nav.appendChild(next);
    }

    renderStep();
    // 引导里用 okText:false 隐藏默认的「确定」，按钮全部由 nav 自己管理
    window.Modal.open({
      title: opts.force ? '新手引导' : '欢迎使用日程管理',
      content: body,
      okText: false,
    });
  }

  // 首次启动时自动弹出（只弹一次）
  function maybeAutoStart() {
    if (shouldShowOnboarding()) openOnboarding({});
  }

  // 打开「全部功能提示一览」——给「我想主动看看每个功能」的用户
  function openTipsOverview() {
    const body = el('div');
    body.appendChild(el('div', 'item-meta',
      '下面是每个功能的说明。点标题可以直接跳过去看。'));
    const list = el('div');
    list.style.marginTop = '10px';
    Object.keys(TIPS).forEach(function (view) {
      const row = el('div', 'guide-overview-row');
      const link = el('button', 'btn btn-sm', TIPS[view].title);
      link.addEventListener('click', function () {
        if (window.App) window.App.switchView(view);
        window.Modal.close();
        showTip(view, { force: true });
      });
      row.appendChild(link);
      row.appendChild(el('span', 'guide-overview-desc', TIPS[view].body.split('\n')[0]));
      list.appendChild(row);
    });
    body.appendChild(list);

    const actions = el('div', 'guide-nav');
    const restore = el('button', 'btn btn-sm', '恢复全部提示');
    restore.addEventListener('click', function () { enableAllTips(); window.Modal.close(); });
    const disable = el('button', 'btn btn-sm', '关闭全部提示');
    disable.addEventListener('click', function () { disableAllTips(); window.Modal.close(); });
    actions.appendChild(restore);
    actions.appendChild(disable);
    body.appendChild(actions);

    window.Modal.open({ title: '各功能说明', content: body, okText: '关闭' });
  }

  return {
    GUIDE_VERSION: GUIDE_VERSION,
    TIPS: TIPS,
    STEPS: STEPS,
    showTip: showTip,
    closeTip: closeTip,
    disableAllTips: disableAllTips,
    enableAllTips: enableAllTips,
    tipsDisabled: tipsDisabled,
    dismissedCount: dismissedCount,
    shouldShowOnboarding: shouldShowOnboarding,
    markOnboardingDone: markOnboardingDone,
    openOnboarding: openOnboarding,
    maybeAutoStart: maybeAutoStart,
    openTipsOverview: openTipsOverview,
  };
})();
