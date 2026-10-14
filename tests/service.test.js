import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../gemini/lib/app.js';
import { createProvider, ServiceError } from '../gemini/lib/provider.js';
import { providerResultSchema } from '../gemini/lib/contracts.js';
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
const provider = { complete: async () => providerFixture(), readiness: async () => ({ status: 'ready', configuredModelsAvailable: true }) };
const post = (url, input, signal) => fetch(url + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });

test('analysis returns validated result and legacy envelope; live and ready are separate', async () => {
  await withApp({ provider }, async url => {
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

test('truncated upstream output is rejected even if a partial JSON value happens to parse', async () => {
  const mocked = createProvider(config, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(providerFixture()) } }] }));
  await assert.rejects(mocked.complete({ model: 'test-text', schema: providerResultSchema, name: 'result', messages: [] }), error => error.code === 'OUTPUT_TRUNCATED');
});
