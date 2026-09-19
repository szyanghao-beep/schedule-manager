/*
 * verify-asar.js — 打包产物验收（安装包内容完整性）
 *
 * 用途：检查构建出的 app.asar 是否包含本次修复与全部运行时必需文件，
 *       避免「源码修了但没进安装包」这类问题（用户上报的 bug 就属于这一类）。
 *
 * 运行：node scripts/verify-asar.js [asar路径]
 *       默认 dist/win-unpacked/resources/app.asar
 */
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

const asarPath = process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
if (!fs.existsSync(asarPath)) {
  console.error('asar 不存在：' + asarPath);
  process.exit(1);
}

const files = asar.listPackage(asarPath);
const norm = function (f) { return f.replace(/\\/g, '/').replace(/^\//, ''); };
const set = new Set(files.map(norm));

function readFile(rel) {
  // Windows 上 asar 内部路径为反斜杠，逐种形式尝试
  const candidates = [rel.split('/').join('\\'), rel, '/' + rel];
  for (let i = 0; i < candidates.length; i++) {
    try { return asar.extractFile(asarPath, candidates[i]).toString('utf-8'); } catch (e) { /* 试下一种 */ }
  }
  return null;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('==== 打包产物验收 ====');
console.log('asar   : ' + asarPath);
console.log('文件数 : ' + files.length);
console.log('');

console.log('== 本次修复是否进包（设置页 API 漏透传）==');
const apiSrc = readFile('src/renderer/js/api.js');
check('能读取 api.js', !!apiSrc);
if (apiSrc) {
  ['syncServerStatus', 'syncServerStart', 'syncServerStop'].forEach(function (m) {
    check('api.js 透传 ' + m, apiSrc.indexOf(m) >= 0);
  });
}
const preloadSrc = readFile('preload.js');
check('preload.js 暴露 syncServerStatus', !!preloadSrc && preloadSrc.indexOf('syncServerStatus') >= 0);
const settingsSrc = readFile('src/renderer/js/modules/settings.js');
check('settings.js 渲染「本机同步服务」卡片', !!settingsSrc && settingsSrc.indexOf('本机同步服务') >= 0);

console.log('');
console.log('== 关键运行时文件 ==');
[
  'main.js', 'preload.js', 'package.json',
  'server/src/app.js', 'server/src/db.js', 'server/src/inboxDrop.js', 'server/src/auth.js', 'server/src/syncRoutes.js',
  'shared/utils.js', 'shared/constants.js', 'shared/sync.js', 'shared/inbox.js', 'shared/customer.js',
  'src/renderer/index.html',
  'src/renderer/js/api.js', 'src/renderer/js/store.js', 'src/renderer/js/app.js',
  'src/renderer/js/modules/customer.js', 'src/renderer/js/modules/settings.js',
  'build/icon.png',
].forEach(function (f) {
  check(f, set.has(f));
});

console.log('');
console.log('== 生产依赖（内嵌服务器 / 农历 / 邮件）==');
['express', 'cors', 'bcryptjs', 'jsonwebtoken', 'nodemailer', 'lunar-javascript'].forEach(function (d) {
  check('node_modules/' + d, set.has('node_modules/' + d + '/package.json'));
});

console.log('');
console.log('== 不应进包的内容 ==');
check('不含 server/node_modules（应复用根依赖）', !set.has('server/node_modules'));
check('不含测试文件 test/', !Array.from(set).some(function (f) { return f.indexOf('test/') === 0; }));
check('不含 mobile 源码', !Array.from(set).some(function (f) { return f.indexOf('mobile/') === 0; }));

console.log('');
console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exitCode = fail === 0 ? 0 : 1;
