/*
 * verify-packaged.js — 打包产物「真的能启动」的验收
 *
 * 为什么要单独有这一层：
 *   verify-asar.js 只检查「文件在不在包里、内容是否含某些关键字」。
 *   曾经出现过一种它完全抓不到的事故：打包时源码正被另一个进程改写，
 *   结果 app.asar 里的 shared/utils.js 被截断 —— 文件在、大小也对、关键字也在，
 *   verify-asar 全绿，但装上去主进程启动即 SyntaxError，用户看到的是空白/报错框。
 *
 *   所以这里不查内容，直接**把打包产物跑起来**，用真实运行结果说话：
 *     1. 用打包进 dist 的 app.asar 启动应用（隔离 userData，不碰真实数据）
 *     2. 主进程若抛异常，Electron 会把 "App threw an error during load" 打到 stderr → 判定失败
 *     3. 预置「启用内嵌同步服务」，启动后请求 /health —— 能通说明
 *        main.js、shared/*、server/src/* 全都正常加载并跑起来了
 *
 * 运行：node scripts/verify-packaged.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const ASAR = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
const PKG = require(path.join(ROOT, 'package.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

function healthCheck(port, timeoutMs) {
  return new Promise(function (resolve) {
    const req = http.get(
      { host: '127.0.0.1', port: port, path: '/health', timeout: timeoutMs },
      function (res) {
        let body = '';
        res.on('data', function (d) { body += d; });
        res.on('end', function () { resolve({ ok: res.statusCode === 200, status: res.statusCode, body: body }); });
      }
    );
    req.on('error', function (e) { resolve({ ok: false, error: e.message }); });
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, error: '超时' }); });
  });
}

async function main() {
  console.log('==== 打包产物启动验收 ====');
  console.log('asar : ' + ASAR);
  console.log('');

  const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const winExe = path.join(ROOT, 'dist', 'win-unpacked', PKG.productName + '.exe');

  check('app.asar 存在', fs.existsSync(ASAR));
  check('打包出的 exe 存在', fs.existsSync(winExe));
  if (!fs.existsSync(ASAR) || !fs.existsSync(electronBin)) {
    console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
    process.exit(1);
  }

  // 隔离 userData，并预置「启用内嵌同步服务」，以便用 /health 验证主进程真的启动完成
  const ud = path.join(os.tmpdir(), 'verify-packaged-' + Date.now());
  fs.mkdirSync(ud, { recursive: true });
  const PORT = 8791;
  fs.writeFileSync(path.join(ud, 'sync-server.json'), JSON.stringify({ enabled: true, port: PORT }), 'utf-8');

  const child = spawn(electronBin, [ASAR], {
    env: Object.assign({}, process.env, { SCHEDULE_USER_DATA_DIR: ud }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  child.stdout.on('data', function (d) { stdout += d.toString(); });
  child.stderr.on('data', function (d) { stderr += d.toString(); });

  let exited = false;
  let exitCode = null;
  child.on('exit', function (code) { exited = true; exitCode = code; });

  // 等启动；期间轮询 /health，一旦通了就没必要继续等
  let health = { ok: false };
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise(function (r) { setTimeout(r, 700); });
    if (exited) break;
    health = await healthCheck(PORT, 1500);
    if (health.ok) break;
  }

  console.log('== 启动结果 ==');
  check('主进程没有立即退出', !exited, exited ? ('exit code ' + exitCode) : '');
  // Electron 加载主脚本失败时的标志性输出
  const loadError = /App threw an error during load|SyntaxError|Cannot find module|Uncaught Exception/i.test(stderr);
  check('主进程加载无异常（stderr 无 SyntaxError / 模块缺失）', !loadError);
  if (loadError) {
    console.log('    --- stderr ---');
    stderr.split('\n').slice(0, 12).forEach(function (l) { if (l.trim()) console.log('    ' + l); });
  }

  console.log('== 内嵌同步服务（证明 shared/ 与 server/ 均正常加载）==');
  check('内置服务 /health 可访问（端口 ' + PORT + '）', health.ok === true,
    health.error || ('HTTP ' + health.status));

  try { child.kill(); } catch (e) { /* ignore */ }
  await new Promise(function (r) { setTimeout(r, 1200); });
  try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
