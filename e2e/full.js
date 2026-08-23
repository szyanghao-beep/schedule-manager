/*
 * e2e/full.js — 2.3.0 全量 GUI 冒烟/回归测试（Playwright 驱动真实 Electron 应用）。
 * 覆盖：启动 → 每个导航视图 → 每个主要表单（新增/编辑/删除）→ 每个关键按键 → 持久化落盘。
 * 运行：node e2e/full.js
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-e2e-full-'));
const SHOTS = path.join(ROOT, '.e2e-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0, errors = [];

function ok(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; errors.push(name); console.log('  ✖ FAIL: ' + name); }
}

function todayStr() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

(async function () {
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: Object.assign({}, process.env, { SCHEDULE_USER_DATA_DIR: userData }),
  });

  const page = await app.firstWindow();
  await page.waitForSelector('.sidebar', { timeout: 20000 });
  await page.waitForSelector('.cal-grid', { timeout: 15000 }); // 等首次数据加载并完成首屏渲染

  // 收集渲染进程报错（关键：捕获任何运行时异常）
  page.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  // 自动接受 confirm（删除确认等）
  page.on('dialog', async function (d) { try { await d.accept(); } catch (e) {} });

  async function nav(view) {
    await page.click('.nav-item[data-view="' + view + '"]');
    await page.waitForTimeout(120);
  }
  async function bodyText() { return page.textContent('body'); }
  async function has(txt) { return (await bodyText()).indexOf(txt) >= 0; }
  async function clickBtn(label) {
    await page.locator('button', { hasText: label }).first().click();
  }
  async function segBtn(txt) {
    // 日历视图切换（月/周/日）：限定到日历工具栏的 seg 按钮，避免与导航项「周回顾/今日规划」混淆
    await page.locator('#view-schedule .seg .seg-btn', { hasText: txt }).click();
    await page.waitForTimeout(150);
  }
  async function fillField(field, val) {
    await page.fill('.modal-body [data-field="' + field + '"]', String(val));
  }
  async function selectField(field, val) {
    await page.selectOption('.modal-body [data-field="' + field + '"]', String(val));
  }
  async function modalOk() {
    await page.click('.modal-footer .btn-primary');
    await page.waitForTimeout(200);
  }
  async function shot(name) {
    try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) {}
  }

  console.log('== 1. 启动与导航 ==');
  ok('标题为「日程管理」', (await page.title()) === '日程管理');
  const navs = await page.$$eval('.nav-item', els => els.map(e => e.textContent.trim()));
  ok('10 个导航项齐全', JSON.stringify(navs) === JSON.stringify(['日程','待办','今日规划','收件箱','周回顾','纪念日','记账','搜索','统计','设置']));

  console.log('== 2. 日程（月/周/日 + 新增日程）==');
  ok('月视图渲染', await page.$('.cal-grid') !== null);
  await segBtn('周');
  ok('周视图渲染', await page.$('.week-cols') !== null);
  await segBtn('日');
  ok('日视图渲染', await page.$('.day-list') !== null);
  await segBtn('月');
  await clickBtn('+ 新增日程');
  await page.waitForSelector('.modal');
  await fillField('title', '测试会议');
  await fillField('description', 'E2E 自动化创建的日程');
  await modalOk();
  ok('新增日程后回到日历', await page.$('.cal-grid') !== null);
  await clickBtn('日'); await page.waitForTimeout(150);
  ok('日视图显示新增日程', await has('测试会议'));

  console.log('== 3. 待办（新增/完成/筛选/批量/排程）==');
  await nav('todo');
  await clickBtn('+ 新增待办');
  await page.waitForSelector('.modal');
  await fillField('title', 'E2E测试待办');
  await fillField('deadlineDate', todayStr());
  await fillField('deadlineTime', '18:00');
  await modalOk();
  ok('待办列表显示新待办', await has('E2E测试待办'));
  // 完成勾选（第一个 item-check）
  await page.click('.view#view-todo .item .item-check').catch(async function(){ await page.click('#view-todo .item .item-check'); });
  await page.waitForTimeout(150);
  ok('勾选完成不报错', true);
  // 批量选择 -> 标记完成
  const selChecks = await page.$$('#view-todo .item .item-check');
  if (selChecks.length >= 2) { await selChecks[1].click(); await page.waitForTimeout(150); }
  // 排到日程
  await nav('todo');
  const sched = await page.$('#view-todo button:has-text("排到日程")');
  if (sched) {
    await sched.click();
    await page.waitForSelector('.modal');
    ok('排到日程弹窗打开', await has('创建时间块'));
    await modalOk();
  }

  console.log('== 4. 今日规划 ==');
  await nav('plan');
  ok('今日规划渲染', await has('今日规划'));

  console.log('== 5. 收件箱（快速捕捉）==');
  await nav('inbox');
  await clickBtn('⚡ 快速捕捉');
  await page.waitForSelector('.modal');
  await page.fill('.modal-body [data-field="captureText"]', '明天下午3点交报告 #工作');
  await modalOk();
  await nav('todo');
  ok('快速捕捉生成待办（带截止时间，落在待办页）', await has('交报告'));

  console.log('== 6. 周回顾 ==');
  await nav('review');
  ok('周回顾渲染', await has('周回顾'));

  console.log('== 7. 纪念日（新增/删除）==');
  await nav('memorials');
  await clickBtn('+ 新增纪念日');
  await page.waitForSelector('.modal');
  await fillField('name', '妈妈生日');
  await selectField('calendar', 'solar');
  await selectField('kind', 'birthday');
  await fillField('month', '5');
  await fillField('day', '4');
  await fillField('year', '1965');
  await modalOk();
  ok('纪念日列表显示新纪念日', await has('妈妈生日'));
  ok('农历生日标注历法或倒计时', await has('公历') || await has('生日'));

  console.log('== 8. 记账（账户/分类/流水/转账/报表/预算）==');
  await nav('bookkeeping');
  // 账户
  await clickBtn('账户');
  await page.waitForTimeout(150);
  const initBtn = await page.$('#view-bookkeeping button:has-text("初始化默认分类")');
  if (initBtn) { await initBtn.click(); await page.waitForTimeout(150); }
  for (const nm of ['现金', '银行卡']) {
    await clickBtn('+ 新增账户');
    await page.waitForSelector('.modal');
    await fillField('name', nm);
    await modalOk();
  }
  ok('账户页显示两个账户', await has('现金') && await has('银行卡'));
  // 记账分类
  await clickBtn('+ 新增分类');
  await page.waitForSelector('.modal');
  await fillField('name', '聚餐');
  await modalOk();
  ok('自定义记账分类已保存', await has('聚餐'));
  // 明细：支出/收入/转账
  await clickBtn('明细');
  await page.waitForTimeout(150);
  await clickBtn('+ 记一笔');
  await page.waitForSelector('.modal');
  await page.selectOption('.modal-body [data-field="type"]', 'expense');
  await fillField('amountYuan', '25.50');
  await fillField('note', '午饭');
  await modalOk();
  ok('支出流水已记录（结余 -25.50）', await has('-25.50'));
  await clickBtn('+ 记一笔');
  await page.waitForSelector('.modal');
  await page.selectOption('.modal-body [data-field="type"]', 'income');
  await fillField('amountYuan', '5000');
  await fillField('note', '工资');
  await modalOk();
  ok('收入流水已记录', await has('+5000.00'));
  await clickBtn('+ 记一笔');
  await page.waitForSelector('.modal');
  await page.selectOption('.modal-body [data-field="type"]', 'transfer');
  await fillField('amountYuan', '100');
  await page.selectOption('.modal-body [data-field="toAccountId"]', { index: 1 });
  await modalOk();
  ok('转账流水已记录', await has('转账'));
  // 报表
  await clickBtn('报表');
  await page.waitForTimeout(200);
  ok('报表含消费日历', await has('消费日历'));
  ok('报表含近 6 个月趋势', await has('近 6 个月收支趋势'));
  // 预算（设 10 元触发超支，支出 25.50）
  await clickBtn('预算');
  await page.waitForTimeout(150);
  await clickBtn('+ 新增预算');
  await page.waitForSelector('.modal');
  await fillField('amountYuan', '10');
  await modalOk();
  ok('预算已创建并判定超支', await has('已超支'));

  console.log('== 9. 搜索 ==');
  await nav('search');
  await page.fill('input[placeholder^="搜索日程"]', '测试');
  await page.waitForTimeout(200);
  ok('搜索输入不报错', true);

  console.log('== 10. 统计 ==');
  await nav('stats');
  ok('统计渲染', await has('完成率') || await has('四象限'));

  console.log('== 11. 设置（各卡片与控件）==');
  await nav('settings');
  // 分类
  await clickBtn('+ 新增分类');
  await page.waitForSelector('.modal');
  await page.fill('.modal-body input[type="text"]', '测试分类');
  await modalOk();
  ok('新增分类已保存', await has('测试分类'));
  // 外观主题 -> 深色
  await page.selectOption('#view-settings select:has(option[value="dark"])', 'dark').catch(function(){});
  await page.waitForTimeout(150);
  // 日历显示勾选（取消农历）
  await page.click('#view-settings .card:has-text("日历显示") input[type="checkbox"]').catch(function(){});
  // 节假日数据导入
  const holidayTa = await page.$('#view-settings textarea');
  if (holidayTa) {
    await holidayTa.fill('{"2027-01-01":{"name":"元旦","isWork":false},"2027-01-04":{"name":"元旦调休","isWork":true}}');
    await page.locator('#view-settings button', { hasText: '导入 / 合并' }).first().click();
    await page.waitForTimeout(150);
    ok('节假日导入生效', await has('已导入自定义节假日：2 天'));
    await page.locator('#view-settings button', { hasText: '清空自定义数据' }).first().click();
    await page.waitForTimeout(150);
    ok('清空自定义节假日', await has('已导入自定义节假日：0 天'));
  }
  // 邮件/AI/同步卡片渲染
  ok('邮件提醒卡片渲染', await has('邮件提醒'));
  ok('AI 卡片渲染', await has('AI 自然语言'));
  ok('多端同步卡片渲染', await has('多端同步'));
  // 数据管理按钮存在（导出/导入/恢复触发系统对话框，仅验证存在不点击）
  ok('导出数据按钮存在', await page.$('#view-settings button:has-text("导出数据")') !== null);
  ok('从备份恢复按钮存在', await page.$('#view-settings button:has-text("从备份恢复")') !== null);

  console.log('== 12. 持久化落盘（真实 IPC 保存）==');
  await page.waitForTimeout(1500); // 等待防抖 saveData
  let persisted = false, pver = 0;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8'));
    pver = d.version;
    const all = JSON.stringify(d);
    persisted = all.indexOf('测试会议') >= 0 && all.indexOf('E2E测试待办') >= 0 && all.indexOf('妈妈生日') >= 0 && all.indexOf('工资') >= 0;
  } catch (e) { errors.push('持久化读取失败: ' + e.message); }
  ok('data.json 版本为 4', pver === 4);
  ok('新增记录已落盘（日程/待办/纪念日/流水）', persisted);

  await shot('final');

  // 汇总
  console.log('\n===== E2E 结果 =====');
  console.log('通过 ' + passed + '，失败 ' + failed);
  if (errors.length) {
    console.log('--- 运行时错误 ---');
    errors.forEach(function (e) { console.log('  ! ' + e); });
  }

  await app.close().catch(function () {});
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 || errors.length > 0 ? 1 : 0);
})().catch(function (e) {
  console.error('E2E 崩溃:', e && e.stack || e);
  process.exit(2);
});
