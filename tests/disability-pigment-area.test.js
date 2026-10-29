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

test('facial percentage clauses use typed ratio facts and keep child ratios unknown', () => {
  const cases = [
    { id: '5.6.2.3', value: 80, description: '面部片状细小瘢痕形成累计达面部面积的80％。' },
    { id: '5.7.2.2', value: 50, description: '面部色素显著异常累计达面部面积的50%。' },
    { id: '5.7.2.2', value: 50, description: '面部色素显著异常累计达面部面积的百分之五十。',
      below: '面部色素显著异常累计达面部面积的百分之四十九。', belowValue: 49 },
  ];

  for (const item of cases) {
    const description = `本次事故后受伤时年龄20周岁，评残时年龄20周岁，${item.description}`;
    const extracted = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
      { description });
    const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.disability.clauses.find(candidate => candidate.id === item.id);
    const ratioFact = facts.find(fact => fact.field === 'facial_skin_abnormality_area_percent');

    assert.equal(ratioFact?.value, item.value, item.id);
    const modelFact = normalizeExtractedFacts({ facts: [{ id: `M-${item.id}`,
      field: 'facial_skin_abnormality_area_percent', value: item.value, certainty: 'reported',
      source: 'description', evidence: item.description.replace(/[。]$/u, '') }], missingMaterials: [],
      conflicts: [], requiresReview: false }, { description });
    assert.ok(modelFact.facts.some(fact => fact.field === 'facial_skin_abnormality_area_percent'
      && fact.value === item.value && fact.gradeEligible !== false), item.id);
    const wrongModelFact = normalizeExtractedFacts({ facts: [{ id: `M-wrong-${item.id}`,
      field: 'facial_skin_abnormality_area_percent', value: item.value - 1, certainty: 'reported',
      source: 'description', evidence: item.description.replace(/[。]$/u, '') }], missingMaterials: [],
      conflicts: [], requiresReview: false }, { description });
    assert.ok(!wrongModelFact.facts.some(fact => fact.field === 'facial_skin_abnormality_area_percent'
      && fact.value === item.value - 1), item.id);
    assert.equal(evaluateConditionLogic(clause.conditionLogic, [...facts, ...ageFacts(20)]).met, true, item.id);
    const conclusion = { id: `C-${item.id}`, eventId: 'E1', field: 'clinical_finding',
      value: item.description.replace(/[。]$/u, ''), certainty: 'reported', source: 'description',
      evidence: item.description.replace(/[。]$/u, ''), verification: 'quoted' };
    assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [...ageFacts(20), conclusion]).met, true,
      `${item.id} must not accept a legal conclusion as a ratio measurement`);
    const belowEvidence = item.below || item.description.replace(String(item.value), String(item.value - 0.01));
    const below = { ...ratioFact, value: item.belowValue ?? item.value - 0.01, evidence: belowEvidence };
    assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [...ageFacts(20), below]).met, true,
      `${item.id} must preserve the ratio threshold`);
    assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [...facts, ...ageFacts(6)]).met, true,
      `${item.id} must leave minors for review`);
  }

  const ambiguousDescription = '本次事故后面部片状细小瘢痕累计达面部面积的80%，色素显著异常累计达面部面积的50%。';
  const ambiguous = normalizeExtractedFacts({ facts: [
    { id: 'M1', field: 'facial_skin_abnormality_area_percent', value: 80, certainty: 'reported',
      source: 'description', evidence: '面部片状细小瘢痕累计达面部面积的80%' },
    { id: 'M2', field: 'facial_skin_abnormality_area_percent', value: 50, certainty: 'reported',
      source: 'description', evidence: '色素显著异常累计达面部面积的50%' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description: ambiguousDescription });
  assert.equal(ambiguous.facts.some(fact => fact.field === 'facial_skin_abnormality_area_percent'), false);
  assert.ok(ambiguous.factAudit.some(item => item.field === 'facial_skin_abnormality_area_percent' && item.status === 'excluded'));
});

test('unstructured facial-percentage conclusions request source measurements for review', () => {
  const clause = catalogs.disability.clauses.find(candidate => candidate.id === '5.6.2.3');
  const evidence = '面部片状细小瘢痕形成累计达面部面积的80％';
  const description = `本次事故后受伤时年龄20周岁，评残时年龄20周岁，${evidence}。`;
  const conclusion = { id: 'PERCENT-CONCLUSION', eventId: 'E1', field: 'clinical_finding', value: evidence,
    certainty: 'reported', source: 'description', evidence, verification: 'quoted' };
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence, reasoning: '',
      conditions: [{ condition: clause.text, evidence, factIds: [conclusion.id], met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'unstructured-face-ratio-review',
    model: 'test-model', extractedFacts: [conclusion, ...ageFacts(20)], conflicts: [], requiresReview: false,
    factMissingMaterials: [] });

  assert.equal(result.grade, null);
  assert.notEqual(result.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.ok(result.missingMaterials.some(material => /百分比测量|比例测量/u.test(material)));
});
