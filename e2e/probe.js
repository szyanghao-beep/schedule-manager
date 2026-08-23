// e2e/probe.js — 探针：验证 Playwright 能否驱动真实 Electron 应用
const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-e2e-'));

(async function () {
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: Object.assign({}, process.env, { SCHEDULE_USER_DATA_DIR: tmp }),
  });
  try {
    const page = await app.firstWindow();
    console.log('TITLE:', await page.title());
    await page.waitForSelector('.sidebar', { timeout: 15000 });
    const nav = await page.$$eval('.nav-item', els => els.map(e => e.textContent.trim()));
    console.log('NAV:', JSON.stringify(nav));
    const bodyText = await page.textContent('body');
    console.log('BODY_HAS_日程管理:', bodyText.indexOf('日程管理') >= 0);
    await page.screenshot({ path: path.join(ROOT, '.e2e-probe.png') });
  } finally {
    await app.close().catch(function () {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().then(function () { console.log('PROBE_OK'); }).catch(function (e) {
  console.error('PROBE_FAIL', e && e.message);
  process.exit(1);
});
