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

// 四象限（艾森豪威尔矩阵）：重要性手动选择，紧急性由截止时间推导
const IMPORTANCE = {
  IMPORTANT: 'important',
  NOT_IMPORTANT: 'not_important',
};

const IMPORTANCE_LABEL = {
  important: '重要',
  not_important: '不重要',
};

const QUADRANT = {
  Q1: 'q1', // 重要且紧急
  Q2: 'q2', // 重要不紧急
  Q3: 'q3', // 不重要但紧急
  Q4: 'q4', // 不重要不紧急
};

const QUADRANT_LABEL = {
  q1: '重要且紧急',
  q2: '重要不紧急',
  q3: '不重要但紧急',
  q4: '不重要不紧急',
};

const QUADRANT_COLOR = {
  q1: '#e05b5b',
  q2: '#4f8ef7',
  q3: '#f2a541',
  q4: '#8a8f98',
};

const QUADRANT_ORDER = ['q1', 'q2', 'q3', 'q4'];

const URGENT_THRESHOLD_HOURS = 24; // 截止前多少小时内视为「紧急」

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
  IMPORTANCE,
  IMPORTANCE_LABEL,
  QUADRANT,
  QUADRANT_LABEL,
  QUADRANT_COLOR,
  QUADRANT_ORDER,
  URGENT_THRESHOLD_HOURS,
};
