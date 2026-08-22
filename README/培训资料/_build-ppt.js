/*
 * _build-ppt.js — 用 pptxgenjs 生成培训 PPT（16:9）。
 * 用法：node README/培训资料/_build-ppt.js
 * 输出：README/培训资料/日程管理-培训PPT.pptx
 */
const path = require('path');
const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 英寸
pptx.author = '日程管理';
pptx.company = '日程管理 v2.1.0';
pptx.title = '日程管理 使用培训';

// 品牌色（pptxgenjs 用无 # 的十六进制）
const C = {
  blue: '4F8EF7', dark: '1F2A3D', green: '4CAF7D', amber: 'F2A541',
  red: 'E05B5B', purple: '8E6FD8', gray: '8A8F98', light: 'F2F6FD',
  white: 'FFFFFF', text: '2B2F36', sub: '6B7280',
};
const FONT = 'Microsoft YaHei';
const W = 13.33, H = 7.5;

// ---------- 工具函数 ----------
function bg(slide, color) { slide.background = { color }; }

function bar(slide, color) { // 顶部品牌条
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.16, fill: { color }, line: { type: 'none' } });
}

function titleBar(slide, text, color) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: 0.9, fill: { color }, line: { type: 'none' } });
  slide.addText(text, { x: 0.55, y: 0.18, w: W - 1, h: 0.6, fontSize: 30, bold: true, color: C.dark, fontFace: FONT, valign: 'middle' });
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 0.95, w: W - 1.1, h: 0, line: { color: 'E6EAF0', width: 1.5 } });
}

function footer(slide, num) {
  slide.addText('日程管理 v2.1.0 · 使用培训', { x: 0.55, y: 7.05, w: 5, h: 0.35, fontSize: 10, color: C.sub, fontFace: FONT });
  slide.addText(String(num), { x: W - 1.2, y: 7.05, w: 0.7, h: 0.35, fontSize: 10, color: C.sub, fontFace: FONT, align: 'right' });
}

function card(slide, x, y, w, h, fill, opts) {
  opts = opts || {};
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, fill: { color: fill }, line: { color: opts.line || 'E6EAF0', width: 1 }, rectRadius: 0.06,
  });
}

function contentTitle(slide, title, num, color) {
  titleBar(slide, title, color || C.blue);
  footer(slide, num);
}

// ================================================================
// 1. 封面
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.blue);
  s.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: 1.3, w: 3.2, h: 1.6, fill: { color: C.blue }, line: { color: C.white, width: 0 }, rectRadius: 0.12 });
  s.addShape(pptx.ShapeType.roundRect, { x: 0.85, y: 1.55, w: 1.4, h: 1.1, fill: { color: C.white }, line: { color: C.white, width: 1.5 }, rectRadius: 0.1 });
  s.addText('2.1', { x: 0.85, y: 1.8, w: 1.4, h: 0.6, fontSize: 30, bold: true, color: C.blue, fontFace: FONT, align: 'center' });
  s.addText('日程管理', { x: 0.85, y: 3.0, w: 8, h: 1.2, fontSize: 54, bold: true, color: C.white, fontFace: FONT });
  s.addText('使用培训 · 从零掌握时间管理', { x: 0.9, y: 4.2, w: 10, h: 0.6, fontSize: 22, color: C.white, fontFace: FONT });
  s.addText('四象限 · 时间块 · GTD 收件箱 · 周回顾', { x: 0.9, y: 5.0, w: 10, h: 0.5, fontSize: 15, color: C.white, fontFace: FONT });
  s.addText('版本 v2.1.0', { x: 0.9, y: 6.7, w: 5, h: 0.4, fontSize: 13, color: C.white, fontFace: FONT });
})();

// ================================================================
// 2. 培训目标
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '培训目标', 2);
  const goals = [
    ['01', '认识软件', '知道「日程管理」能帮我们解决什么问题，熟悉界面。'],
    ['02', '掌握记录', '学会记录日程和待办，会快速捕捉想法。'],
    ['03', '会用方法', '理解四象限、时间块、收件箱、周回顾并动手操作。'],
    ['04', '安全使用', '会备份数据、多设备同步，遇到问题能自查。'],
  ];
  goals.forEach((g, i) => {
    const x = 0.55 + (i % 2) * 6.2;
    const y = 1.5 + Math.floor(i / 2) * 2.4;
    card(s, x, y, 5.8, 2.0, C.light);
    s.addText(g[0], { x: x + 0.3, y: y + 0.35, w: 1.0, h: 0.9, fontSize: 34, bold: true, color: C.blue, fontFace: FONT });
    s.addText(g[1], { x: x + 1.4, y: y + 0.25, w: 4.2, h: 0.5, fontSize: 20, bold: true, color: C.dark, fontFace: FONT });
    s.addText(g[2], { x: x + 1.4, y: y + 0.8, w: 4.2, h: 0.9, fontSize: 13, color: C.sub, fontFace: FONT });
  });
})();

// ================================================================
// 3. 软件是什么
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '「日程管理」是什么？', 3);
  card(s, 0.55, 1.4, 12.2, 1.3, C.light);
  s.addText('一款本地优先的个人时间管理工具：帮你「记下来」并「安排掉」要做的事。',
    { x: 0.85, y: 1.55, w: 11.6, h: 1.0, fontSize: 18, color: C.dark, fontFace: FONT, valign: 'middle' });
  const items = [
    ['📅 日程', '有固定时间的安排，如会议、约会'],
    ['✅ 待办', '要做但时间灵活的事，可设截止'],
    ['🎯 四象限', '按重要×紧急自动分类排序'],
    ['⏱ 时间块', '给任务预约具体时间段'],
    ['📥 收件箱', '随手记想法，之后统一整理'],
    ['🔁 周回顾', '每周复盘完成与遗漏'],
  ];
  items.forEach((it, i) => {
    const x = 0.55 + (i % 3) * 4.15;
    const y = 3.0 + Math.floor(i / 3) * 1.7;
    card(s, x, y, 3.9, 1.5, C.white);
    s.addShape(pptx.ShapeType.rect, { x, y, w: 0.12, h: 1.5, fill: { color: C.blue }, line: { type: 'none' } });
    s.addText(it[0], { x: x + 0.3, y: y + 0.15, w: 3.4, h: 0.5, fontSize: 16, bold: true, color: C.dark, fontFace: FONT });
    s.addText(it[1], { x: x + 0.3, y: y + 0.7, w: 3.4, h: 0.7, fontSize: 11.5, color: C.sub, fontFace: FONT });
  });
  s.addText('核心价值：把「记下来」（捕捉）和「安排掉」（排程）分开，随时清空大脑，专注当下。',
    { x: 0.55, y: 6.4, w: 12.2, h: 0.5, fontSize: 14, italic: true, color: C.blue, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 4. 日程 vs 待办
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '两个基础概念：日程 vs 待办', 4);
  // 日程
  card(s, 0.55, 1.5, 5.9, 3.4, C.white);
  s.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.5, w: 5.9, h: 0.7, fill: { color: C.blue }, line: { type: 'none' } });
  s.addText('📅 日程（有固定时间）', { x: 0.8, y: 1.5, w: 5.4, h: 0.7, fontSize: 18, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  s.addText('• 明天下午 3 点开会\n• 周一出差\n• 每天晨跑（可设重复）',
    { x: 0.85, y: 2.4, w: 5.3, h: 1.8, fontSize: 15, color: C.dark, fontFace: FONT, lineSpacing: 26 });
  s.addText('在「日程」里按天/周/月查看', { x: 0.85, y: 4.3, w: 5.3, h: 0.5, fontSize: 12, color: C.sub, fontFace: FONT });
  // 待办
  card(s, 6.85, 1.5, 5.9, 3.4, C.white);
  s.addShape(pptx.ShapeType.rect, { x: 6.85, y: 1.5, w: 5.9, h: 0.7, fill: { color: C.green }, line: { type: 'none' } });
  s.addText('✅ 待办（要做、时间灵活）', { x: 7.1, y: 1.5, w: 5.4, h: 0.7, fontSize: 18, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  s.addText('• 抽空写季度报告\n• 交房租\n• 有空健身',
    { x: 7.15, y: 2.4, w: 5.3, h: 1.8, fontSize: 15, color: C.dark, fontFace: FONT, lineSpacing: 26 });
  s.addText('可设截止时间、预估耗时，自动进四象限', { x: 7.15, y: 4.3, w: 5.3, h: 0.5, fontSize: 12, color: C.sub, fontFace: FONT });
  // 底部提示
  s.addText('判断口诀：有固定时间点 → 日程；没有固定时间、只要完成 → 待办。',
    { x: 0.55, y: 5.4, w: 12.2, h: 0.6, fontSize: 16, bold: true, color: C.amber, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 5. 四象限
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '四象限：分清轻重缓急', 5);
  const q = [
    ['Q1 重要且紧急', '立刻去做', C.red, 0.55, 1.5],
    ['Q2 重要不紧急', '重点投入 · 提前做', C.blue, 6.85, 1.5],
    ['Q3 紧急不重要', '委托或快速处理', C.amber, 0.55, 4.0],
    ['Q4 不重要不紧急', '尽量少做', C.gray, 6.85, 4.0],
  ];
  q.forEach((it) => {
    card(s, it[3], it[4], 5.9, 2.3, it[2]);
    s.addText(it[0], { x: it[3] + 0.3, y: it[4] + 0.3, w: 5.3, h: 0.6, fontSize: 20, bold: true, color: C.white, fontFace: FONT });
    s.addText(it[1], { x: it[3] + 0.3, y: it[4] + 1.0, w: 5.3, h: 0.8, fontSize: 16, color: C.white, fontFace: FONT });
  });
  s.addText('软件根据你填写的「重要性」+ 截止时间自动判断「紧急性」，帮你归类并排序。',
    { x: 0.55, y: 6.5, w: 12.2, h: 0.5, fontSize: 14, color: C.sub, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 6. 快速捕捉 + 收件箱
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '快速捕捉 & 收件箱', 6);
  card(s, 0.55, 1.5, 6.0, 3.0, C.light);
  s.addText('⚡ 快速捕捉', { x: 0.85, y: 1.7, w: 5.4, h: 0.6, fontSize: 20, bold: true, color: C.blue, fontFace: FONT });
  s.addText('电脑上随时按 Ctrl + Shift + N\n弹出小窗，输入想法，保存。\n几秒完成，不打断手头工作。',
    { x: 0.85, y: 2.4, w: 5.4, h: 1.6, fontSize: 14, color: C.dark, fontFace: FONT, lineSpacing: 22 });
  s.addShape(pptx.ShapeType.roundRect, { x: 0.85, y: 4.15, w: 4.2, h: 0.5, fill: { color: C.blue }, line: { type: 'none' }, rectRadius: 0.25 });
  s.addText('Ctrl + Shift + N', { x: 0.85, y: 4.15, w: 4.2, h: 0.5, fontSize: 14, bold: true, color: C.white, fontFace: FONT, align: 'center' });

  card(s, 6.85, 1.5, 6.0, 3.0, C.light);
  s.addText('📥 收件箱', { x: 7.15, y: 1.7, w: 5.4, h: 0.6, fontSize: 20, bold: true, color: C.green, fontFace: FONT });
  s.addText('存放所有「没整理」的零散想法。\n有空时逐个整理：\n• 要做的 → 补时间、重要度\n• 不做的 → 删除\n• 以后再说的 → 先留着',
    { x: 7.15, y: 2.4, w: 5.4, h: 1.8, fontSize: 14, color: C.dark, fontFace: FONT, lineSpacing: 20 });
  s.addText('建议每天或每两天清空一次收件箱。', { x: 0.55, y: 5.6, w: 12.2, h: 0.5, fontSize: 14, italic: true, color: C.amber, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 7. 时间块 + 今日规划
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '时间块 & 今日规划', 7);
  const steps = [
    ['1', '给待办填「预估耗时」', '如「写周报」估 30 分钟。'],
    ['2', '打开「今日规划」', '自动在工作时段（9:00–18:00）找空闲槽位。'],
    ['3', '自动排进时间线', '避开已有日程，生成「几点做什么」。'],
    ['4', '点「应用排程到日程」', '时间块正式变成日程，照表执行。'],
  ];
  steps.forEach((st, i) => {
    const x = 0.55 + i * 3.15;
    card(s, x, 1.5, 2.9, 3.4, C.white);
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.95, y: 1.8, w: 1.0, h: 1.0, fill: { color: C.blue }, line: { type: 'none' } });
    s.addText(st[0], { x: x + 0.95, y: 1.8, w: 1.0, h: 1.0, fontSize: 26, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addText(st[1], { x: x + 0.2, y: 3.0, w: 2.5, h: 0.9, fontSize: 15, bold: true, color: C.dark, fontFace: FONT, align: 'center' });
    s.addText(st[2], { x: x + 0.2, y: 3.9, w: 2.5, h: 0.8, fontSize: 11.5, color: C.sub, fontFace: FONT, align: 'center' });
  });
  s.addText('好处：每天开始前就知道「几点做什么」，减少临时决策，注意力更集中。',
    { x: 0.55, y: 5.4, w: 12.2, h: 0.6, fontSize: 16, bold: true, color: C.green, fontFace: FONT, align: 'center' });
  s.addText('注意：自动排程只在工作时段内进行，每 30 分钟一个槽位，留 5 分钟缓冲。',
    { x: 0.55, y: 6.1, w: 12.2, h: 0.5, fontSize: 12, color: C.sub, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 8. 周回顾
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '周回顾：每周复盘', 8);
  const items = [
    ['本周已完成', '这周做完了什么，给自己一点成就感。', C.green],
    ['逾期未完成', '过了截止时间还没做的事，尽快处理。', C.red],
    ['需要关注', '没整理、没截止时间的零散事项。', C.amber],
  ];
  items.forEach((it, i) => {
    const y = 1.5 + i * 1.6;
    card(s, 0.55, y, 12.2, 1.35, C.light);
    s.addShape(pptx.ShapeType.rect, { x: 0.55, y, w: 0.15, h: 1.35, fill: { color: it[2] }, line: { type: 'none' } });
    s.addText(it[0], { x: 1.0, y: y + 0.2, w: 4, h: 0.5, fontSize: 18, bold: true, color: it[2], fontFace: FONT });
    s.addText(it[1], { x: 1.0, y: y + 0.7, w: 11, h: 0.5, fontSize: 13, color: C.sub, fontFace: FONT });
  });
  s.addText('建议固定时间：如每周五下班前 20 分钟，养成复盘习惯。',
    { x: 0.55, y: 6.4, w: 12.2, h: 0.5, fontSize: 15, bold: true, color: C.purple, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 9. 统计
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '统计：成长看得见', 9);
  const items = [
    ['完成率', '待办完成了几成'],
    ['逾期情况', '有多少事逾期了'],
    ['四象限分布', '时间花在重要的事上多吗'],
    ['趋势图', '随时间的完成变化'],
  ];
  items.forEach((it, i) => {
    const x = 0.55 + (i % 2) * 6.2;
    const y = 1.5 + Math.floor(i / 2) * 2.0;
    card(s, x, y, 5.8, 1.7, C.white);
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.3, y: y + 0.35, w: 1.0, h: 1.0, fill: { color: C.purple }, line: { type: 'none' } });
    s.addText(String(i + 1), { x: x + 0.3, y: y + 0.35, w: 1.0, h: 1.0, fontSize: 22, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addText(it[0], { x: x + 1.5, y: y + 0.3, w: 4, h: 0.5, fontSize: 18, bold: true, color: C.dark, fontFace: FONT });
    s.addText(it[1], { x: x + 1.5, y: y + 0.8, w: 4, h: 0.6, fontSize: 12.5, color: C.sub, fontFace: FONT });
  });
  s.addText('不用天天看，每周或每月扫一眼即可，帮助调整工作习惯。',
    { x: 0.55, y: 6.4, w: 12.2, h: 0.5, fontSize: 14, italic: true, color: C.sub, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 10. 数据安全与备份
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '数据安全与备份', 10);
  const items = [
    ['🔒 本地优先', '数据默认存本地，联网与否都能用；同步是可选项。', C.blue],
    ['💾 自动保存', '每次修改自动落盘，原子写盘防损坏。', C.green],
    ['🕓 自动备份', '自动保留最近 10 份历史备份，可一键恢复。', C.amber],
    ['📤 导出 / 导入', '一键导出为 JSON 文件，可迁移或存档。', C.purple],
  ];
  items.forEach((it, i) => {
    const x = 0.55 + (i % 2) * 6.2;
    const y = 1.5 + Math.floor(i / 2) * 2.2;
    card(s, x, y, 5.8, 1.9, C.light);
    s.addText(it[0], { x: x + 0.3, y: y + 0.2, w: 5.2, h: 0.5, fontSize: 18, bold: true, color: it[2], fontFace: FONT });
    s.addText(it[1], { x: x + 0.3, y: y + 0.8, w: 5.2, h: 0.9, fontSize: 13, color: C.dark, fontFace: FONT });
  });
  s.addText('建议：重要数据定期「导出」一份，存 U 盘或网盘，双保险。',
    { x: 0.55, y: 6.3, w: 12.2, h: 0.5, fontSize: 14, bold: true, color: C.red, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 11. 多设备同步
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '多设备同步（可选）', 11);
  card(s, 0.55, 1.5, 6.0, 3.2, C.white);
  s.addText('💻 电脑端', { x: 0.85, y: 1.7, w: 5.4, h: 0.5, fontSize: 18, bold: true, color: C.blue, fontFace: FONT });
  s.addText('设置 → 同步 → 填服务器地址 → 注册/登录 → 立即同步',
    { x: 0.85, y: 2.3, w: 5.4, h: 1.4, fontSize: 14, color: C.dark, fontFace: FONT, lineSpacing: 22 });
  card(s, 6.85, 1.5, 6.0, 3.2, C.white);
  s.addText('📱 手机端', { x: 7.15, y: 1.7, w: 5.4, h: 0.5, fontSize: 18, bold: true, color: C.green, fontFace: FONT });
  s.addText('设置 → 同步 → 填同一服务器地址 → 登录同一账号 → 自动同步',
    { x: 7.15, y: 2.3, w: 5.4, h: 1.4, fontSize: 14, color: C.dark, fontFace: FONT, lineSpacing: 22 });
  card(s, 0.55, 5.0, 12.2, 1.3, C.light);
  s.addText('同步规则：以「最后修改」为准（不会互相覆盖）；删除也会同步，不会死灰复燃。',
    { x: 0.85, y: 5.15, w: 11.6, h: 1.0, fontSize: 15, color: C.dark, fontFace: FONT, valign: 'middle' });
  s.addText('前提：需要一个「服务器地址」（由管理员提供）。单机使用可跳过。',
    { x: 0.55, y: 6.4, w: 12.2, h: 0.5, fontSize: 12, color: C.sub, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 12. 操作演示：记一件待办
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '动手演示：记一件待办', 12);
  const steps = [
    ['点「✅ 待办」', '进入待办清单'],
    ['点「＋ 新增待办」', '打开填写窗口'],
    ['填标题、截止、预估耗时', '如「写季度报告」1 小时'],
    ['点「保存」', '待办进入清单，自动归类'],
  ];
  steps.forEach((st, i) => {
    const x = 0.55 + i * 3.15;
    card(s, x, 1.5, 2.9, 3.6, C.white);
    s.addText(String(i + 1), { x: x + 0.95, y: 1.8, w: 1.0, h: 1.0, fontSize: 26, bold: true, color: C.blue, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.95, y: 1.8, w: 1.0, h: 1.0, fill: { color: C.blue, line: { type: 'none' } } });
    s.addText(st[0], { x: x + 0.2, y: 3.0, w: 2.5, h: 1.0, fontSize: 14, bold: true, color: C.dark, fontFace: FONT, align: 'center' });
    s.addText(st[1], { x: x + 0.2, y: 4.0, w: 2.5, h: 0.9, fontSize: 11.5, color: C.sub, fontFace: FONT, align: 'center' });
  });
  s.addText('跟着做一遍：现在就在你的软件里，新建一条待办试试。',
    { x: 0.55, y: 5.6, w: 12.2, h: 0.6, fontSize: 16, bold: true, color: C.green, fontFace: FONT, align: 'center' });
})();

// ================================================================
// 13. 常见问题
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '常见问题', 13);
  const qa = [
    ['数据会不会丢？', '不会。自动保存 + 自动备份（10 份）+ 可导出。'],
    ['为什么没出现在今日规划？', '需填写「预估耗时」，且未完成、未排程。'],
    ['自动排的时间能改吗？', '能，应用后就是普通日程，可编辑。'],
    ['快捷键没反应？', '确认软件在运行，且快捷键未被其他软件占用。'],
    ['怎么搬数据？', '旧电脑导出 → 新电脑导入。'],
  ];
  qa.forEach((it, i) => {
    const y = 1.45 + i * 1.05;
    s.addText('Q：' + it[0], { x: 0.55, y, w: 6, h: 0.9, fontSize: 14, bold: true, color: C.blue, fontFace: FONT, valign: 'middle' });
    s.addText('A：' + it[1], { x: 6.7, y, w: 6.1, h: 0.9, fontSize: 13, color: C.dark, fontFace: FONT, valign: 'middle' });
  });
})();

// ================================================================
// 14. 总结 & 考核
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.white);
  contentTitle(s, '培训总结', 14);
  card(s, 0.55, 1.5, 12.2, 3.0, C.light);
  s.addText('今天你学会了：', { x: 0.85, y: 1.7, w: 11, h: 0.5, fontSize: 20, bold: true, color: C.dark, fontFace: FONT });
  s.addText('① 记录日程和待办　② 快速捕捉想法　③ 用四象限排序\n④ 用时间块安排今天　⑤ 整理收件箱　⑥ 周回顾　⑦ 备份与同步',
    { x: 0.85, y: 2.35, w: 11.4, h: 1.9, fontSize: 16, color: C.dark, fontFace: FONT, lineSpacing: 30 });
  card(s, 0.55, 5.0, 12.2, 1.3, C.blue);
  s.addText('接下来：参加考核（15 题 / 100 分 / 及格 60 分），验证培训效果。',
    { x: 0.85, y: 5.15, w: 11.6, h: 1.0, fontSize: 16, bold: true, color: C.white, fontFace: FONT, valign: 'middle', align: 'center' });
})();

// ================================================================
// 15. 结束页
// ================================================================
(function () {
  const s = pptx.addSlide();
  bg(s, C.blue);
  s.addText('谢谢参加培训', { x: 0.55, y: 2.6, w: 12.2, h: 1.2, fontSize: 48, bold: true, color: C.white, fontFace: FONT, align: 'center' });
  s.addText('现在就开始：记下第一件事，把它排进今天的日程。', { x: 0.55, y: 4.0, w: 12.2, h: 0.6, fontSize: 18, color: C.white, fontFace: FONT, align: 'center' });
  s.addText('日程管理 v2.1.0', { x: 0.55, y: 5.8, w: 12.2, h: 0.5, fontSize: 14, color: C.white, fontFace: FONT, align: 'center' });
})();

// ---------- 输出 ----------
const outFile = path.join(__dirname, '日程管理-培训PPT.pptx');
pptx.writeFile({ fileName: outFile }).then(() => {
  console.log('已生成:', outFile);
}).catch((e) => {
  console.error('PPT 生成失败:', e);
  process.exit(1);
});
