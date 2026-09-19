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

// 提醒提前时间选项（分钟），0 表示不提醒；含小时/天级（120/180/720/1440/2880）
const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 180, 720, 1440, 2880];

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

// 预估耗时选项（分钟，时间块排程用）
const ESTIMATED_MINUTES_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];

// 默认工作时段（自动排程的时间窗，本地时区小时数）
const WORK_HOURS = { start: 9, end: 18 };

// 自动排程默认槽位粒度与块间缓冲（分钟）
const SCHEDULE_SLOT_MINUTES = 30;
const SCHEDULE_BUFFER_MINUTES = 5;

// ---- 2.3.0：日历（农历/节气/节假日）----
const CALENDAR_DEFAULTS = { showLunar: true, showSolarTerms: true, showHolidays: true, restDayAffectsPlanning: true };

// ---- 2.3.0：收支记账 ----
const BOOKKEEPING_DEFAULTS = { defaultAccountId: '', defaultCurrency: 'CNY' };

const ACCOUNT_TYPES = ['cash', 'bank', 'credit', 'ewallet', 'investment', 'other'];
const ACCOUNT_TYPE_LABEL = { cash: '现金', bank: '银行卡', credit: '信用卡', ewallet: '电子钱包', investment: '投资', other: '其他' };
const ACCOUNT_ICON = { cash: '💵', bank: '🏦', credit: '💳', ewallet: '📱', investment: '📈', other: '🏷️' };

const TXN_TYPES = ['expense', 'income', 'transfer'];
const TXN_TYPE_LABEL = { expense: '支出', income: '收入', transfer: '转账' };

// 记账二级分类默认值（独立于日程分类，决策 #1）；type 区分收入/支出
const BOOKKEEPING_DEFAULT_CATEGORIES = [
  { name: '餐饮', type: 'expense', color: '#e05b5b' },
  { name: '交通', type: 'expense', color: '#4f8ef7' },
  { name: '购物', type: 'expense', color: '#8e6fd8' },
  { name: '居住', type: 'expense', color: '#4caf7d' },
  { name: '娱乐', type: 'expense', color: '#f2a541' },
  { name: '医疗', type: 'expense', color: '#4ec2c9' },
  { name: '工资', type: 'income', color: '#4caf7d' },
  { name: '奖金', type: 'income', color: '#4f8ef7' },
  { name: '理财', type: 'income', color: '#8e6fd8' },
  { name: '其他收入', type: 'income', color: '#8a8f98' },
];

// 纪念日种类
const MEMORIAL_KINDS = ['birthday', 'anniversary', 'other'];
const MEMORIAL_KIND_LABEL = { birthday: '生日', anniversary: '纪念日', other: '其他' };

// ---- 2.3.2：客户商机跟进 ----
// 商机阶段（按推进顺序排列；won / lost 为终态）
const CUSTOMER_STAGES = ['lead', 'needs', 'demo', 'quote', 'negotiate', 'won', 'lost'];
const CUSTOMER_STAGE_LABEL = {
  lead: '发现商机', needs: '需求沟通', demo: '系统演示',
  quote: '商务报价', negotiate: '合同谈判', won: '赢单', lost: '输单',
};
const CUSTOMER_STAGE_COLOR = {
  lead: '#8a8f98', needs: '#4f8ef7', demo: '#8e6fd8',
  quote: '#f2a541', negotiate: '#e0863c', won: '#4caf7d', lost: '#c0796b',
};
const CUSTOMER_ACTIVE_STAGES = ['lead', 'needs', 'demo', 'quote', 'negotiate']; // 推进中
const CUSTOMER_CLOSED_STAGES = ['won', 'lost'];                               // 终态

// 跟进方式
const FOLLOWUP_METHODS = ['phone', 'wechat', 'visit', 'email', 'demo', 'other'];
const FOLLOWUP_METHOD_LABEL = {
  phone: '电话', wechat: '微信', visit: '拜访', email: '邮件', demo: '演示', other: '其他',
};
const FOLLOWUP_METHOD_ICON = {
  phone: '📞', wechat: '💬', visit: '🤝', email: '✉️', demo: '🖥️', other: '📝',
};

// 金额记录类型：预估（可多次调整）/ 落单（确认成交，仅一次）/ 增购（可多次累加）
const AMOUNT_KIND = { ESTIMATE: 'estimate', DEAL: 'deal', UPSELL: 'upsell' };
const AMOUNT_KIND_LABEL = { estimate: '预估', deal: '落单确认', upsell: '增购' };

const FOLLOWUP_TODO_MINUTES = 30; // 跟进待办默认预估耗时（分钟）

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
  ESTIMATED_MINUTES_OPTIONS,
  WORK_HOURS,
  SCHEDULE_SLOT_MINUTES,
  SCHEDULE_BUFFER_MINUTES,
  CALENDAR_DEFAULTS,
  BOOKKEEPING_DEFAULTS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_ICON,
  TXN_TYPES,
  TXN_TYPE_LABEL,
  BOOKKEEPING_DEFAULT_CATEGORIES,
  MEMORIAL_KINDS,
  MEMORIAL_KIND_LABEL,
  CUSTOMER_STAGES,
  CUSTOMER_STAGE_LABEL,
  CUSTOMER_STAGE_COLOR,
  CUSTOMER_ACTIVE_STAGES,
  CUSTOMER_CLOSED_STAGES,
  FOLLOWUP_METHODS,
  FOLLOWUP_METHOD_LABEL,
  FOLLOWUP_METHOD_ICON,
  AMOUNT_KIND,
  AMOUNT_KIND_LABEL,
  FOLLOWUP_TODO_MINUTES,
};
