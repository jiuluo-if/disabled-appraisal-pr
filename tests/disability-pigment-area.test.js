import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { evaluateConditionLogic, normalizeResult } from '../gemini/lib/results.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { inputs, providerFixture } from './fixtures.js';

const ageFacts = (age, assessmentAge = age) => [
  { id: 'A1', eventId: 'E1', field: 'age_at_injury_years', value: age, certainty: 'reported',
    source: 'description', evidence: `受伤时年龄${age}周岁`, verification: 'quoted' },
  { id: 'A2', eventId: 'E1', field: 'age_at_assessment_years', value: assessmentAge, certainty: 'reported',
    source: 'description', evidence: `评残时年龄${assessmentAge}周岁`, verification: 'quoted' },
];

test('disability pigment-area thresholds use measured face-area facts, not conclusion text', () => {
  const cases = [
    { id: '5.8.2.6', threshold: 100 },
    { id: '5.9.2.6', threshold: 30 },
    { id: '5.10.2.6', threshold: 10 },
  ];

  for (const item of cases) {
    const description = `本次事故后受伤时年龄20周岁，评残时年龄20周岁，面部色素异常累计面积${item.threshold}cm2。`;
    const extracted = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
      { description });
    const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.disability.clauses.find(candidate => candidate.id === item.id);
    const measuredFact = facts.find(fact => fact.field === 'facial_skin_abnormality_area_cm2');
    const conclusionText = clause.conditionLogic.logic.children[1].conditionText;
    const conclusionOnly = { id: `C-${item.id}`, eventId: 'E1', field: 'clinical_finding',
      value: conclusionText, certainty: 'reported', source: 'description', evidence: conclusionText, verification: 'quoted' };

    assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [...ageFacts(20), conclusionOnly]).met, true,
      `${item.id} must not accept an unstructured conclusion`);
    assert.equal(measuredFact?.value, item.threshold, item.id);
    assert.equal(evaluateConditionLogic(clause.conditionLogic, [...facts, ...ageFacts(20)]).met, true, item.id);
    const measured = [...facts, ...ageFacts(20)].find(fact => fact.field === 'facial_skin_abnormality_area_cm2');
    const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
      facts: [], references: [{ clauseId: item.id, relation: 'supports', evidence: measured.evidence, reasoning: '',
        conditions: [{ condition: clause.text, evidence: measured.evidence, factIds: [measured.id], met: true }] }] },
    { ...inputs.disability, description }, { clauses: [clause], requestId: `pigment-area-${item.id}`,
      model: 'test-model', extractedFacts: [...facts, ...ageFacts(20)], conflicts: [], requiresReview: false,
      factMissingMaterials: [] });
    assert.equal(result.grade, clause.grade, item.id);
    assert.equal(result.references.find(reference => reference.id === item.id)?.relation, 'supports', item.id);
    const belowDescription = description.replace(`${item.threshold}cm2`, `${item.threshold - 0.01}cm2`);
    const below = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
      { description: belowDescription }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [...below, ...ageFacts(20)]).met, true,
      `${item.id} must preserve the numeric threshold boundary`);
  }
});

test('pigment-area facts remain unknown when disability age evidence is missing or under 15', () => {
  const description = '面部色素异常累计面积100cm2。';
  const extracted = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description });
  const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const clause = catalogs.disability.clauses.find(candidate => candidate.id === '5.8.2.6');

  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, facts).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [...facts, ...ageFacts(6)]).met, true);
});
