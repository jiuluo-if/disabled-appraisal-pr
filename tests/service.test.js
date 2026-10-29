import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { createAnalysisCache, createApp } from '../gemini/lib/app.js';
import { createProvider, ServiceError } from '../gemini/lib/provider.js';
import { factExtractionSchema, providerResultSchema } from '../gemini/lib/contracts.js';
import { inputs, providerFixture } from './fixtures.js';

const config = { apiKey: 'test-key', apiUrl: 'https://example.test/v1/chat/completions',
  textModel: 'test-text', visionModel: 'test-vision', timeoutMs: 200,
  maxTokens: 10000, thinking: 'disabled', jsonMode: 'schema' };

async function withApp(options, run, overrides = {}) {
  const server = createApp({ ...config, ...overrides }, options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await run(url); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const provider = { complete: async request => request.name === 'fact_extraction'
  ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false }
  : providerFixture(), readiness: async () => ({ status: 'ready', configuredModelsAvailable: true }) };
const post = (url, input, signal, scope = '00000000-0000-4000-8000-000000000001') => fetch(url + '/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(scope ? { 'X-Analysis-Cache-Scope': scope } : {}) },
  body: JSON.stringify(input), signal,
});

test('analysis returns validated result and legacy envelope; live and ready are separate', async () => {
  const evidence = 'CT报告明确记载左侧第3、4肋骨骨折，共2处骨折，均为本次外伤导致，无既往损伤。';
  const source = 'CT报告明确记载左侧第3、4肋骨骨折';
  const assessmentProvider = { ...provider, complete: async request => request.name === 'fact_extraction'
    ? { facts: [
      { id: 'F1', field: 'injury_type', value: 'rib_fracture', certainty: 'reported', source: 'description', evidence: source, eventId: 'E1' },
      { id: 'F2', field: 'fracture_site_count', value: 2, certainty: 'reported', source: 'description', evidence: '共2处骨折', eventId: 'E1' },
    ], missingMaterials: [], conflicts: [], requiresReview: false }
    : providerFixture() };
  assert.equal(inputs.injury.description, evidence);
  await withApp({ provider: assessmentProvider }, async url => {
    const root = await fetch(url + '/');
    assert.equal(await root.text(), 'Assessment API is Running!');
    const response = await post(url, inputs.injury); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.result.grade, '轻伤二级');
    assert.equal(JSON.parse(body.candidates[0].content.parts[0].text).grade, '轻伤二级');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('x-request-id'));
    assert.equal((await fetch(url + '/api/health/live')).status, 200);
    assert.equal((await fetch(url + '/api/health/ready')).status, 200);
    assert.equal((await fetch(url + '/api/standards/disability')).status, 200);
  });
});

test('invalid model conflict fact IDs do not turn an analysis request into HTTP 500', async () => {
  const description = '耳鸣，眩晕。';
  const malformedConflictProvider = { ...provider, complete: async request => request.name === 'fact_extraction'
    ? { facts: [
      { id: 'F1', field: 'symptom', value: '耳鸣', certainty: 'reported', source: 'description', evidence: '耳鸣' },
      { id: 'F2', field: 'symptom', value: '眩晕', certainty: 'reported', source: 'description', evidence: '眩晕' },
    ], missingMaterials: [], conflicts: [{ factIds: ['F1', 'MISSING'], reason: '模型冲突引用错误' }], requiresReview: true }
    : providerFixture() };

  await withApp({ provider: malformedConflictProvider }, async url => {
    for (const input of [inputs.injury, inputs.disability]) {
      const response = await post(url, { ...input, description });
      assert.equal(response.status, 200);
      const result = (await response.json()).result;
      assert.equal(result.requiresReview, false);
      assert.ok(result.warnings.some(warning => warning.includes('冲突声明引用无效')));
    }
  });
});

test('analysis rate limit returns retry metadata before parsing or calling the provider', async () => {
  let providerCalls = 0;
  let now = 1_000;
  const limitedProvider = { ...provider, complete: async request => {
    providerCalls += 1;
    return request.name === 'fact_extraction' ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false } : providerFixture();
  } };
  await withApp({ provider: limitedProvider, analysisRateLimit: { windowMs: 60_000, maxRequests: 1, now: () => now } }, async url => {
    const first = await post(url, inputs.injury);
    assert.equal(first.status, 200);
    const callsAfterFirst = providerCalls;
    const blocked = await fetch(url + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
    assert.equal(blocked.headers.get('retry-after'), '60');
    assert.equal(blocked.headers.get('ratelimit-limit'), '1');
    assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
    assert.equal(providerCalls, callsAfterFirst);
    now += 60_000;
    assert.equal((await post(url, inputs.injury)).status, 200);
  });
});

test('analysis rate limit uses the client IP forwarded by the trusted local proxy', async () => {
  await withApp({ provider, analysisRateLimit: { windowMs: 60_000, maxRequests: 1 } }, async url => {
    const requestFrom = ip => fetch(url + '/api/analyze', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Forwarded-For': ip,
    }, body: JSON.stringify(inputs.injury) });
    const first = await requestFrom('198.51.100.11');
    const second = await requestFrom('198.51.100.12');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
  });
});

test('analysis concurrency limit prevents a single client from opening an upstream request burst', async () => {
  let enterExtraction;
  let releaseExtraction;
  const extractionEntered = new Promise(resolve => { enterExtraction = resolve; });
  const extractionGate = new Promise(resolve => { releaseExtraction = resolve; });
  const slowProvider = { ...provider, complete: async request => {
    if (request.name === 'fact_extraction') {
      enterExtraction();
      await extractionGate;
      return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
    }
    return providerFixture();
  } };
  await withApp({ provider: slowProvider, analysisConcurrencyLimit: { maxConcurrent: 1 } }, async url => {
    const firstRequest = post(url, inputs.injury);
    await extractionEntered;
    const blockedOutcome = await Promise.race([
      post(url, inputs.disability).then(response => ({ response })),
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 100)),
    ]);
    releaseExtraction();
    assert.equal((await firstRequest).status, 200);
    assert.ok(blockedOutcome.response);
    assert.equal(blockedOutcome.response.status, 429);
    assert.equal((await blockedOutcome.response.json()).error.code, 'ANALYSIS_CONCURRENCY_LIMIT');
    assert.equal(blockedOutcome.response.headers.get('retry-after'), '1');
    assert.equal((await post(url, inputs.disability)).status, 200);
  });
});

test('analysis concurrency limit also caps simultaneous upstream work across distinct client IPs', async () => {
  let enterExtraction;
  let releaseExtraction;
  const extractionEntered = new Promise(resolve => { enterExtraction = resolve; });
  const extractionGate = new Promise(resolve => { releaseExtraction = resolve; });
  const slowProvider = { ...provider, complete: async request => {
    if (request.name === 'fact_extraction') {
      enterExtraction();
      await extractionGate;
      return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
    }
    return providerFixture();
  } };
  await withApp({ provider: slowProvider, analysisConcurrencyLimit: { maxConcurrent: 2, maxGlobalConcurrent: 1 } }, async url => {
    const requestFrom = (ip, input) => fetch(url + '/api/analyze', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Forwarded-For': ip,
    }, body: JSON.stringify(input) });
    const firstRequest = requestFrom('198.51.100.21', inputs.injury);
    await extractionEntered;
    const blocked = await requestFrom('198.51.100.22', inputs.disability);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'ANALYSIS_CONCURRENCY_LIMIT');
    releaseExtraction();
    assert.equal((await firstRequest).status, 200);
  });
});

test('large request bodies are concurrency-limited before JSON parsing', async () => {
  let enterExtraction;
  let releaseExtraction;
  const extractionEntered = new Promise(resolve => { enterExtraction = resolve; });
  const extractionGate = new Promise(resolve => { releaseExtraction = resolve; });
  const slowProvider = { ...provider, complete: async request => {
    if (request.name === 'fact_extraction') {
      enterExtraction();
      await extractionGate;
      return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
    }
    return providerFixture();
  } };
  await withApp({ provider: slowProvider, analysisBodyConcurrencyLimit: {
    maxConcurrentPerIp: 1, maxConcurrentGlobal: 2, minContentLengthBytes: 262_144,
  } }, async url => {
    const largeInput = { ...inputs.injury, extra: 'x'.repeat(300_000) };
    const firstRequest = post(url, largeInput);
    await extractionEntered;
    const malformedLargeBody = await fetch(url + '/api/analyze', { method: 'POST', headers: {
      'Content-Type': 'application/json',
    }, body: `{${' '.repeat(300_000)}` });
    assert.equal(malformedLargeBody.status, 429);
    assert.equal((await malformedLargeBody.json()).error.code, 'ANALYSIS_BODY_CONCURRENCY_LIMIT');
    releaseExtraction();
    assert.equal((await firstRequest).status, 200);
  });
});

test('compressed JSON requests are rejected before decompression can bypass body concurrency limits', async () => {
  let providerCalls = 0;
  const trackingProvider = { ...provider, complete: async request => {
    providerCalls += 1;
    return request.name === 'fact_extraction'
      ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false } : providerFixture();
  } };
  await withApp({ provider: trackingProvider }, async url => {
    const response = await fetch(url + '/api/analyze', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
    }, body: gzipSync(JSON.stringify(inputs.injury)) });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_ENCODING');
    assert.equal(providerCalls, 0);
  });
});

test('valid legacy contents requests remain compatible and preserve the uploaded MIME type', async () => {
  const png = Buffer.alloc(45);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(png);
  png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20); png.write('IEND', 37, 'ascii'); png[44] = 0x82;
  const calls = [];
  const provider = { readiness: async () => ({ status: 'ready', configuredModelsAvailable: true }), async complete(request) {
    calls.push(request.name);
    if (request.name === 'medical_report_transcription') return { pages: [{ imageIndex: 1, text: '成年人脾部分切除术后', issues: [] }] };
    if (request.name === 'fact_extraction') return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
    return { ...providerFixture('disability'), facts: [] };
  } };
  await withApp({ provider }, async url => {
    const response = await fetch(url + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [
        { text: '请依据《人体损伤致残程度分级》分析。成年人脾部分切除术后。' },
        { inline_data: { mime_type: 'image/png', data: png.toString('base64') } },
      ] }] }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.result.assessmentType, 'disability');
    assert.deepEqual(calls, ['medical_report_transcription', 'fact_extraction']);
  });
});

test('invalid body, MIME mismatch and malformed JSON return structured errors', async () => {
  await withApp({ provider }, async url => {
    assert.equal((await post(url, { contents: [{ parts: {} }] })).status, 400);
    const image = await post(url, { ...inputs.injury, images: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=' }] });
    assert.equal(image.status, 400); assert.equal((await image.json()).error.code, 'INVALID_IMAGE');
    const malformed = await fetch(url + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
    const encoding = await fetch(url + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'not-supported' }, body: JSON.stringify(inputs.injury) });
    assert.equal(encoding.status, 415); assert.equal((await encoding.json()).error.code, 'UNSUPPORTED_ENCODING');
  });
});

test('truncated but correctly signed image bytes are rejected before model calls', async () => {
  let calls = 0;
  const provider = { ...providerFixture, complete: async request => {
    calls += 1;
    return request.name === 'fact_extraction'
      ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false }
      : providerFixture();
  } };
  await withApp({ provider }, async url => {
    const truncated = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const response = await post(url, { ...inputs.injury, images: [{ name: 'truncated.png', mimeType: 'image/png', data: truncated }] });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_IMAGE');
    assert.equal(calls, 0);
  });
});

test('provider failure produces an error without fabricated candidates or a saved result', async () => {
  await withApp({ provider: { ...provider, complete: async () => { throw new ServiceError(503, 'MODEL_UNAVAILABLE', '模型不可用'); } } }, async url => {
    const response = await post(url, inputs.injury); assert.equal(response.status, 503);
    const body = await response.json(); assert.equal(body.error.code, 'MODEL_UNAVAILABLE');
    assert.equal(body.result, undefined); assert.equal(body.candidates, undefined);
  });
});

test('deadline aborts the provider and returns no assessment conclusion', async () => {
  const pending = { ...provider, complete: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) };
  await withApp({ provider: pending }, async url => {
    const response = await post(url, inputs.injury);
    assert.equal(response.status, 504); assert.equal((await response.json()).error.code, 'ANALYSIS_TIMEOUT');
  }, { timeoutMs: 30 });
});

test('client cancellation reaches the provider instead of letting the analysis continue', async () => {
  let interrupted;
  const aborted = new Promise(resolve => { interrupted = resolve; });
  const pending = { ...provider, complete: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { interrupted(true); reject(signal.reason); }, { once: true })) };
  await withApp({ provider: pending }, async url => {
    const controller = new AbortController();
    const request = post(url, inputs.injury, controller.signal).catch(() => null);
    setTimeout(() => controller.abort(), 40);
    assert.equal(await Promise.race([aborted, new Promise(resolve => setTimeout(() => resolve(false), 500))]), true);
    await request;
  }, { timeoutMs: 1000 });
});

test('readiness checks configured model access, not just a running process', async () => {
  await withApp({ provider: { ...provider, readiness: async () => ({ status: 'unavailable', configuredModelsAvailable: false }) } }, async url => {
    assert.equal((await fetch(url + '/api/health/live')).status, 200);
    assert.equal((await fetch(url + '/api/health/ready')).status, 503);
  });
});

test('JSON repair is bounded and invalid results never become an apparent success', async () => {
  let count = 0;
  const mocked = createProvider(config, async () => {
    count++;
    return Response.json({ choices: [{ message: { content: '{invalid' }, finish_reason: 'stop' }] });
  });
  await assert.rejects(mocked.complete({ model: 'test-text', schema: providerResultSchema, name: 'result', messages: [], signal: new AbortController().signal }), error => error.code === 'INVALID_RESULT');
  assert.equal(count, 2);
});

test('provider adapts both observed Kimi conflict-object shapes into the strict fact schema', async () => {
  const shapes = [
    { between: ['F1', 'F2'], description: '疑似骨折与复查未见骨折' },
    { fact_ids: ['F1', 'F2'], description: '疑似骨折与复查未见骨折' },
  ];
  for (const conflict of shapes) {
    const content = JSON.stringify({
      facts: [
        { id: 'F1', field: 'rib_fracture', value: 'suspected', certainty: 'uncertain', source_type: 'medical_record', source_excerpt: '疑似第六肋骨骨折' },
        { id: 'F2', field: 'rib_fracture', value: 'excluded', certainty: 'excluded', source_type: 'medical_record', source_excerpt: '复查报告未见骨折' },
      ], missing_information: [], conflicts: [conflict], requires_review: true,
    });
    let payload;
    const mocked = createProvider({ ...config, temperature: 0.6 }, async (_url, init) => {
      payload = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    });
    const result = await mocked.complete({ model: 'kimi-k2.6', schema: factExtractionSchema,
      name: 'fact_extraction', messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'synthetic input' }] });
    assert.deepEqual(result.conflicts, [{ factIds: ['F1', 'F2'], reason: conflict.description }]);
    assert.equal(result.facts[0].source, 'description');
    assert.equal(payload.response_format.type, 'json_schema');
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal(payload.temperature, 0.6);
  }
});

test('Agnes text requests send the configured low-variance sampling temperature', async () => {
  let payload;
  const mocked = createProvider({ ...config, temperature: 0 }, async (_url, init) => {
    payload = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(providerFixture()) }, finish_reason: 'stop' }] });
  });
  await mocked.complete({ model: 'agnes-3.0-flash', schema: providerResultSchema, name: 'assessment_result',
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'synthetic input' }] });

  assert.equal(payload.model, 'agnes-3.0-flash');
  assert.equal(payload.temperature, 0);
});

test('provider metrics report per-request latency and upstream token usage without prompt content', async () => {
  const metrics = [];
  const mocked = createProvider(config, async () => Response.json({
    choices: [{ message: { content: JSON.stringify(providerFixture()) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
  }));
  await mocked.complete({ model: 'test-text', schema: providerResultSchema, name: 'assessment_result',
    messages: [{ role: 'system', content: 'sensitive prompt must not appear in metrics' }],
    onMetrics: event => metrics.push(event) });

  assert.equal(metrics.length, 2);
  assert.deepEqual(metrics[0], { type: 'request_start', model: 'test-text' });
  assert.equal(metrics[1].type, 'request_end');
  assert.equal(metrics[1].failed, false);
  assert.equal(metrics[1].inputTokens, 120);
  assert.equal(metrics[1].outputTokens, 45);
  assert.ok(metrics[1].durationMs >= 0);
  assert.equal(JSON.stringify(metrics).includes('sensitive prompt'), false);
});

test('upstream status errors never expose provider response bodies', async () => {
  const cases = [[401, 'PROVIDER_CONFIGURATION'], [403, 'PROVIDER_CONFIGURATION'], [404, 'MODEL_UNAVAILABLE'], [429, 'UPSTREAM_RATE_LIMIT'], [503, 'UPSTREAM_FAILURE']];
  for (const [status, code] of cases) {
    const mocked = createProvider(config, async () => Response.json({ error: { message: 'upstream secret payload' } }, { status }));
    await assert.rejects(mocked.complete({ model: 'kimi-k2.6', schema: providerResultSchema, name: 'assessment_result', messages: [] }), error => {
      assert.equal(error.code, code); assert.equal(error.message.includes('secret'), false); return true;
    });
  }
});

test('provider retries one 429 after the upstream one-second Retry-After and returns the result', async () => {
  let calls = 0;
  const waits = [];
  const completion = { status: 'preliminary', grade: null, summary: 's', reasoning: 'r', facts: [],
    references: [], missingMaterials: [], nextSteps: [], warnings: [] };
  const mocked = createProvider(config, async () => {
    calls += 1;
    if (calls === 1) return new Response('throttled', { status: 429, headers: { 'Retry-After': '1' } });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(completion) } }] });
  }, async milliseconds => { waits.push(milliseconds); });

  const result = await mocked.complete({ model: 'kimi-k2.6', schema: providerResultSchema,
    name: 'assessment_result', messages: [] });

  assert.equal(result.grade, null);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
});

test('provider does not retry 429 without a short Retry-After or retry 5xx', async () => {
  for (const [status, headers, code] of [
    [429, {}, 'UPSTREAM_RATE_LIMIT'],
    [429, { 'Retry-After': '3' }, 'UPSTREAM_RATE_LIMIT'],
    [503, { 'Retry-After': '1' }, 'UPSTREAM_FAILURE'],
  ]) {
    let calls = 0;
    const mocked = createProvider(config, async () => {
      calls += 1;
      return new Response('upstream secret payload', { status, headers });
    }, async () => assert.fail('unexpected retry delay'));

    await assert.rejects(mocked.complete({ model: 'kimi-k2.6', schema: providerResultSchema,
      name: 'assessment_result', messages: [] }), error => {
      assert.equal(error.code, code);
      assert.equal(error.upstreamStatus, status);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('provider retries a short 429 at most once and preserves the final upstream status', async () => {
  let calls = 0;
  const mocked = createProvider(config, async () => {
    calls += 1;
    return new Response('upstream secret payload', { status: 429, headers: { 'Retry-After': '0' } });
  }, async () => {});

  await assert.rejects(mocked.complete({ model: 'kimi-k2.6', schema: providerResultSchema,
    name: 'assessment_result', messages: [] }), error => {
    assert.equal(error.code, 'UPSTREAM_RATE_LIMIT');
    assert.equal(error.upstreamStatus, 429);
    assert.equal(error.retryAfterSeconds, 0);
    return true;
  });
  assert.equal(calls, 2);
});

test('ordinary identical requests reuse validated results; forceReanalysis bypasses the cache', async () => {
  const calls = [];
  const provider = { async complete(request) {
    calls.push(request.name);
    return request.name === 'fact_extraction'
      ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false }
      : { ...providerFixture('injury'), facts: [] };
  } };
  await withApp({ provider }, async url => {
    const first = await post(url, inputs.injury); assert.equal(first.status, 200);
    const firstBody = await first.json();
    const repeated = await post(url, inputs.injury); assert.equal(repeated.status, 200);
    const repeatedBody = await repeated.json();
    assert.deepEqual(calls, ['fact_extraction']);
    assert.equal(firstBody.result.grade, repeatedBody.result.grade);
    assert.equal(firstBody.result.status, repeatedBody.result.status);
    assert.notEqual(firstBody.result.requestId, repeatedBody.result.requestId);
    const forced = await post(url, { ...inputs.injury, forceReanalysis: true }); assert.equal(forced.status, 200);
    assert.deepEqual(calls, ['fact_extraction', 'fact_extraction']);
  });
});

test('analysis cache isolates every normalized assessment input and ignores only forceReanalysis', async () => {
  const cache = createAnalysisCache({ ttlMs: 1000, capacity: 20 });
  const base = {
    assessmentType: 'injury', description: 'same clinical facts', images: [],
    injuryDate: '2020-01-01', treatmentStatus: 'unknown', forceReanalysis: false,
  };
  const variants = [
    { ...base, assessmentType: 'disability' },
    { ...base, description: 'different clinical facts' },
    { ...base, images: [{ mimeType: 'image/png', data: 'YQ==', name: 'page.png' }] },
    { ...base, injuryDate: '2020-01-02' },
    { ...base, treatmentStatus: 'stable' },
  ];
  let calls = 0;
  const produce = async () => ({ value: ++calls });

  const first = await cache.run(base, 'first', produce, { scope: 'test-session-a' });
  for (const [index, variant] of variants.entries()) {
    const result = await cache.run(variant, `variant-${index}`, produce, { scope: 'test-session-a' });
    assert.notEqual(result.value, first.value);
  }
  assert.equal(calls, 1 + variants.length);

  const forced = await cache.run({ ...base, forceReanalysis: true }, 'forced', produce, { scope: 'test-session-a' });
  assert.equal(calls, 2 + variants.length);
  assert.equal(forced.value, calls);
  assert.equal((await cache.run(base, 'after-forced', produce, { scope: 'test-session-a' })).value, forced.value);
  assert.equal(calls, 2 + variants.length);
});

test('analysis cache is session-scoped and invalidates when analysis versions change', async () => {
  const input = { assessmentType: 'injury', description: 'same verified input', images: [],
    injuryDate: '', treatmentStatus: 'unknown' };
  let calls = 0;
  const produce = async () => ({ value: ++calls });
  const firstVersion = createAnalysisCache({ ttlMs: 1000, capacity: 10, versions: { rules: 'rules-v1' } });
  const first = await firstVersion.run(input, 'a1', produce, { scope: 'session-a' });
  const isolated = await firstVersion.run(input, 'b1', produce, { scope: 'session-b' });
  const reused = await firstVersion.run(input, 'a2', produce, { scope: 'session-a' });
  assert.deepEqual([first.value, isolated.value, reused.value], [1, 2, 1]);

  const upgradedVersion = createAnalysisCache({ ttlMs: 1000, capacity: 10, versions: { rules: 'rules-v2' } });
  const upgraded = await upgradedVersion.run(input, 'a3', produce, { scope: 'session-a' });
  assert.equal(upgraded.value, 3);

  const restartedService = createAnalysisCache({ ttlMs: 1000, capacity: 10, versions: { rules: 'rules-v1' } });
  assert.equal((await restartedService.run(input, 'a4', produce, { scope: 'session-a' })).value, 4);

  const anonymous = await firstVersion.run(input, 'anonymous', produce);
  assert.equal(anonymous.value, 5);
  assert.equal((await firstVersion.run(input, 'anonymous-again', produce)).value, 6);
  assert.equal(calls, 6);
});

test('zero cache configuration causes every repeated analysis to call the provider again', async () => {
  const calls = [];
  const provider = { async complete(request) {
    calls.push(request.name);
    return request.name === 'fact_extraction'
      ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false }
      : { ...providerFixture('injury'), facts: [] };
  } };
  await withApp({ provider }, async url => {
    assert.equal((await post(url, inputs.injury)).status, 200);
    assert.equal((await post(url, inputs.injury)).status, 200);
    assert.deepEqual(calls, ['fact_extraction', 'fact_extraction']);
    const stats = await (await fetch(url + '/api/cache/stats')).json();
    assert.equal(stats.entries, 0);
    assert.equal(stats.inFlight, 0);
  }, { cacheTtlMs: 0, cacheCapacity: 0 });
});

test('twenty concurrent identical requests share one fact and assessment run', async () => {
  const calls = [];
  const provider = { async complete(request) {
    calls.push(request.name);
    await new Promise(resolve => setTimeout(resolve, 10));
    return request.name === 'fact_extraction'
      ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false }
      : { ...providerFixture('injury'), facts: [] };
  } };
  await withApp({ provider }, async url => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(url, inputs.injury)));
    assert.ok(responses.every(response => response.status === 200));
    const results = await Promise.all(responses.map(response => response.json()));
    assert.deepEqual(calls, ['fact_extraction']);
    assert.equal(new Set(results.map(item => item.result.grade)).size, 1);
    assert.equal(new Set(results.map(item => item.result.requestId)).size, 20);
  });
});

test('analysis results are not shared between browser sessions or anonymous API callers', async () => {
  let calls = 0;
  const provider = { async complete(request) {
    calls += 1;
    return request.name === 'fact_extraction'
      ? { facts: [], missingMaterials: [], conflicts: [], requiresReview: false }
      : { ...providerFixture('injury'), facts: [] };
  } };
  await withApp({ provider }, async url => {
    assert.equal((await post(url, inputs.injury, undefined, '00000000-0000-4000-8000-000000000001')).status, 200);
    assert.equal((await post(url, inputs.injury, undefined, '00000000-0000-4000-8000-000000000002')).status, 200);
    assert.equal((await post(url, inputs.injury, undefined, null)).status, 200);
    assert.equal((await post(url, inputs.injury, undefined, null)).status, 200);
    assert.equal(calls, 4);
  });
});

test('cancelling one identical-request waiter leaves the shared analysis for other waiters', async () => {
  const cache = createAnalysisCache({ ttlMs: 1000, capacity: 2 });
  const firstRequest = new AbortController();
  const secondRequest = new AbortController();
  let producerSignal;
  let finishProducer;
  let started;
  const producerStarted = new Promise(resolve => { started = resolve; });
  const producer = sharedSignal => new Promise((resolve, reject) => {
    producerSignal = sharedSignal || firstRequest.signal;
    finishProducer = () => resolve({ value: 'complete' });
    producerSignal.addEventListener('abort', () => reject(producerSignal.reason), { once: true });
    started();
  });
  const first = cache.run({ description: 'same input' }, 'first', producer,
    { signal: firstRequest.signal, scope: 'test-session-a' });
  await producerStarted;
  const second = cache.run({ description: 'same input' }, 'second', producer,
    { signal: secondRequest.signal, scope: 'test-session-a' });
  const secondOutcome = second.then(value => ({ value }), error => ({ error }));

  firstRequest.abort(new Error('first client cancelled'));
  await assert.rejects(first, /first client cancelled/);
  finishProducer();
  const settledSecond = await secondOutcome;
  assert.equal(producerSignal.aborted, false);
  assert.equal(settledSecond.error, undefined);
  assert.deepEqual(settledSecond.value, { value: 'complete', requestId: 'second' });
});

test('a request cancelled as its provider completes does not leave an unconsumed result cached', async () => {
  const cache = createAnalysisCache({ ttlMs: 1000, capacity: 2 });
  const request = new AbortController();
  let finishProducer;
  let started;
  const producerStarted = new Promise(resolve => { started = resolve; });
  const providerResult = new Promise(resolve => { finishProducer = resolve; });
  const pending = cache.run({ description: 'completion cancellation race' }, 'race', async () => {
    started();
    return providerResult;
  }, { signal: request.signal, scope: 'test-session-a' });

  await producerStarted;
  finishProducer({ value: 'unconsumed' });
  request.abort(new Error('client cancelled at completion'));
  await assert.rejects(pending, /client cancelled at completion/);
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().inFlight, 0);
});

test('an already cancelled request does not start a new cached analysis', async () => {
  const cache = createAnalysisCache({ ttlMs: 1000, capacity: 2 });
  const request = new AbortController();
  request.abort(new Error('client already cancelled'));
  let calls = 0;

  await assert.rejects(cache.run({ description: 'same input' }, 'cancelled', async () => {
    calls += 1;
    return { value: 'unexpected' };
  }, { signal: request.signal, scope: 'test-session-a' }), /client already cancelled/);
  assert.equal(calls, 0);
  assert.deepEqual(cache.stats(), { entries: 0, inFlight: 0, hits: 0, misses: 0 });
});

test('analysis cache expires entries and enforces its bounded capacity', async () => {
  let now = 100;
  const cache = createAnalysisCache({ ttlMs: 10, capacity: 1, now: () => now });
  let calls = 0;
  const producer = async () => ({ value: ++calls });
  assert.deepEqual(await cache.run({ description: 'A' }, 'r1', producer, { scope: 'test-session-a' }), { value: 1, requestId: 'r1' });
  assert.deepEqual(await cache.run({ description: 'A' }, 'r2', producer, { scope: 'test-session-a' }), { value: 1, requestId: 'r2' });
  assert.equal(calls, 1);
  await cache.run({ description: 'B' }, 'r3', producer, { scope: 'test-session-a' });
  assert.equal(cache.stats().entries, 1);
  await cache.run({ description: 'A' }, 'r4', producer, { scope: 'test-session-a' });
  assert.equal(calls, 3);
  now += 11;
  await cache.run({ description: 'A' }, 'r5', producer, { scope: 'test-session-a' });
  assert.equal(calls, 4);
});

test('zero TTL and capacity disable cache storage and in-flight request sharing', async () => {
  const cache = createAnalysisCache({ ttlMs: 0, capacity: 0 });
  let calls = 0;
  const producer = async () => {
    const value = ++calls;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { value };
  };

  const [first, second] = await Promise.all([
    cache.run({ description: 'same input' }, 'first', producer),
    cache.run({ description: 'same input' }, 'second', producer),
  ]);

  assert.equal(calls, 2);
  assert.notEqual(first.value, second.value);
  assert.deepEqual(cache.stats(), { entries: 0, inFlight: 0, hits: 0, misses: 2 });
});

test('truncated upstream output is rejected even if a partial JSON value happens to parse', async () => {
  const mocked = createProvider(config, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(providerFixture()) } }] }));
  await assert.rejects(mocked.complete({ model: 'test-text', schema: providerResultSchema, name: 'result', messages: [] }),
    error => error.code === 'OUTPUT_TRUNCATED' && error.message.includes('本次未形成有效结论'));
});
