/*
 * constants.js — 共享常量（状态/优先级/周期/分类枚举与默认值）
 * 主进程 require、preload 注入渲染进程，作为单一数据源。
 */

const STATUS = {
  PENDING: 'pending',
  DOING: 'doing',
  DONE: 'done',
  OVERDUE: 'overdue',
};

const STATUS_LABEL = {
  pending: '未开始',
  doing: '进行中',
  done: '已完成',
  overdue: '已过期',
};

const PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

const PRIORITY_LABEL = {
  low: '低',
  medium: '中',
  high: '高',
};

const PRIORITY_ORDER = { low: 0, medium: 1, high: 2 };

const REPEAT_TYPE = {
  NONE: 'none',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  CUSTOM: 'custom',
};

const REPEAT_LABEL = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  custom: '自定义',
};

// 提醒提前时间选项（分钟），0 表示不提醒
const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60];

// 默认分类
const DEFAULT_CATEGORIES = [
  { name: '工作', color: '#4f8ef7' },
  { name: '生活', color: '#4caf7d' },
  { name: '学习', color: '#f2a541' },
];

// 可选颜色板
const CATEGORY_COLORS = [
  '#4f8ef7', '#4caf7d', '#f2a541', '#e05b5b',
  '#8e6fd8', '#4ec2c9', '#d078a5', '#8a8f98',
];

// 未分类兜底
const UNCATEGORIZED = { categoryId: '', categoryName: '未分类', categoryColor: '#8a8f98' };

module.exports = {
  STATUS,
  STATUS_LABEL,
  PRIORITY,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  REPEAT_TYPE,
  REPEAT_LABEL,
  REMIND_OPTIONS,
  DEFAULT_CATEGORIES,
  CATEGORY_COLORS,
  UNCATEGORIZED,
};
