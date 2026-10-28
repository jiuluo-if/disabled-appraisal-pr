import { MAX_REQUEST_TIMEOUT_MS } from './request-timeouts.js';

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_CACHE_TTL_MS = 900_000;
const DEFAULT_CACHE_CAPACITY = 200;
const DEFAULT_CORS_ORIGINS = ['https://analyst.lintsing.net', 'https://appraise.lintsing.net'];
const LOCAL_CORS_ORIGINS = ['http://127.0.0.1:5300', 'http://localhost:5300'];

function integer(env, name, fallback, minimum, maximum) {
  const raw = env[name];
  const value = Number(raw === undefined || raw === '' ? fallback : raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

function temperature(env, name, fallback) {
  const value = Number(env[name] === undefined || env[name] === '' ? fallback : env[name]);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function completionUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function corsOrigins(env) {
  const defaults = env.NODE_ENV === 'production'
    ? DEFAULT_CORS_ORIGINS : [...DEFAULT_CORS_ORIGINS, ...LOCAL_CORS_ORIGINS];
  const origins = env.CORS_ALLOWED_ORIGINS === undefined
    ? defaults : [...new Set(env.CORS_ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean))];
  for (const origin of origins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('Invalid CORS_ALLOWED_ORIGINS'); }
    const localHttp = env.NODE_ENV !== 'production' && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)
      || url.username || url.password || url.protocol !== 'https:' && !localHttp) {
      throw new Error('Invalid CORS_ALLOWED_ORIGINS');
    }
  }
  return origins;
}

export function loadProviderConfig(env = process.env) {
  const provider = (env.ASSESSMENT_PROVIDER || 'agnes').trim().toLowerCase();
  if (!['agnes', 'kimi'].includes(provider)) throw new Error('ASSESSMENT_PROVIDER must be agnes or kimi');

  const base = provider === 'agnes'
    ? env.AGNES_BASE_URL || 'https://api.agnes-ai.cn/v1'
    : env.KIMI_API_URL || 'https://api.moonshot.cn/v1/chat/completions';
  if (provider === 'agnes' && new URL(base).protocol !== 'https:') throw new Error('AGNES_BASE_URL must use HTTPS');
  const apiUrl = provider === 'agnes' ? completionUrl(base) : new URL(base).toString();
  const apiKey = provider === 'agnes' ? env.AGNES_API_KEY : env.KIMI_API_KEY;
  const keyName = provider === 'agnes' ? 'AGNES_API_KEY' : 'KIMI_API_KEY';
  if (!apiKey?.trim() || apiKey.startsWith('replace-with-')) throw new Error(`${keyName} is required`);

  const prefix = provider === 'agnes' ? 'AGNES' : 'KIMI';
  const textModel = provider === 'agnes'
    ? env.AGNES_TEXT_MODEL || env.AGNES_MODEL || 'agnes-3.0-flash'
    : env.KIMI_TEXT_MODEL || 'kimi-k2.6';
  const visionModel = provider === 'agnes'
    ? env.AGNES_VISION_MODEL || env.AGNES_MODEL || textModel
    : env.KIMI_VISION_MODEL || 'kimi-k2.6';
  const thinking = env.KIMI_THINKING === 'enabled' ? 'enabled' : 'disabled';
  const cacheTtlMs = integer(env, 'CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS, 0, 86_400_000);
  const cacheCapacity = integer(env, 'CACHE_CAPACITY', DEFAULT_CACHE_CAPACITY, 0, 10_000);
  const localHttp = env.LOCAL_HTTP === 'true';
  if (localHttp && env.NODE_ENV === 'production') throw new Error('LOCAL_HTTP is only allowed outside production');

  return {
    provider,
    apiKey,
    apiUrl,
    textModel,
    visionModel,
    timeoutMs: integer(env, 'REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, MAX_REQUEST_TIMEOUT_MS),
    maxTokens: integer(env, `${prefix}_MAX_TOKENS`, 10_000, 1024, 32_768),
    thinking,
    temperature: provider === 'agnes'
      ? temperature(env, 'AGNES_TEMPERATURE', 0)
      : temperature(env, 'KIMI_TEMPERATURE', thinking === 'enabled' ? 1 : 0.6),
    jsonMode: env[`${prefix}_JSON_MODE`] === 'object' ? 'object' : 'schema',
    cacheTtlMs,
    cacheCapacity,
    analysisRateLimitWindowMs: integer(env, 'ANALYSIS_RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 86_400_000),
    analysisRateLimitMaxRequests: integer(env, 'ANALYSIS_RATE_LIMIT_MAX_REQUESTS', 60, 1, 100_000),
    analysisConcurrencyPerIp: integer(env, 'ANALYSIS_CONCURRENCY_PER_IP', 4, 1, 128),
    analysisConcurrencyGlobal: integer(env, 'ANALYSIS_CONCURRENCY_GLOBAL', 16, 1, 1024),
    analysisBodyConcurrencyPerIp: integer(env, 'ANALYSIS_BODY_CONCURRENCY_PER_IP', 2, 1, 128),
    analysisBodyConcurrencyGlobal: integer(env, 'ANALYSIS_BODY_CONCURRENCY_GLOBAL', 8, 1, 1024),
    analysisBodyConcurrencyThresholdBytes: integer(env, 'ANALYSIS_BODY_CONCURRENCY_THRESHOLD_BYTES', 262_144, 1, 50_000_000),
    localHttp,
    corsAllowedOrigins: corsOrigins(env),
  };
}
