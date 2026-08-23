/*
 * index.js — 自然语言快速捕捉的统一入口（C 混合：规则优先，LLM 兜底）。
 *
 * parseQuickCapture(text, opts) → Promise<结果>
 *   opts: { ai, apiKey, categories, now, llmCall? }
 *   先跑 shared/nlp.js 规则解析；规则没抽出任何时间字段且 AI 已启用时，
 *   才调用 LLM（OpenAI 兼容）兜底；LLM 返回严格 JSON，解析/校验失败一律回退规则结果。
 *   绝不静默改数据：最终结果始终交回渲染层由用户确认。
 */
const Nlp = require('../shared/nlp.js');
const { callLlm } = require('./llm.js');

const SYSTEM_PROMPT =
  '你是日程管理的自然语言解析器。把用户输入的中文日程/待办解析为一个 JSON 对象，只输出 JSON，' +
  '不要任何多余文字、不要 markdown 代码块。字段（均可省略或为 null）：' +
  'title(字符串，去除时间/日期/优先级等修饰后的核心事项)、kind("todo"或"event")、' +
  'deadline(ISO 8601 时间字符串或 null，待办截止)、startTime(ISO 8601 或 null)、' +
  'endTime(ISO 8601 或 null)、allDay(布尔)、priority("low"|"medium"|"high" 或 null)、' +
  'importance("important"|"not_important" 或 null)、categoryName(字符串或 null)、' +
  'remindBefore(分钟数或 null)、estimatedMinutes(分钟数或 null)。' +
  '有明确时间段（开始+结束）的会议/活动 kind 用 "event"，否则 "todo"。';

const PRIORITY_SET = { low: 1, medium: 1, high: 1 };
const IMPORTANCE_SET = { important: 1, not_important: 1 };
const KIND_SET = { todo: 1, event: 1 };

function toTs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) return v;
  const t = new Date(v).getTime();
  return isFinite(t) ? t : null;
}
function nonEmpty(v) { return typeof v === 'string' && v.trim() !== ''; }
function validNumber(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

// 从 LLM 输出中提取 JSON 对象（容忍 markdown 代码块包裹）
function parseLlmJson(content) {
  const s = String(content || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    return (obj && typeof obj === 'object') ? obj : null;
  } catch (e) {
    return null;
  }
}

// LLM 结果覆盖规则结果（LLM 未给出的字段回退规则）
function mergeResult(rules, parsed) {
  return {
    raw: rules.raw,
    title: nonEmpty(parsed.title) ? parsed.title.trim() : rules.title,
    kind: KIND_SET[parsed.kind] ? parsed.kind : rules.kind,
    deadline: parsed.deadline != null ? toTs(parsed.deadline) : rules.deadline,
    startTime: parsed.startTime != null ? toTs(parsed.startTime) : rules.startTime,
    endTime: parsed.endTime != null ? toTs(parsed.endTime) : rules.endTime,
    allDay: parsed.allDay != null ? !!parsed.allDay : rules.allDay,
    priority: PRIORITY_SET[parsed.priority] ? parsed.priority : rules.priority,
    importance: IMPORTANCE_SET[parsed.importance] ? parsed.importance : rules.importance,
    categoryName: nonEmpty(parsed.categoryName) ? parsed.categoryName.trim() : rules.categoryName,
    remindBefore: validNumber(parsed.remindBefore) ? Number(parsed.remindBefore) : rules.remindBefore,
    estimatedMinutes: validNumber(parsed.estimatedMinutes) ? Number(parsed.estimatedMinutes) : rules.estimatedMinutes,
    confidence: rules.deadline == null && rules.startTime == null && (parsed.deadline != null || parsed.startTime != null) ? 0.9 : rules.confidence,
  };
}

async function parseQuickCapture(text, opts) {
  opts = opts || {};
  const now = opts.now != null ? opts.now : Date.now();
  const categories = opts.categories || [];
  const ai = opts.ai || {};

  const rules = Nlp.parse(text, { now: now, categories: categories });

  // 规则已抽出时间字段（deadline / startTime），无需 LLM；或 AI 未启用
  const aiReady = ai.enabled && ai.endpoint && ai.model;
  if (!aiReady || rules.deadline != null || rules.startTime != null) return rules;

  const llmCall = opts.llmCall || callLlm;
  try {
    const content = await llmCall(ai, opts.apiKey || '', [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: '当前时间：' + new Date(now).toString() + '\n用户输入：' + text },
    ]);
    const parsed = parseLlmJson(content);
    if (!parsed) return rules; // LLM 输出非法 -> 回退规则
    return mergeResult(rules, parsed);
  } catch (e) {
    return rules; // LLM 任何异常 -> 回退规则
  }
}

// 连通性测试：发一句固定输入，返回 LLM 回复原文
async function testConnection(ai, apiKey) {
  return callLlm(ai, apiKey, [
    { role: 'user', content: '请回复「连接成功」四个字' },
  ]);
}

module.exports = { parseQuickCapture: parseQuickCapture, testConnection: testConnection, parseLlmJson: parseLlmJson };
