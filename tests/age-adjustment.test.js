import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { evaluateConditionLogic, normalizeResult } from '../gemini/lib/results.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { inputs, providerFixture } from './fixtures.js';

const areaFact = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '挫伤面积达体表面积6％',
  certainty: 'reported', source: 'description', evidence: '挫伤面积达体表面积6％', verification: 'quoted' };
const ageFact = (value, evidence = `受伤时年龄${value}周岁`, eventId = 'E1', id = 'F2') => ({
  id, eventId, field: 'age_at_injury_years', value, certainty: 'reported', source: 'description', evidence,
  verification: 'quoted',
});
const assessmentAgeFact = (value, evidence = `评残时年龄${value}周岁`, eventId = 'E1', id = 'F3') => ({
  id, eventId, field: 'age_at_assessment_years', value, certainty: 'reported', source: 'description', evidence,
  verification: 'quoted',
});

test('injury-standard body-surface rules fail closed without verified adult age at the same injury event', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');

  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(15)]).met, true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(14)]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(15, '受伤时年龄14周岁')]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(15, undefined, 'E2')]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(15), ageFact(14, undefined, 'E1', 'F3')]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact,
    { ...ageFact(15), certainty: 'conflicted' }]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact,
    ageFact(15, '患者父亲受伤时年龄15周岁')]).met, null);
});

test('explicit age-at-injury evidence survives fact normalization and all TBSA branches carry the age gate', () => {
  const description = '2025年3月1日发生事故，受伤时年龄15周岁。挫伤面积达体表面积6％。';
  const normalized = normalizeExtractedFacts({ facts: [
    { id: 'F1', eventId: 'E1', field: 'age_at_injury_years', value: 15, certainty: 'reported',
      source: 'description', evidence: '受伤时年龄15周岁' },
    { id: 'F2', eventId: 'E1', field: 'clinical_finding', value: '挫伤面积达体表面积6％', certainty: 'reported',
      source: 'description', evidence: '挫伤面积达体表面积6％' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = normalized.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const bruise = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');
  assert.equal(evaluateConditionLogic(bruise.conditionLogic, facts).met, true);

  const markedLeaves = [];
  const collect = node => {
    if (node.op === 'condition' && node.ageAdjustment === 'injury_standard_6_18') markedLeaves.push(node);
    for (const child of node.children || []) collect(child);
  };
  for (const id of ['5.11.1.a', '5.11.2.a', '5.11.3.a', '5.12.1.a', '5.12.2.a', '5.12.3.a', '5.12.4.a']) {
    collect(catalogs.injury.clauses.find(item => item.id === id).conditionLogic.logic);
  }
  assert.equal(markedLeaves.length, 12);
});

test('a model support flag cannot override missing injury age for a TBSA rule', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');
  const description = '挫伤面积达体表面积6％。';
  const result = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: areaFact.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: areaFact.evidence, factIds: ['F1'], met: true }],
  }] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'age-adjustment-model-override', model: 'test-model',
    extractedFacts: [areaFact], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });

  assert.equal(result.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(result.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
});

test('facial-scar disability thresholds require age evidence and use the separate 6.11 rule', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.8.2.6');
  const scar = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '面部片状细小瘢痕形成，累计面积达100.0cm2',
    certainty: 'reported', source: 'description', evidence: '面部片状细小瘢痕形成，累计面积达100.0cm2', verification: 'quoted' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [scar]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [scar, ageFact(15), assessmentAgeFact(15)]).met, true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [scar, ageFact(14), assessmentAgeFact(15)]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [scar, ageFact(15), assessmentAgeFact(14)]).met, null);

  const description = '受伤时年龄15周岁，评残时年龄15周岁。面部片状细小瘢痕形成，累计面积达100.0cm2。';
  const normalized = normalizeExtractedFacts({ facts: [
    { id: 'F1', eventId: 'E1', field: 'age_at_injury_years', value: 15, certainty: 'reported',
      source: 'description', evidence: '受伤时年龄15周岁' },
    { id: 'F2', eventId: 'E1', field: 'age_at_assessment_years', value: 15, certainty: 'reported',
      source: 'description', evidence: '评残时年龄15周岁' },
    { id: 'F3', eventId: 'E1', field: 'clinical_finding', value: scar.value, certainty: 'reported',
      source: 'description', evidence: scar.evidence },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  assert.equal(evaluateConditionLogic(clause.conditionLogic,
    normalized.facts.map(fact => ({ ...fact, verification: 'quoted' }))).met, true);

  const result = normalizeResult({ ...providerFixture('disability'), grade: '九级伤残', facts: [], references: [{
    clauseId: clause.id, evidence: scar.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: scar.evidence, factIds: ['F1'], met: true }],
  }] }, { ...inputs.disability, description: scar.evidence }, {
    clauses: [clause], requestId: 'disability-age-adjustment-model-override', model: 'test-model',
    extractedFacts: [scar], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(result.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(result.missingMaterials.some(material => material.includes('6.11')));

  const markedLeaves = [];
  const collect = node => {
    if (node.op === 'condition' && node.ageAdjustment === 'disability_standard_6_11') markedLeaves.push(node);
    for (const child of node.children || []) collect(child);
  };
  const ids = ['5.6.2.2','5.6.2.3','5.7.2.1','5.7.2.2','5.8.2.4','5.8.2.5','5.8.2.6',
    '5.9.2.4','5.9.2.5','5.9.2.6','5.10.2.3','5.10.2.4','5.10.2.5','5.10.2.6'];
  for (const id of ids) collect(catalogs.disability.clauses.find(item => item.id === id).conditionLogic.logic);
  assert.equal(markedLeaves.length, 25);
});
