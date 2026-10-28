import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../gemini/lib/app.js';
import { loadProviderConfig } from '../gemini/lib/config.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { retrieveClauses } from '../gemini/lib/catalog.js';

const emptyExtraction = { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };

test('generic subarachnoid hemorrhage and head trauma do not imply traumatic hemorrhage', () => {
  const generic = normalizeExtractedFacts(emptyExtraction, {
    description: '头部受伤后CT提示蛛网膜下腔出血，GCS评分12分。',
  });
  assert.equal(generic.facts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '外伤性蛛网膜下腔出血'), false);

  const explicit = normalizeExtractedFacts(emptyExtraction, {
    description: '诊断明确记载外伤性蛛网膜下腔出血。',
  });
  assert.equal(explicit.facts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '外伤性蛛网膜下腔出血'), true);
});

test('temporal lobe softening and secondary epilepsy do not imply traumatic late-onset epilepsy', () => {
  const generic = normalizeExtractedFacts(emptyExtraction, {
    description: '检查见颞叶软化灶，诊断继发性癫痫。',
  });
  assert.equal(generic.facts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '外伤性迟发性癫痫'), false);

  const explicit = normalizeExtractedFacts(emptyExtraction, {
    description: '专家诊断明确：外伤性迟发性癫痫。',
  });
  assert.equal(explicit.facts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '外伤性迟发性癫痫'), true);
});

test('rib ordinal lists do not create fracture-site counts', () => {
  const snapshot = normalizeExtractedFacts(emptyExtraction, {
    description: '左侧第3至第6肋骨骨折。',
  });
  assert.deepEqual(snapshot.facts.find(fact => fact.field === 'fractured_rib_numbers')?.value, [3, 4, 5, 6]);
  assert.equal(snapshot.facts.some(fact => fact.field === 'fracture_site_count'), false);
});

test('structured facts supplement text recall without proving an incomplete condition', () => {
  const candidates = retrieveClauses('injury', '', 0, [
    { field: 'clinical_finding', value: '颅骨凹陷性骨折', evidence: 'CT诊断颅骨凹陷性骨折', certainty: 'reported' },
  ]);
  assert.ok(candidates.some(clause => clause.id === '5.1.2.c'));
  assert.equal(candidates.find(clause => clause.id === '5.1.2.c').conditionLogic.annotation, 'explicit');
});

test('public API CORS is limited to the two assessment sites and cache stats stay local', async () => {
  const config = loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'test-key',
    NODE_ENV: 'production' });
  assert.deepEqual(config.corsAllowedOrigins, ['https://analyst.lintsing.net', 'https://appraise.lintsing.net']);
  assert.throws(() => loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'test-key',
    NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://untrusted.example/path' }), /CORS_ALLOWED_ORIGINS/);
  const provider = { readiness: async () => ({ status: 'ready' }), complete: async () => ({}) };
  const server = createApp(config, { provider }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const allowed = await fetch(`${base}/api/health/live`, { headers: { Origin: 'https://appraise.lintsing.net' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://appraise.lintsing.net');
    const denied = await fetch(`${base}/api/health/live`, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${base}/api/cache/stats`)).status, 200);
    assert.equal((await fetch(`${base}/api/cache/stats`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
