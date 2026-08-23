/*
 * nlp.test.js — 自然语言规则解析器测试（node --test）
 */
const test = require('node:test');
const assert = require('node:assert');
const Nlp = require('../shared/nlp.js');

// 固定「现在」为 2026-08-17（周一）12:00 本地时间
const NOW = new Date('2026-08-17T12:00:00').getTime();

function day(dateStr) { return new Date(dateStr + 'T00:00:00').getTime(); }
function at(dateStr, hh, mm) {
  return new Date(dateStr + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00').getTime();
}
function end(dateStr) { return day(dateStr) + 24 * 3600 * 1000 - 1; }

function p(text) { return Nlp.parse(text, { now: NOW }); }

test('空输入返回空结构', function () {
  const r = p('');
  assert.strictEqual(r.title, '');
  assert.strictEqual(r.deadline, null);
  assert.strictEqual(r.kind, 'todo');
});

test('纯标题：无时间信息，进入收件箱语义', function () {
  const r = p('买牛奶');
  assert.strictEqual(r.title, '买牛奶');
  assert.strictEqual(r.deadline, null);
  assert.strictEqual(r.confidence, 0.3);
});

test('明天 + 下午时间 -> 待办截止', function () {
  const r = p('明天下午3点开会');
  assert.strictEqual(r.title, '开会');
  assert.strictEqual(r.kind, 'todo');
  assert.strictEqual(r.deadline, at('2026-08-18', 15, 0));
});

test('今天 + 无时间 -> 截止到当天结束', function () {
  const r = p('今天交报告');
  assert.strictEqual(r.title, '交报告');
  assert.strictEqual(r.deadline, end('2026-08-17'));
});

test('后天 + 上午时间', function () {
  const r = p('后天上午10点面试');
  assert.strictEqual(r.title, '面试');
  assert.strictEqual(r.deadline, at('2026-08-19', 10, 0));
});

test('大后天', function () {
  const r = p('大后天体检');
  assert.strictEqual(r.deadline, end('2026-08-20'));
});

test('24 小时制 HH:mm', function () {
  const r = p('15:30 站会');
  assert.strictEqual(r.title, '站会');
  assert.strictEqual(r.deadline, at('2026-08-17', 15, 30));
});

test('晚上 X 点 -> 20:00', function () {
  const r = p('晚上8点跑步');
  assert.strictEqual(r.deadline, at('2026-08-17', 20, 0));
});

test('点半', function () {
  const r = p('明天上午9点半晨会');
  assert.strictEqual(r.deadline, at('2026-08-18', 9, 30));
});

test('点分', function () {
  const r = p('下午3点15分取件');
  assert.strictEqual(r.deadline, at('2026-08-17', 15, 15));
});

test('本周周X -> 下一次出现', function () {
  // 8/17 周一，本周五 = 8/21
  const r = p('周五交报告');
  assert.strictEqual(r.deadline, end('2026-08-21'));
});

test('下周一 -> 下周', function () {
  const r = p('下周一开会');
  assert.strictEqual(r.deadline, end('2026-08-24'));
});

test('M月D日（今年，未来）', function () {
  const r = p('12月31日总结');
  assert.strictEqual(r.deadline, end('2026-12-31'));
});

test('YYYY-MM-DD 绝对日期', function () {
  const r = p('2026-09-01 提交');
  assert.strictEqual(r.deadline, end('2026-09-01'));
});

test('优先级：紧急 -> high', function () {
  const r = p('紧急 交周报');
  assert.strictEqual(r.priority, 'high');
  assert.strictEqual(r.title, '交周报');
});

test('优先级：不急 -> low', function () {
  const r = p('不急 整理照片');
  assert.strictEqual(r.priority, 'low');
});

test('重要性：不重要', function () {
  const r = p('不重要 整理桌面');
  assert.strictEqual(r.importance, 'not_important');
  assert.strictEqual(r.title, '整理桌面');
});

test('提醒提前量', function () {
  const r = p('开会 提前30分钟提醒');
  assert.strictEqual(r.remindBefore, 30);
  assert.strictEqual(r.title, '开会');
});

test('提醒提前量：小时', function () {
  const r = p('提交 提前1小时提醒');
  assert.strictEqual(r.remindBefore, 60);
});

test('预估耗时', function () {
  const r = p('写周报 预计1小时');
  assert.strictEqual(r.estimatedMinutes, 60);
  assert.strictEqual(r.title, '写周报');
});

test('分类 #标签', function () {
  const r = p('#工作 写方案');
  assert.strictEqual(r.categoryName, '工作');
  assert.strictEqual(r.title, '写方案');
});

test('分类不在白名单内不识别', function () {
  const r = Nlp.parse('#其他 写方案', { now: NOW, categories: ['工作', '生活', '学习'] });
  assert.strictEqual(r.categoryName, null);
});

test('时间 + 时长 -> 事件（含结束时间）', function () {
  const r = p('明天下午3点开会 1小时');
  assert.strictEqual(r.kind, 'event');
  assert.strictEqual(r.title, '开会');
  assert.strictEqual(r.startTime, at('2026-08-18', 15, 0));
  assert.strictEqual(r.endTime, at('2026-08-18', 16, 0));
  assert.strictEqual(r.estimatedMinutes, null); // 事件时长归入 endTime，不算待办预估
});

test('只有时长无时间 -> 待办预估耗时', function () {
  const r = p('读文档 30分钟');
  assert.strictEqual(r.kind, 'todo');
  assert.strictEqual(r.deadline, null);
  assert.strictEqual(r.estimatedMinutes, 30);
});

test('综合示例：多字段同时解析', function () {
  const r = p('#学习 紧急 明天下午2点 复习英语 预计40分钟 提前15分钟提醒');
  assert.strictEqual(r.categoryName, '学习');
  assert.strictEqual(r.priority, 'high');
  assert.strictEqual(r.title, '复习英语');
  assert.strictEqual(r.deadline, at('2026-08-18', 14, 0));
  assert.strictEqual(r.estimatedMinutes, 40);
  assert.strictEqual(r.remindBefore, 15);
  assert.ok(r.confidence >= 0.8);
});
