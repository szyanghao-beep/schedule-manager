#!/usr/bin/env node
/*
 * negcheck.js — 负向验证工具：把代码「改坏」跑一遍测试，确认它**确实会变红**，然后自动还原。
 *
 * 为什么需要：一个测试如果不管代码怎么写都是绿的，那它什么也没保证。
 * 所以每处关键断言都要做一次负向验证（把被测逻辑破坏掉，看测试是否失败）。
 *
 * 用法：
 *   node tools/negcheck.js <文件> "<要替换的原文>" "<替换成>" -- <测试命令...>
 *
 * 例：
 *   node tools/negcheck.js shared/sync.js "if (lost > tombstones) {" "if (false) {" -- node --test test/sync-dataloss.test.js
 *
 * 退出码：0 = 负向验证通过（改坏后测试确实失败）；1 = 改坏后测试仍然通过（断言无效）；
 *        2 = 用法/文件错误。无论结果如何都会还原文件（含异常中断）。
 *
 * 注意：改文件一律用 Node 读写（UTF-8），**不要**用 PowerShell 的
 * Get-Content/Set-Content —— 那会把中文重新编码成乱码（本仓库踩过这个坑）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  console.error('用法: node tools/negcheck.js <文件> "<原文>" "<替换>" -- <测试命令...>');
  process.exit(2);
}

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 0 || sep < 3) usage();

const file = argv[0];
const from = argv[sep - 2];
const to = argv[sep - 1];
const cmd = argv.slice(sep + 1);
if (!cmd.length) usage();

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error('文件不存在：' + abs);
  process.exit(2);
}

const original = fs.readFileSync(abs, 'utf8');
const count = original.split(from).length - 1;
if (count === 0) {
  console.error('原文在文件中找不到（注意空格/换行要完全一致）：\n' + from);
  process.exit(2);
}

const broken = original.split(from).join(to);
if (broken === original) {
  console.error('替换后内容没变化，请检查参数');
  process.exit(2);
}

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  fs.writeFileSync(abs, original, 'utf8');
}
process.on('exit', restore);
process.on('SIGINT', function () { restore(); process.exit(130); });

console.log('[negcheck] 破坏 ' + file + '（' + count + ' 处）：');
console.log('  - ' + from.trim());
console.log('  + ' + to.trim());
console.log('[negcheck] 运行：' + cmd.join(' '));

fs.writeFileSync(abs, broken, 'utf8');
let result;
try {
  result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: process.cwd(),
  });
} finally {
  restore();
}

const failed = result && (result.status !== 0 || result.signal);
console.log('\n[negcheck] 测试退出码: ' + (result ? result.status : 'null') +
  '（已还原 ' + file + '）');
if (failed) {
  console.log('[negcheck] ✅ 负向验证通过：把逻辑改坏后测试确实失败了，说明这条断言真的在管事。');
  process.exit(0);
}
console.log('[negcheck] ❌ 负向验证失败：逻辑已经改坏，测试却仍然是绿的 —— 这条断言语义无效，需要重写。');
process.exit(1);
