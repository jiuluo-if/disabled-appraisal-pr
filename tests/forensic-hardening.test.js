import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../gemini/lib/app.js';
import { loadProviderConfig } from '../gemini/lib/config.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { catalogs, retrieveClauses } from '../gemini/lib/catalog.js';
import { evaluateConditionLogic, normalizeResult } from '../gemini/lib/results.js';
import { inputs, providerFixture } from './fixtures.js';

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

test('unrelated head evidence cannot be displayed as support for an uncertain rib-count clause', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.3.7');
  const headEvidence = '本次头部软组织损伤';
  const ribEvidence = '右侧肋骨骨折可疑';
  const description = `合成资料，非真实病例。${headEvidence}；${ribEvidence}。`;
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '头部软组织损伤', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: headEvidence },
    { id: 'F2', eventId: 'E1', field: 'injury_type', value: 'rib_fracture', certainty: 'uncertain',
      source: 'description', verification: 'quoted', evidence: ribEvidence },
  ];
  const raw = { ...providerFixture('disability'), status: 'insufficient', grade: null, facts: [], references: [{
    clauseId: clause.id, relation: 'supports', evidence: headEvidence, reasoning: '',
    conditions: [{ condition: clause.text, evidence: headEvidence, factIds: ['F1'], met: true }],
  }] };
  const result = normalizeResult(raw, { ...inputs.disability, description }, {
    clauses: [clause], requestId: 'unrelated-head-evidence-rib-count', model: 'test-model',
    extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  const reference = result.references.find(item => item.id === clause.id);

  assert.notEqual(reference?.relation, 'supports');
  assert.equal(result.grade, null);
  assert.equal(reference?.evidence, '');
  assert.ok(reference?.conditions.every(condition => condition.evidence === '' && condition.factIds.length === 0));
});

test('postoperative sutured chest wounds are not counted as original traumatic wound lengths', () => {
  const description = '合成资料，非真实病例。左胸另有约2.5cm长刀刺创口；受伤后行胸腹探查和心室修补术。术后活体检验另见胸部正中约20.0cm纵行缝合创口。';
  const result = normalizeExtractedFacts(emptyExtraction, { description });
  const lengths = result.facts.filter(fact => fact.field === 'wound_length_cm');

  assert.ok(lengths.some(fact => fact.value === 2.5));
  assert.equal(lengths.some(fact => fact.value === 20), false);
});

test('pulmonary contusion and an unrelated operation do not prove lung rupture requiring surgery', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.6.2.f');
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'diagnosis', value: '左肺挫伤', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '胸部影像诊断左肺挫伤' },
    { id: 'F2', eventId: 'E1', field: 'treatment', value: '手术探查', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '腹部损伤行手术探查' },
  ];
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, facts).met, true);
});

test('same-organ surgery explicitly for another condition cannot satisfy a rupture-treatment clause', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.7.2.c');
  const diagnosis = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '脾破裂', certainty: 'reported',
    source: 'description', verification: 'quoted', evidence: '本次事故后明确诊断脾破裂' };
  const operation = indication => ({ id: 'F2', eventId: 'E1', field: 'clinical_finding', value: '脾切除术',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: indication });

  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    [diagnosis, operation('本次事故后因脾囊肿行脾切除术')]).met, true);
  for (const indication of ['本次事故后因脾破裂行脾切除术', '本次事故后因脾脏破裂行脾切除术']) {
    assert.equal(evaluateConditionLogic(clause.conditionLogic, [diagnosis, operation(indication)]).met, true, indication);
  }
});

test('a model cannot turn thumb opposition and grip measurements into hand-function loss fact evidence', () => {
  const description = '合成资料，非真实病例。检查记载左拇指对掌不能、握力I–II级，腕背屈约20°、掌屈约70°。';
  const clause = catalogs.injury.clauses.find(item => item.id === '5.10.2.a');
  const measuredQuote = '左拇指对掌不能、握力I–II级，腕背屈约20°、掌屈约70°';
  const extracted = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: clause.conditionLogic.logic.conditionText, certainty: 'reported', source: 'description',
    evidence: measuredQuote }], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const raw = { ...providerFixture('injury'), status: 'preliminary', grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, relation: 'supports', evidence: measuredQuote, reasoning: '',
    conditions: [{ condition: clause.text, evidence: measuredQuote, factIds: ['F1'], met: true }],
  }] };
  const result = normalizeResult(raw, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'model-inferred-hand-function-loss', model: 'test-model',
    extractedFacts: extracted.facts.map(fact => ({ ...fact, verification: 'quoted' })),
    conflicts: extracted.conflicts, requiresReview: extracted.requiresReview,
    factMissingMaterials: extracted.missingMaterials,
  });

  assert.equal(extracted.facts.some(fact => fact.value === clause.conditionLogic.logic.conditionText), false);
  assert.equal(result.grade, null);
  assert.notEqual(result.references.find(reference => reference.id === clause.id)?.relation, 'supports');
});

test('every quantitative clause predicate declares its measurement unit or dimensionless ratio', () => {
  const missingUnits = [];
  const mismatchedUnits = [];
  const expectedUnits = {
    gcs_score: '分',
    dental_loss_count: '枚',
    cross_region_wound_ratio: '比例',
    ear_scalp_wound_ratio: '比例',
    auricle_defect_ratio: '比例',
  };
  const visit = (node, clauseId) => {
    if (node.predicate) {
      if (!node.predicate.unit) missingUnits.push(clauseId);
      if (expectedUnits[node.predicate.field]
        && node.predicate.unit !== expectedUnits[node.predicate.field]) mismatchedUnits.push(clauseId);
    }
    for (const child of node.children || []) visit(child, clauseId);
  };
  for (const catalog of Object.values(catalogs)) for (const clause of catalog.clauses) {
    if (clause.conditionLogic.annotation === 'explicit') visit(clause.conditionLogic.logic, clause.id);
  }
  assert.deepEqual(missingUnits, []);
  assert.deepEqual(mismatchedUnits, []);
});

test('public API CORS is limited to the two assessment sites and cache stats stay local', async () => {
  const config = loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'test-key',
    NODE_ENV: 'production' });
  assert.deepEqual(config.corsAllowedOrigins, ['https://analyst.lintsing.net', 'https://appraise.lintsing.net']);
  assert.throws(() => loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'test-key',
    NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://untrusted.example/path' }), /CORS_ALLOWED_ORIGINS/);
  assert.throws(() => loadProviderConfig({ ASSESSMENT_PROVIDER: 'agnes', AGNES_API_KEY: 'test-key',
    NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'http://localhost:5300' }), /CORS_ALLOWED_ORIGINS/);
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
