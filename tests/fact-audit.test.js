import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { readHistory, saveHistory } from '../client/history.js';
import { resultFixture } from './fixtures.js';

test('normalized and rejected model facts keep source IDs, original evidence, and an audit reason', () => {
  const description = '患者诉左耳耳鸣，影像未见脑梗死。';
  const result = normalizeExtractedFacts({ facts: [
    { id: 'M1', field: 'symptom', value: '耳鸣', certainty: 'reported',
      source: 'description', evidence: '患者诉左耳耳鸣' },
    { id: 'M2', field: 'diagnosis', value: '脑梗死', certainty: 'reported',
      source: 'description', evidence: '影像未见异常' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

  const accepted = result.factAudit.find(item => item.rawFactId === 'M1');
  const rejected = result.factAudit.find(item => item.rawFactId === 'M2');
  assert.equal(accepted.status, 'normalized');
  assert.equal(accepted.proposedField, 'symptom');
  assert.deepEqual(accepted.normalizedFactIds, ['F1']);
  assert.equal(accepted.evidence, '患者诉左耳耳鸣');
  assert.equal(accepted.gradeEligible, true);
  assert.equal(result.facts.find(fact => fact.id === 'F1').sourceFactIds.includes('M1'), true);
  assert.equal(rejected.status, 'excluded');
  assert.equal(rejected.evidence, '影像未见异常');
  assert.equal(rejected.reasonCode, 'evidence_not_found');
  assert.equal(rejected.gradeEligible, false);
  assert.deepEqual(rejected.normalizedFactIds, []);
  assert.equal(result.facts.some(fact => fact.value === '脑梗死'), false);
});

test('a fact in the explicitly included half of a scope sentence retains its local quote', () => {
  const description = '同案早期头部损伤记录不属于本次眼部补充评估范围，但右眼球缺失且该事实属于本次评估内容。治疗已终结。';
  const result = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description });

  const included = result.facts.find(fact => fact.field === 'clinical_finding' && fact.value === '一侧眼球缺失');
  assert.ok(included);
  assert.equal(included.evidence, '右眼球缺失');
  assert.equal(result.factAudit.some(item => item.evidence.includes('右眼球缺失')
    && item.reasonCode === 'out_of_scope'), false);
  assert.ok(result.factAudit.some(item => item.reasonCode === 'out_of_scope'
    && item.evidence.includes('头部损伤')));
});

test('automatic browser history does not persist the raw-fact audit or input fingerprints', () => {
  let value = '[]';
  const storage = { getItem: () => value, setItem: (key, json) => { value = json; } };
  const result = { ...resultFixture(), factAudit: [{ rawFactId: 'M1', evidence: '敏感原文' }],
    analysisSnapshot: { inputDigest: 'a'.repeat(64) } };

  saveHistory('injury', { id: 'history-1', title: 'sample', result }, storage);

  const stored = JSON.parse(value)[0].result;
  assert.equal('factAudit' in stored, false);
  assert.equal('analysisSnapshot' in stored, false);
  const [loaded] = readHistory('injury', storage);
  assert.equal('factAudit' in loaded.result, false);
});
