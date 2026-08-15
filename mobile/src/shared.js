/**
 * shared.js — 共享包在 mobile 端的统一引用点（全项目唯一需要关心 shared 路径的文件）。
 *
 * 默认方案：Metro watchFolders 直接复用项目外共享目录（单一来源，不复制）：
 *   require('../../shared/index.js')  →  E:\DSH\日程管理工具\shared\index.js
 *
 * 退化方案（若 watchFolders 在目标 RN 版本有兼容问题）：
 *   1) 把共享包 4 个 js 文件复制进本目录：
 *        xcopy /E /I /Y ..\..\shared src\shared   （在 mobile/ 下执行）
 *   2) 把下面这一行改为：module.exports = require('./shared/index.js');
 *   其余代码（api/store/syncClient/界面）无需任何改动。
 */
module.exports = require('../../shared/index.js');
