import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadProviderConfig, resolveServerHost } from '../gemini/lib/config.js';
import { CLIENT_ANALYSIS_TIMEOUT_MS, MAX_REQUEST_TIMEOUT_MS, MAX_UPLOAD_REQUEST_TIMEOUT_MS } from '../gemini/lib/request-timeouts.js';

test('browser analysis timeout leaves room for the maximum backend request timeout', () => {
  assert.ok(CLIENT_ANALYSIS_TIMEOUT_MS > MAX_UPLOAD_REQUEST_TIMEOUT_MS + MAX_REQUEST_TIMEOUT_MS);
});

test('production nginx body and proxy timeouts cover the separate upload and assessment windows', () => {
  const nginx = readFileSync(new URL('../deploy/nginx/assessment-api.conf', import.meta.url), 'utf8');
  const proxyReadMs = Number(nginx.match(/proxy_read_timeout\s+(\d+)s/)?.[1]) * 1000;
  const proxySendMs = Number(nginx.match(/proxy_send_timeout\s+(\d+)s/)?.[1]) * 1000;

  assert.match(nginx, /client_max_body_size\s+50m\s*;/);
  assert.ok(proxyReadMs > MAX_REQUEST_TIMEOUT_MS);
  assert.ok(proxySendMs > MAX_UPLOAD_REQUEST_TIMEOUT_MS);
  assert.doesNotMatch(nginx, /client_body_timeout\s+\d+s\s*;/);
});

test('Agnes China config selects an available Agnes model without Kimi fallback', () => {
  const config = loadProviderConfig({
    ASSESSMENT_PROVIDER: 'agnes',
    AGNES_API_KEY: 'agnes-test-key',
    AGNES_TEXT_MODEL: 'agnes-3.0-flash',
    AGNES_VISION_MODEL: 'agnes-3.0-flash',
    LOCAL_HTTP: 'true',
    CACHE_TTL_MS: '0',
    CACHE_CAPACITY: '0',
  });

  assert.equal(config.provider, 'agnes');
  assert.equal(config.apiUrl, 'https://api.agnes-ai.cn/v1/chat/completions');
  assert.equal(config.apiKey, 'agnes-test-key');
  assert.equal(config.textModel, 'agnes-3.0-flash');
  assert.equal(config.visionModel, 'agnes-3.0-flash');
  assert.equal(config.localHttp, true);
  assert.equal(config.cacheTtlMs, 0);
  assert.equal(config.cacheCapacity, 0);
  assert.equal(config.analysisRateLimitWindowMs, 60_000);
  assert.equal(config.analysisRateLimitMaxRequests, 60);
  assert.equal(config.analysisConcurrencyPerIp, 4);
  assert.equal(config.analysisConcurrencyGlobal, 16);
  assert.equal(config.analysisBodyConcurrencyPerIp, 2);
  assert.equal(config.analysisBodyConcurrencyGlobal, 8);
  assert.equal(config.analysisBodyConcurrencyThresholdBytes, 262_144);
  assert.equal(config.temperature, 0);
});

test('analysis rate limit settings are configurable and reject unsafe values', () => {
  const config = loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'agnes-test-key',
    ANALYSIS_RATE_LIMIT_WINDOW_MS: '120000', ANALYSIS_RATE_LIMIT_MAX_REQUESTS: '90' });
  assert.equal(config.analysisRateLimitWindowMs, 120_000);
  assert.equal(config.analysisRateLimitMaxRequests, 90);
  assert.throws(() => loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'agnes-test-key', ANALYSIS_RATE_LIMIT_MAX_REQUESTS: '0' }), /Invalid ANALYSIS_RATE_LIMIT_MAX_REQUESTS/);
});

test('Agnes provider selection fails closed when its own key is absent', () => {
  assert.throws(() => loadProviderConfig({
    ASSESSMENT_PROVIDER: 'agnes', KIMI_API_KEY: 'must-not-fallback',
  }), /AGNES_API_KEY is required/);
});

test('Agnes API credentials are never sent over an unencrypted endpoint', () => {
  assert.throws(() => loadProviderConfig({
    ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'agnes-test-key', AGNES_BASE_URL: 'http://api.agnes-ai.cn/v1',
  }), /HTTPS/);
});

test('Kimi remains available only when selected explicitly', () => {
  const config = loadProviderConfig({
    ASSESSMENT_PROVIDER: 'kimi',
    KIMI_API_KEY: 'kimi-test-key',
  });
  assert.equal(config.provider, 'kimi');
  assert.equal(config.apiUrl, 'https://api.moonshot.cn/v1/chat/completions');
  assert.equal(config.apiKey, 'kimi-test-key');
});

test('production systemd units run without root and keep application files read-only', () => {
  const units = [
    readFileSync(new URL('../deploy/systemd/gemini.service', import.meta.url), 'utf8'),
    readFileSync(new URL('../deploy/systemd/assessment-health.service', import.meta.url), 'utf8'),
  ];
  for (const unit of units) {
    assert.match(unit, /^User=assessment$/mu);
    assert.match(unit, /^Group=assessment$/mu);
    assert.match(unit, /^NoNewPrivileges=true$/mu);
    assert.match(unit, /^PrivateTmp=true$/mu);
    assert.match(unit, /^ProtectSystem=strict$/mu);
    assert.match(unit, /^ProtectHome=true$/mu);
    assert.doesNotMatch(unit, /^User=root$/mu);
  }
});

test('assessment backend defaults to loopback and rejects direct external binds', () => {
  assert.equal(resolveServerHost({ NODE_ENV: 'production' }), '127.0.0.1');
  assert.equal(resolveServerHost({ HOST: '::1', NODE_ENV: 'production' }), '::1');
  assert.equal(resolveServerHost({ HOST: 'localhost', LOCAL_HTTP: 'true' }), 'localhost');
  for (const HOST of ['0.0.0.0', '::', '192.0.2.10']) {
    assert.throws(() => resolveServerHost({ HOST, NODE_ENV: 'production' }), /loopback/u);
  }
});
