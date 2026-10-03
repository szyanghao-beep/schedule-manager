/*
 * digest.test.js — 每日邮件摘要纯函数测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  buildDailyDigest, parseEmailTime, shouldSendDailyEmail,
  dailyEmailGaveUp, EMAIL_MAX_ATTEMPTS_PER_DAY,
} = require('../shared/digest.js');
const Utils = require('../shared/utils.js');

// 固定「今天」为 2026-08-22（周六）12:00
const NOW = new Date('2026-08-22T12:00:00').getTime();

test('摘要主题含日期', function () {
  const d = buildDailyDigest({ events: [], todos: [] }, NOW);
  assert.strictEqual(d.subject, '日程管理 · 每日待办 2026-08-22');
});

test('今日待办：未完成且截止今天才计入', function () {
  const todos = [
    { id: 't1', title: '今天截止', status: 'pending', deadline: new Date('2026-08-22T18:00:00').getTime(), priority: 'high' },
    { id: 't2', title: '昨天截止', status: 'pending', deadline: new Date('2026-08-21T18:00:00').getTime() },
    { id: 't3', title: '已完成', status: 'done', deadline: new Date('2026-08-22T18:00:00').getTime() },
    { id: 't4', title: '无截止', status: 'pending', deadline: null },
  ];
  const d = buildDailyDigest({ events: [], todos: todos }, NOW);
  assert.ok(d.text.indexOf('今日待办（1）') >= 0);
  assert.ok(d.text.indexOf('今天截止') >= 0);
  assert.ok(d.text.indexOf('昨天截止') < 0 || d.text.indexOf('逾期未完成') >= 0); // 昨天截止归入逾期
  assert.ok(d.text.indexOf('已完成') < 0 || d.text.indexOf('今日待办') < 0); // 已完成不进待办
});

test('逾期待办：未完成且截止在今天之前', function () {
  const todos = [
    { id: 't1', title: '逾期任务', status: 'pending', deadline: new Date('2026-08-20T09:00:00').getTime() },
  ];
  const d = buildDailyDigest({ events: [], todos: todos }, NOW);
  assert.ok(d.text.indexOf('逾期未完成（1）') >= 0);
  assert.ok(d.text.indexOf('逾期任务') >= 0);
});

test('今日日程：展开重复实例到当天', function () {
  const events = [
    {
      id: 'e1', title: '每日站会', allDay: false,
      startTime: new Date('2026-08-20T09:00:00').getTime(),
      endTime: new Date('2026-08-20T09:30:00').getTime(),
      repeat: { type: 'daily', interval: 1 },
    },
  ];
  const d = buildDailyDigest({ events: events, todos: [] }, NOW);
  assert.ok(d.text.indexOf('今日日程（1）') >= 0);
  assert.ok(d.text.indexOf('每日站会') >= 0);
});

test('HTML 输出转义特殊字符', function () {
  const todos = [{ id: 't1', title: '<script>alert(1)</script>', status: 'pending', deadline: NOW }];
  const d = buildDailyDigest({ events: [], todos: todos }, NOW);
  assert.ok(d.html.indexOf('<script>alert(1)</script>') < 0);
  assert.ok(d.html.indexOf('&lt;script&gt;') >= 0);
});

test('收件箱积压：无截止时间的未完成待办', function () {
  const todos = [
    { id: 't1', title: '未整理想法', status: 'pending', deadline: null },
    { id: 't2', title: '已完成无截止', status: 'done', deadline: null },
  ];
  const d = buildDailyDigest({ events: [], todos: todos }, NOW);
  assert.ok(d.text.indexOf('收件箱积压（1）') >= 0);
  assert.ok(d.text.indexOf('未整理想法') >= 0);
});

test('空数据摘要不抛错', function () {
  const d = buildDailyDigest({ events: [], todos: [] }, NOW);
  assert.ok(d.text.length > 0);
  assert.ok(d.html.length > 0);
});

test('今日纪念日：生日恰逢今日计入摘要并带年龄', function () {
  const memorials = [
    { id: 'm1', name: '张三', kind: 'birthday', calendar: 'solar', month: 8, day: 22, year: 1990, remindBeforeDays: 7 },
    { id: 'm2', name: '结婚纪念日', kind: 'anniversary', calendar: 'solar', month: 8, day: 23, year: 2020, remindBeforeDays: 0 }, // 明天，不计入
  ];
  const d = buildDailyDigest({ events: [], todos: [], memorials: memorials }, NOW);
  assert.ok(d.text.indexOf('今日纪念日（1）') >= 0, '今日纪念日应为 1 条');
  assert.ok(d.text.indexOf('张三') >= 0);
  assert.ok(d.text.indexOf('36 岁') >= 0);
  assert.ok(d.text.indexOf('结婚纪念日') < 0, '明天的纪念日不应计入今日摘要');
  assert.ok(d.html.indexOf('张三') >= 0);
});

// ---- 每日邮件触发判定（到点自动发送链路）----
// 固定「现在」为 2026-08-22（周六）08:30 本地时间，发送时间默认 08:00
const TRIG_NOW = new Date('2026-08-22T08:30:00').getTime();

function baseOpts(overrides) {
  return Object.assign({
    enabled: true,
    to: 'me@163.com',
    host: 'smtp.163.com',
    user: 'me@163.com',
    hasPassword: true,
    time: '08:00',
    now: TRIG_NOW,
    lastSentDate: '',
    sending: false,
  }, overrides || {});
}

test('parseEmailTime：合法与非法', function () {
  assert.strictEqual(parseEmailTime('08:00'), 480);
  assert.strictEqual(parseEmailTime('0:05'), 5);
  assert.strictEqual(parseEmailTime('23:59'), 1439);
  assert.strictEqual(parseEmailTime(' 08:00 '), 480);
  assert.strictEqual(parseEmailTime('24:00'), null);
  assert.strictEqual(parseEmailTime('8:60'), null);
  assert.strictEqual(parseEmailTime('0800'), null);
  assert.strictEqual(parseEmailTime('8:5'), null);
  assert.strictEqual(parseEmailTime(''), null);
  assert.strictEqual(parseEmailTime(null), null);
});

test('触发判定：到点且配置完整 → 发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts()), true);
});

test('触发判定：开关关闭或缺收件人 → 不发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ enabled: false })), false);
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ to: '' })), false);
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ to: null })), false);
});

test('触发判定：缺 SMTP 主机/用户名/密码 → 不发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ host: '' })), false);
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ user: '' })), false);
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ hasPassword: false })), false);
});

test('触发判定：发送时间非法 → 不发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ time: '24:00' })), false);
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ time: 'abc' })), false);
});

test('触发判定：当日已发 → 去重不发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ lastSentDate: '2026-08-22' })), false);
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ lastSentDate: '2026-08-21' })), true);
});

test('触发判定：发送中 → 防重入不发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ sending: true })), false);
});

test('触发判定：未到点不发送，恰好到点发送', function () {
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ time: '09:00' })), false); // 现在 08:30
  assert.strictEqual(shouldSendDailyEmail(baseOpts({ time: '08:30' })), true);  // 边界：恰好到点
});

// ---------------- 每日邮件的失败退避（防止每 30 秒重撞 SMTP） ----------------
// 背景：检查周期是 30 秒；失败后若不记录状态，下一轮又满足「到点且当日未发」，
// 就会整天每 30 秒重试一次（约 2880 次），既刷日志也可能被邮箱服务商锁定账号。

function baseEmailOpts(now) {
  return {
    enabled: true, to: 'me@example.com', host: 'smtp.example.com', user: 'me@example.com',
    hasPassword: true, time: '08:00', now: now,
  };
}

test('shouldSendDailyEmail：到点且当日未发 → 发送', function () {
  const now = Utils.parseDateTime('2026-03-10', '09:00');
  assert.strictEqual(shouldSendDailyEmail(baseEmailOpts(now)), true);
});

test('shouldSendDailyEmail：失败后在退避期内不再重试（关键：否则每 30 秒撞一次）', function () {
  const now = Utils.parseDateTime('2026-03-10', '09:00');
  const MIN = 60000;
  const failed = Object.assign(baseEmailOpts(now), {
    failCount: 1, failDate: '2026-03-10', lastAttemptAt: now - 1 * MIN,
  });
  assert.strictEqual(shouldSendDailyEmail(failed), false, '刚失败 1 分钟不应重试');

  const later = Object.assign({}, failed, { lastAttemptAt: now - 6 * MIN });
  assert.strictEqual(shouldSendDailyEmail(later), true, '超过退避间隔后可以重试');
});

test('shouldSendDailyEmail：退避间隔随失败次数拉长', function () {
  const now = Utils.parseDateTime('2026-03-10', '09:00');
  const MIN = 60000;
  // 第 2 次失败后要等 15 分钟
  const f2 = Object.assign(baseEmailOpts(now), {
    failCount: 2, failDate: '2026-03-10', lastAttemptAt: now - 10 * MIN,
  });
  assert.strictEqual(shouldSendDailyEmail(f2), false, '10 分钟仍在 15 分钟退避内');
  assert.strictEqual(shouldSendDailyEmail(Object.assign({}, f2, { lastAttemptAt: now - 16 * MIN })), true);
});

test('shouldSendDailyEmail：当天尝试次数用尽后不再重试，跨天自动重置', function () {
  const now = Utils.parseDateTime('2026-03-10', '09:00');
  const used = Object.assign(baseEmailOpts(now), {
    failCount: EMAIL_MAX_ATTEMPTS_PER_DAY, failDate: '2026-03-10', lastAttemptAt: now - 999 * 60000,
  });
  assert.strictEqual(shouldSendDailyEmail(used), false, '当天已用尽次数');

  const nextDay = Object.assign(baseEmailOpts(Utils.parseDateTime('2026-03-11', '09:00')), {
    failCount: EMAIL_MAX_ATTEMPTS_PER_DAY, failDate: '2026-03-10', lastAttemptAt: now,
  });
  assert.strictEqual(shouldSendDailyEmail(nextDay), true, '换了一天就该重新尝试');
});

test('dailyEmailGaveUp：只在「当天的尝试次数用尽」时为真', function () {
  const now = Utils.parseDateTime('2026-03-10', '09:00');
  assert.strictEqual(dailyEmailGaveUp({ now: now, failCount: EMAIL_MAX_ATTEMPTS_PER_DAY, failDate: '2026-03-10' }), true);
  assert.strictEqual(dailyEmailGaveUp({ now: now, failCount: 1, failDate: '2026-03-10' }), false);
  assert.strictEqual(dailyEmailGaveUp({ now: now, failCount: EMAIL_MAX_ATTEMPTS_PER_DAY, failDate: '2026-03-09' }), false,
    '昨天的计数不应影响今天');
  assert.strictEqual(dailyEmailGaveUp(null), false);
});

test('不传失败信息时行为与以前完全一致（向后兼容）', function () {
  const now = Utils.parseDateTime('2026-03-10', '09:00');
  assert.strictEqual(shouldSendDailyEmail(baseEmailOpts(now)), true);
  assert.strictEqual(shouldSendDailyEmail(Object.assign(baseEmailOpts(now), { lastSentDate: '2026-03-10' })), false);
  assert.strictEqual(shouldSendDailyEmail(Object.assign(baseEmailOpts(now), { sending: true })), false);
  assert.strictEqual(shouldSendDailyEmail(Object.assign(baseEmailOpts(now), { enabled: false })), false);
  assert.strictEqual(shouldSendDailyEmail(Object.assign(baseEmailOpts(now), { hasPassword: false })), false);
  assert.strictEqual(shouldSendDailyEmail(Object.assign(baseEmailOpts(now), { time: '99:99' })), false);
});
