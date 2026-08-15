/*
 * index.js — shared 共享包统一入口（desktop / server / mobile 三方共用）
 */

'use strict';

module.exports = {
  constants: require('./constants.js'),
  utils: require('./utils.js'),
  migrate: require('./migrate.js'),
  sync: require('./sync.js'),
  model: require('./model.js'),
};
