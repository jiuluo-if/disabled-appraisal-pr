import { resultSchema } from '../gemini/lib/contracts.js';

export const apiBase = import.meta.env.VITE_API_BASE || '/api';

export async function analyze(input, signal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('分析超时，请稍后重试。', 'TimeoutError')), 110000);
  const cancel = () => timeout.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    let response;
    try {
      response = await fetch(`${apiBase}/analyze`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        signal: timeout.signal });
    } catch {
      if (timeout.signal.aborted) throw timeout.signal.reason;
      throw new Error('未能收到分析服务的响应，请检查网络后重试。');
    }
    const body = await response.json().catch(() => null);
    const requestId = response.headers.get('x-request-id') || body?.error?.requestId;
    const failed = message => new Error(`${message}${requestId ? `\n请求编号：${String(requestId).slice(0, 80)}` : ''}`);
    if (!response.ok) throw failed(body?.error?.message || `分析服务暂时不可用（${response.status}）。`);
    const parsed = resultSchema.safeParse(body?.result);
    if (!parsed.success || parsed.data.assessmentType !== input.assessmentType) {
      throw failed('返回结果未通过完整性校验，请重新分析。');
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
