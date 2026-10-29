import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.f');
const extract = description => normalizeExtractedFacts({ facts: [
  { id: 'F-sah', eventId: 'E1', field: 'clinical_finding', value: '外伤性蛛网膜下腔出血',
    certainty: 'reported', source: 'description', evidence: 'CT诊断外伤性蛛网膜下腔出血' },
  { id: 'F-gcs', eventId: 'E1', field: 'gcs_score', value: 8,
    certainty: 'reported', source: 'description', evidence: description.match(/(?:GCS|格拉斯哥昏迷评分)[^。；;]+/u)?.[0] || '' },
], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

test('GCS measured during anesthesia or sedation stays auditable but cannot independently support neurological signs', () => {
  for (const context of ['全麻后GCS评分8分', '镇静中GCS评分8分', '气管插管后GCS评分8分']) {
    const description = `交通事故导致头部外伤。${context}。CT诊断外伤性蛛网膜下腔出血。`;
    const snapshot = extract(description);
    const gcs = snapshot.facts.find(item => item.field === 'gcs_score');

    assert.equal(gcs?.certainty, 'unknown', context);
    assert.equal(snapshot.factAudit.find(item => item.rawFactId === 'F-gcs')?.gradeEligible, false, context);
    assert.equal(evaluateConditionLogic(clause.conditionLogic, snapshot.facts).met, null, context);
  }
});

test('an unconfounded admission GCS and an explicitly non-sedated GCS remain usable', () => {
  for (const context of ['入院GCS评分8分', '未使用镇静药物，入院GCS评分8分', '术前计划全麻，入院GCS评分8分']) {
    const description = `交通事故导致头部外伤。${context}。CT诊断外伤性蛛网膜下腔出血。`;
    const snapshot = extract(description);
    assert.equal(snapshot.facts.find(item => item.field === 'gcs_score')?.certainty, 'reported', context);
    assert.equal(evaluateConditionLogic(clause.conditionLogic, snapshot.facts).met, true, context);
  }
});

test('repeated equal GCS scores keep their distinct sentence evidence and context', () => {
  const description = '全麻后GCS评分8分。苏醒后入院GCS评分8分。';
  const snapshot = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const scores = snapshot.facts.filter(item => item.field === 'gcs_score');

  assert.equal(scores.length, 2);
  assert.deepEqual(scores.map(item => [item.evidence, item.certainty]).sort(([left], [right]) => left.localeCompare(right, 'zh-CN')),
    [['全麻后GCS评分8分', 'unknown'], ['苏醒后入院GCS评分8分', 'reported']]);
});
