import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { evaluateConditionLogic, normalizeResult } from '../gemini/lib/results.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { inputs, providerFixture } from './fixtures.js';

const areaFact = { id: 'F1', eventId: 'E1', field: 'contusion_tbsa_percent', value: 6,
  certainty: 'reported', source: 'description', evidence: '本次事故后挫伤面积达体表面积6%', verification: 'quoted' };
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
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [{ ...areaFact, value: 2,
    evidence: '本次事故后挫伤面积占体表面积2%' }]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [{ ...areaFact, value: 2,
    evidence: '本次事故后全身挫伤面积累计占体表面积2%' }]).met, false);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [{ ...areaFact, value: 4.7,
    evidence: '本次事故后挫伤面积占体表面积4.7%' }]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(15)]).met, true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(14)]).met, true);
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
  const description = '本次事故后挫伤面积达体表面积6%。';
  const result = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: areaFact.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: areaFact.evidence, factIds: ['F1'], met: true }],
  }] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'age-adjustment-model-override', model: 'test-model',
    extractedFacts: [areaFact], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });

  assert.equal(result.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(result.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));

  const nearThresholdFact = { ...areaFact, value: 5, evidence: '本次事故后挫伤面积占体表面积5%' };
  const nearThreshold = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: nearThresholdFact.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: nearThresholdFact.evidence, factIds: ['F1'], met: true }],
  }] }, { ...inputs.injury, description: nearThresholdFact.evidence }, {
    clauses: [clause], requestId: 'age-adjustment-minor-threshold', model: 'test-model',
    extractedFacts: [nearThresholdFact], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.ok(nearThreshold.missingMaterials.some(material => material.includes('6.18')));
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

test('contusion TBSA facts use the injury standard age bands and inclusive numeric boundaries', () => {
  const normalizeContusion = (age, percent) => {
    const description = `2025年3月1日交通事故发生后，受伤时年龄${age}周岁；本次事故全身挫伤面积占体表面积${percent}%。`;
    const normalized = normalizeExtractedFacts({ facts: [{ id: 'A1', eventId: 'E1', field: 'age_at_injury_years',
      value: age, certainty: 'reported', source: 'description', evidence: `受伤时年龄${age}周岁` }],
    missingMaterials: [], conflicts: [], requiresReview: false }, { description });
    return normalized.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  };
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');
  const met = (age, percent) => evaluateConditionLogic(clause.conditionLogic,
    normalizeContusion(age, percent)).met;

  assert.equal(met(6, 3), true);
  assert.equal(met(7, 3), false);
  assert.equal(met(10, 3.6), true);
  assert.equal(met(11, 3.6), false);
  assert.equal(met(14, 4.8), true);
  assert.equal(met(15, 4.8), false);
  const noDateDescription = '本次交通事故后受伤时年龄12周岁全身挫伤面积占体表面积5%。';
  const noDateFacts = normalizeExtractedFacts({ facts: [{ id: 'A1', eventId: 'E1', field: 'age_at_injury_years',
    value: 12, certainty: 'reported', source: 'description', evidence: '受伤时年龄12周岁' }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description: noDateDescription }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  const noDateContusion = noDateFacts.find(fact => fact.field === 'contusion_tbsa_percent');
  assert.equal(noDateContusion?.eventId, 'E1');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, noDateFacts).met, true);
  const splitAreas = [
    { ...areaFact, id: 'A1', value: 2, evidence: '本次事故后头部挫伤面积占体表面积2%' },
    { ...areaFact, id: 'A2', value: 2, evidence: '本次事故后背部挫伤面积占体表面积2%' },
    ageFact(6),
  ];
  assert.equal(evaluateConditionLogic(clause.conditionLogic, splitAreas).met, null);
});

test('TBSA contusion parsing preserves uncertainty and rejects neighboring injury types and comparison phrases', () => {
  const extract = description => normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description }).facts;
  const uncertain = extract('病历考虑挫伤面积占体表面积5%。');
  assert.equal(uncertain.find(fact => fact.field === 'contusion_tbsa_percent')?.certainty, 'uncertain');
  assert.equal(extract('挫伤面积未达体表面积5%。').some(fact => fact.field === 'contusion_tbsa_percent'), false);
  assert.equal(extract('烧伤面积占体表面积5%。').some(fact => fact.field === 'contusion_tbsa_percent'), false);
  assert.equal(extract('擦伤面积占体表面积5%。').some(fact => fact.field === 'contusion_tbsa_percent'), false);
  assert.equal(extract('挫伤面积占体表面积4至5%。').some(fact => fact.field === 'contusion_tbsa_percent'), false);
  assert.equal(extract('挫伤面积占体表面积4%-5%。').some(fact => fact.field === 'contusion_tbsa_percent'), false);
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');
  const rangeFact = { ...areaFact, value: 5, evidence: '本次事故后挫伤面积占体表面积4至5%' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [rangeFact, ageFact(15)]).met, null);
});
