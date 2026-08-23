/*
 * llm.js — 可选 LLM 调用（OpenAI 兼容 /chat/completions 协议，Ollama 也走此协议）。
 * 主进程专用（使用 fetch）；无副作用，失败抛错由上层兜底。
 */
async function callLlm(aiSettings, apiKey, messages) {
  const endpoint = String((aiSettings && aiSettings.endpoint) || '').replace(/\/+$/, '');
  if (!endpoint) throw new Error('未配置 AI endpoint');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

  const res = await fetch(endpoint + '/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: (aiSettings && aiSettings.model) || 'qwen2.5:7b',
      messages: messages,
      temperature: 0,
    }),
  });

  const json = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const msg = json && json.error && (json.error.message || json.error) ? (json.error.message || json.error) : ('HTTP ' + res.status);
    throw new Error(msg);
  }
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('LLM 返回为空');
  return content;
}

module.exports = { callLlm: callLlm };
