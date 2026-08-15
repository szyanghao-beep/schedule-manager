/**
 * metro.config.js — Metro 打包配置。
 *
 * 关键点：Metro 默认只打包项目目录内的文件。本项目的共享包位于项目外
 * （../shared，即 E:\DSH\日程管理工具\shared），必须通过 watchFolders
 * 把它纳入打包监视范围，代码里才能 require('../../shared/index.js')。
 *
 * resolver.nodeModulesPaths 显式声明 node_modules 查找路径，
 * 保证 watchFolders 扩展后依赖解析行为可预期（数组会被 mergeConfig 合并去重）。
 *
 * 如果该方案在目标 RN 版本出现兼容问题，可退化为「复制 shared 到 src/shared」
 * （见 README「与 shared 的复用说明」），只需改 src/shared.js 一处。
 */
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  // 把项目外共享包目录加入监视与打包范围（单一来源，不复制）
  watchFolders: [path.resolve(__dirname, '../shared')],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(defaultConfig, config);
