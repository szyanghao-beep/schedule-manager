/*
 * fill-stress-data.js — 生成 2 年压测数据并写入应用 userData/data.json。
 * 用法：node fill-stress-data.js
 * 写入前会把现有 data.json 备份到同目录带时间戳的 .bak 文件，不丢失原数据。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateStressData } = require('./test/stress-data.js');

const appName = '日程管理'; // 与 package.json productName 一致
const userData = path.join(os.homedir(), 'AppData', 'Roaming', appName);
const dataFile = path.join(userData, 'data.json');

const data = generateStressData({});
data.notified = {};
data.statsHistory = [];

if (fs.existsSync(dataFile)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = dataFile + '.bak-' + stamp;
  fs.copyFileSync(dataFile, bak);
  console.log('已备份现有数据到 ' + bak);
}

fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
console.log('已写入 ' + data.events.length + ' 条日程、' + data.todos.length + ' 条待办 → ' + dataFile);
