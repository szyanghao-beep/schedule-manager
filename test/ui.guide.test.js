/*
 * ui.guide.test.js — 新手引导与功能提示测试
 *
 * 需求原话：「增加第一次使用的指引功能，把每个功能用提示框的方式给初学者解释，
 *           指引界面对老用户可以跳过」。
 * 所以这里要钉住的是：
 *   - 第一次打开确实会引导，且**能跳过**
 *   - 跳过后不再反复弹（记住状态），但**功能提示卡开始工作**
 *   - 每个功能进第一次时有提示，「不再提示」有效且只影响该功能
 *   - 老用户能一键关掉全部提示，也能随时恢复 / 重新查看引导
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const helpers = require('./ui.helpers.js');
const { setupUi, flush, FIXED_NOW } = helpers;

const KEY = 'schedule.guide.v1';

// 以指定引导状态启动：init:false → 先塞 localStorage → 再手动触发 DOMContentLoaded，
// 这样能模拟「老用户（已看过引导）」与「首次使用」两种情况。
async function setupGuide(guideState) {
  const h = await setupUi({ now: FIXED_NOW, init: false });
  if (guideState) h.window.localStorage.setItem(KEY, JSON.stringify(guideState));
  h.window.document.dispatchEvent(new h.window.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  return h;
}

function guideStateOf(h) {
  try { return JSON.parse(h.window.localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
}

function modalButtons(h) {
  const footer = h.qs('#modal-root .modal-footer');
  const body = h.qs('#modal-root .modal-body');
  return []
    .concat(footer ? h.texts('button', footer) : [])
    .concat(body ? h.texts('button', body) : []);
}

test('★ 首次使用会自动弹出引导，且可以跳过', async function (t) {
  const h = await setupGuide(null);
  t.after(function () { h.close(); });

  assert.ok(h.qs('#modal-root .modal'), '首次使用应自动弹出引导');
  assert.strictEqual(h.text('#modal-root .modal-title'), '欢迎使用日程管理');
  assert.ok(modalButtons(h).indexOf('跳过引导') >= 0, '引导必须能跳过：' + JSON.stringify(modalButtons(h)));
  assert.ok(modalButtons(h).indexOf('下一步') >= 0);

  // 跳过 → 弹窗关闭 + 状态被记住
  h.clickText('button', '跳过引导', h.qs('#modal-root .modal-body'));
  assert.strictEqual(h.qs('#modal-root .modal'), null, '跳过后应关闭弹窗');
  assert.strictEqual(guideStateOf(h).doneVersion, 1, '应记住「已看过引导」');
});

test('引导可以逐步前进与回退', async function (t) {
  const h = await setupGuide(null);
  t.after(function () { h.close(); });

  const step1 = h.text('#modal-root .guide-step-title');
  assert.ok(step1.indexOf('欢迎') >= 0, step1);
  assert.strictEqual(h.text('#modal-root .guide-progress'), '第 1 / ' + h.window.Guide.STEPS.length + ' 步');
  assert.strictEqual(modalButtons(h).indexOf('上一步'), -1, '第 1 步不该有「上一步」');

  h.clickText('button', '下一步', h.qs('#modal-root .modal-body'));
  const step2 = h.text('#modal-root .guide-step-title');
  assert.notStrictEqual(step2, step1, '应进入下一步');
  assert.ok(modalButtons(h).indexOf('上一步') >= 0, '第 2 步应有「上一步」');
  assert.ok(modalButtons(h).indexOf('去这个功能看看') >= 0, '带 view 的步骤应有跳转按钮');

  h.clickText('button', '上一步', h.qs('#modal-root .modal-body'));
  assert.strictEqual(h.text('#modal-root .guide-step-title'), step1, '应能回到上一步');
});

test('引导最后一步是「开始使用」，点完记住状态', async function (t) {
  const h = await setupGuide(null);
  t.after(function () { h.close(); });

  const total = h.window.Guide.STEPS.length;
  for (let i = 0; i < total - 1; i++) {
    h.clickText('button', '下一步', h.qs('#modal-root .modal-body'));
  }
  assert.strictEqual(h.text('#modal-root .guide-progress'), '第 ' + total + ' / ' + total + ' 步');
  assert.ok(modalButtons(h).indexOf('开始使用') >= 0, JSON.stringify(modalButtons(h)));

  h.clickText('button', '开始使用', h.qs('#modal-root .modal-body'));
  assert.strictEqual(h.qs('#modal-root .modal'), null);
  assert.strictEqual(guideStateOf(h).doneVersion, 1);
});

test('★ 老用户（已看过引导）不会再被弹引导', async function (t) {
  const h = await setupGuide({ doneVersion: 1, dismissedTips: {}, tipsDisabled: false });
  t.after(function () { h.close(); });

  assert.strictEqual(h.qs('#modal-root .modal'), null, '老用户不该再看到引导弹窗');
});

test('★ 跳过后，进入每个功能会弹出「这是做什么的」提示卡', async function (t) {
  const h = await setupGuide(null);
  t.after(function () { h.close(); });

  // 引导未结束时先不打扰
  h.App.switchView('todo');
  assert.strictEqual(h.qs('#guide-root .guide-tip'), null, '引导还没结束时不弹提示卡');

  h.App.switchView('schedule');
  h.clickText('button', '跳过引导', h.qs('#modal-root .modal-body'));

  h.App.switchView('todo');
  const tip = h.qs('#guide-root .guide-tip');
  assert.ok(tip, '跳过后进入功能应出现提示卡');
  assert.strictEqual(h.text('#guide-root .guide-tip-badge'), '这是做什么的');
  assert.strictEqual(h.text('#guide-root .guide-tip-title'), '待办');
  assert.ok(tip.textContent.indexOf('四象限') >= 0, '提示内容应解释该功能：' + tip.textContent);

  // 「知道了」只关掉本次，不算「不再提示」
  h.clickText('button', '知道了', h.qs('#guide-root'));
  assert.strictEqual(h.qs('#guide-root .guide-tip'), null);
  h.App.switchView('schedule');
  h.App.switchView('todo');
  assert.ok(h.qs('#guide-root .guide-tip'), '「知道了」之后再次进入还应提示');
});

test('★ 「不再提示」只对该功能生效且会被记住', async function (t) {
  const h = await setupGuide({ doneVersion: 1, dismissedTips: {}, tipsDisabled: false });
  t.after(function () { h.close(); });

  h.App.switchView('todo');
  assert.ok(h.qs('#guide-root .guide-tip'), '应弹出待办的提示');
  h.clickText('button', '不再提示', h.qs('#guide-root'));
  assert.strictEqual(h.qs('#guide-root .guide-tip'), null);
  assert.strictEqual(guideStateOf(h).dismissedTips.todo, true, '应记住这个功能不再提示');

  // 该功能不再提示；切到别的功能会显示那个功能的卡，
  // 但切回「已关闭」的功能时必须把卡收掉（否则会出现「人在待办、卡片讲的是日程」的错位）
  h.App.switchView('schedule');
  assert.strictEqual(h.text('#guide-root .guide-tip-title'), '日程', '别的功能照常提示');
  h.App.switchView('todo');
  assert.strictEqual(h.qs('#guide-root .guide-tip'), null,
    '切回已关闭提示的功能时，不该残留上一个功能的提示卡');

  h.App.switchView('stats');
  assert.strictEqual(h.text('#guide-root .guide-tip-title'), '统计', '未被关闭的功能仍应提示');
});

test('设置页 · 老用户可一键关闭全部提示，也能随时恢复', async function (t) {
  const h = await setupGuide({ doneVersion: 1, dismissedTips: {}, tipsDisabled: false });
  t.after(function () { h.close(); });

  h.renderView('settings');
  await flush();
  const card = h.cardByTitle('新手引导与功能提示');
  assert.ok(card, '设置页应有「新手引导与功能提示」卡片');
  assert.ok(h.texts('.item-meta', card).some(function (s) { return s.indexOf('开启中') >= 0; }),
    '应显示当前状态：' + JSON.stringify(h.texts('.item-meta', card)));

  h.clickText('button', '关闭全部功能提示', card);
  assert.strictEqual(h.window.Guide.tipsDisabled(), true);
  h.App.switchView('todo');
  assert.strictEqual(h.qs('#guide-root .guide-tip'), null, '全部关闭后不该再弹');

  // 恢复
  h.renderView('settings');
  await flush();
  const card2 = h.cardByTitle('新手引导与功能提示');
  h.clickText('button', '恢复功能提示', card2);
  assert.strictEqual(h.window.Guide.tipsDisabled(), false);
  h.App.switchView('stats');
  assert.ok(h.qs('#guide-root .guide-tip'), '恢复后应重新提示');
});

test('设置页 · 「重新查看新手引导」对老用户也能打开', async function (t) {
  const h = await setupGuide({ doneVersion: 1, dismissedTips: {}, tipsDisabled: false });
  t.after(function () { h.close(); });

  h.renderView('settings');
  await flush();
  h.clickText('button', '重新查看新手引导', h.cardByTitle('新手引导与功能提示'));
  assert.ok(h.qs('#modal-root .modal'), '应能重新打开引导');
  assert.ok(modalButtons(h).indexOf('跳过引导') >= 0, '重新打开的引导同样可跳过');
});

test('设置页 · 「各功能说明一览」列出全部功能并可跳转', async function (t) {
  const h = await setupGuide({ doneVersion: 1, dismissedTips: {}, tipsDisabled: false });
  t.after(function () { h.close(); });

  h.renderView('settings');
  await flush();
  h.clickText('button', '各功能说明一览', h.cardByTitle('新手引导与功能提示'));

  const MODULE_LABELS = h.window.PermUtil.MODULES.map(function (m) { return m.label; });
  const listed = h.texts('#modal-root .guide-overview-row button');
  MODULE_LABELS.forEach(function (label) {
    assert.ok(listed.indexOf(label) >= 0, '功能一览应包含「' + label + '」：' + JSON.stringify(listed));
  });

  // 点某一项 → 关闭一览并跳到该功能、强制显示提示
  h.clickText('button', '记账', h.qs('#modal-root .modal-body'));
  await flush();
  assert.strictEqual(h.App.getView(), 'bookkeeping', '应跳到记账');
  assert.strictEqual(h.text('#guide-root .guide-tip-title'), '记账', '应强制显示该功能的提示');
});

test('提示文案覆盖全部导航功能（新增功能时必须补提示）', async function (t) {
  const h = await setupGuide({ doneVersion: 1, dismissedTips: {}, tipsDisabled: false });
  t.after(function () { h.close(); });

  const navViews = h.qsa('.nav-item').map(function (b) { return b.dataset.view; });
  const tips = h.window.Guide.TIPS;
  navViews.forEach(function (v) {
    assert.ok(tips[v], '导航项「' + v + '」缺少引导提示文案');
    assert.ok(tips[v].title && tips[v].body && tips[v].body.length > 20,
      '「' + v + '」的提示内容过于简单，起不到解释作用');
  });
});

test('localStorage 不可用时引导仍可用（只是不记住）', async function (t) {
  const h = await setupGuide(null);
  t.after(function () { h.close(); });

  // 模拟存储被禁用（隐私模式等）
  const original = h.window.localStorage.getItem.bind(h.window.localStorage);
  h.window.localStorage.getItem = function () { throw new Error('storage disabled'); };
  h.window.localStorage.setItem = function () { throw new Error('storage disabled'); };

  assert.doesNotThrow(function () { h.window.Guide.showTip('todo'); },
    '存储不可用时不应抛错');
  assert.ok(h.qs('#guide-root .guide-tip'), '仍应能显示提示卡');
  assert.doesNotThrow(function () { h.window.Guide.disableAllTips(); });

  h.window.localStorage.getItem = original;
});
