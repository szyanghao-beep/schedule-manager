/*
 * e2e/installed-smoke.js — 对「真实安装版」应用的冒烟测试。
 * 直接驱动 %LOCALAPPDATA%\Programs\schedule-manager\日程管理.exe（打包产物，非源码），
 * 用隔离的 SCHEDULE_USER_DATA_DIR 避免污染真实数据。
 * 覆盖：启动 → 标题/导航 → 记账（未分类支出计入总预算的修复）→ 落盘。
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXE = process.env.SMOKE_EXE || path.join(process.env.LOCALAPPDATA, 'Programs', 'schedule-manager', '日程管理.exe');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-installed-smoke-'));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✖ FAIL: ' + name); }
}

(async function () {
  if (!fs.existsSync(EXE)) { console.error('未找到已安装应用: ' + EXE); process.exit(2); }

  const app = await electron.launch({
    executablePath: EXE,
    env: Object.assign({}, process.env, { SCHEDULE_USER_DATA_DIR: userData }),
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.sidebar', { timeout: 20000 });
  await page.waitForSelector('.cal-grid', { timeout: 15000 });

  ok('标题为「日程管理」', (await page.title()) === '日程管理');
  const navs = await page.$$eval('.nav-item', els => els.map(e => e.textContent.trim()));
  ok('10 个导航项齐全', JSON.stringify(navs) === JSON.stringify(['日程','待办','今日规划','收件箱','周回顾','纪念日','记账','搜索','统计','设置']));

  // 记账：未分类支出应计入总预算（对应 budgetStatus 修复）
  await page.click('.nav-item[data-view="bookkeeping"]');
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: '账户' }).first().click();
  await page.waitForTimeout(150);
  await page.locator('button', { hasText: '+ 新增账户' }).first().click();
  await page.waitForSelector('.modal');
  await page.fill('.modal-body [data-field="name"]', '现金');
  await page.click('.modal-footer .btn-primary');
  await page.waitForTimeout(200);

  await page.locator('button', { hasText: '明细' }).first().click();
  await page.waitForTimeout(150);
  await page.locator('button', { hasText: '+ 记一笔' }).first().click();
  await page.waitForSelector('.modal');
  await page.selectOption('.modal-body [data-field="type"]', 'expense');
  await page.fill('.modal-body [data-field="amountYuan"]', '25.50');
  await page.click('.modal-footer .btn-primary');
  await page.waitForTimeout(200);

  await page.locator('button', { hasText: '预算' }).first().click();
  await page.waitForTimeout(150);
  await page.locator('button', { hasText: '+ 新增预算' }).first().click();
  await page.waitForSelector('.modal');
  await page.fill('.modal-body [data-field="amountYuan"]', '10');
  await page.click('.modal-footer .btn-primary');
  await page.waitForTimeout(200);
  ok('未分类支出计入总预算并判定超支', (await page.textContent('body')).indexOf('已超支') >= 0);

  // 设置页：restDayAffectsPlanning 开关存在（A6 可开关）
  await page.click('.nav-item[data-view="settings"]');
  await page.waitForTimeout(200);
  const calCheckboxes = await page.$$eval('#view-settings .card:has-text("日历显示") input[type="checkbox"]', els => els.length);
  ok('日历显示卡片含 4 个开关（含「休息日暂停排程」）', calCheckboxes >= 4);

  // 落盘
  await page.waitForTimeout(1500);
  let persisted = false, ver = 0, defaultAcct = false;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8'));
    ver = d.version;
    persisted = JSON.stringify(d).indexOf('现金') >= 0;
    defaultAcct = !!(d.settings && d.settings.bookkeeping && d.settings.bookkeeping.defaultAccountId);
  } catch (e) {}
  ok('已安装版数据落盘（版本 4）', ver === 4 && persisted);
  ok('首个账户已写入默认账户 id', defaultAcct);

  console.log('\n===== 安装版冒烟 =====');
  console.log('通过 ' + passed + '，失败 ' + failed);
  await app.close().catch(function () {});
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch(function (e) {
  console.error('安装版冒烟崩溃:', e && e.stack || e);
  process.exit(2);
});
