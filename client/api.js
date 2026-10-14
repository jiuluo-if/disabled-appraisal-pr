import { resultSchema } from '../gemini/lib/contracts.js';

export const apiBase = import.meta.env.VITE_API_BASE || '/api';

export async function analyze(input, signal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('分析超时，请稍后重试。', 'TimeoutError')), 110000);
  const cancel = () => timeout.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const response = await fetch(`${apiBase}/analyze`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      signal: timeout.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || `分析服务暂时不可用（${response.status}）。`);
    const parsed = resultSchema.safeParse(body?.result);
    if (!parsed.success || parsed.data.assessmentType !== input.assessmentType) {
      throw new Error('返回结果未通过完整性校验，请重新分析。');
    }
    return parsed.data;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}

export async function loadStandards(type, signal) {
  const response = await fetch(`${apiBase}/standards/${type}`, { signal });
  if (!response.ok) throw new Error('标准暂时无法加载，请稍后重试。');
  const body = await response.json();
  if (!body.standard || !Array.isArray(body.clauses)) throw new Error('标准数据格式异常。');
  return body;
}
