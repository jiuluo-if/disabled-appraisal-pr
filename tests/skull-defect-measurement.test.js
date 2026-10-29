import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

const clause = catalogs.disability.clauses.find(item => item.id === '5.9.2.2');
const extract = (description, facts = []) => normalizeExtractedFacts({ facts, missingMaterials: [], conflicts: [], requiresReview: false },
  { description });

test('skull defect area is compared as a quoted measurement and surgery condition remains independently required', () => {
  const areaOnly = extract('CT提示颅骨缺损面积30平方厘米。');
  assert.ok(areaOnly.facts.some(fact => fact.field === 'skull_defect_area_cm2' && fact.value === 30));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, areaOnly.facts).met, null);

  const complete = [
    { id: 'F-area', eventId: 'E1', field: 'skull_defect_area_cm2', value: 30, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: 'CT提示颅骨缺损面积30平方厘米' },
    { id: 'F-surgery', eventId: 'E1', field: 'clinical_finding', value: '不宜手术修补', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '不宜手术修补' },
  ];
  assert.equal(evaluateConditionLogic(clause.conditionLogic, complete).met, true);

  const belowThreshold = complete.map(fact => fact.id === 'F-area' ? { ...fact, value: 24,
    evidence: 'CT提示颅骨缺损面积24平方厘米' } : fact);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, belowThreshold).met, false);
});

test('uncertain skull defect measurements do not become threshold evidence', () => {
  const facts = extract('CT提示颅骨缺损面积约30平方厘米，不宜手术修补。');
  assert.equal(facts.facts.some(fact => fact.field === 'skull_defect_area_cm2'), false);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts.facts).met, null);
});
