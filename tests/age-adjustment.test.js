import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, retrieveClauses } from '../gemini/lib/catalog.js';
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

test('injury-standard body-surface rules need age only when the age band changes the threshold result', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');

  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact]).met, true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [{ ...areaFact, value: 2,
    evidence: '本次事故后挫伤面积占体表面积2%' }]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [{ ...areaFact, value: 2,
    evidence: '本次事故后全身挫伤面积累计占体表面积2%' }]).met, false);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [{ ...areaFact, value: 4.7,
    evidence: '本次事故后挫伤面积占体表面积4.7%' }]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(15)]).met, true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [areaFact, ageFact(14)]).met, true);
  const ageSensitiveFact = { ...areaFact, value: 5, evidence: '本次事故后挫伤面积占体表面积5%' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic,
    [ageSensitiveFact, ageFact(15, '受伤时年龄14周岁')]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [ageSensitiveFact, ageFact(15, undefined, 'E2')]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic,
    [ageSensitiveFact, ageFact(15), ageFact(14, undefined, 'E1', 'F3')]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [ageSensitiveFact,
    { ...ageFact(15), certainty: 'conflicted' }]).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [ageSensitiveFact,
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
  for (const id of ['5.11.1.a', '5.11.2.a', '5.11.3.a', '5.12.1.a', '5.12.2.a', '5.12.3.a', '5.12.4.a',
    '5.12.5.b', '5.12.5.c', '5.12.5.d', '5.2.3.c', '5.2.4.e', '5.1.3.a', '5.1.4.a',
    '5.1.2.a', '5.1.3.b', '5.1.4.b']) {
    collect(catalogs.injury.clauses.find(item => item.id === id).conditionLogic.logic);
  }
  assert.equal(markedLeaves.length, 26);
  for (const id of ['5.12.5.b', '5.12.5.c', '5.12.5.d', '5.2.3.c', '5.2.4.e', '5.1.3.a', '5.1.4.a',
    '5.1.2.a', '5.1.3.b', '5.1.4.b']) {
    assert.equal(catalogs.injury.clauses.find(item => item.id === id).conditionLogic.ageAdjustment, 'injury_standard_6_18');
  }
});

test('a model support flag cannot override an age-dependent TBSA result, while age-invariant evidence remains usable', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.3.a');
  const description = '本次事故后挫伤面积达体表面积6%。';
  const result = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: areaFact.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: areaFact.evidence, factIds: ['F1'], met: true }],
  }] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'age-adjustment-model-override', model: 'test-model',
    extractedFacts: [areaFact], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });

  assert.equal(result.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), true);
  assert.equal(result.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')), false);

  const nearThresholdFact = { ...areaFact, value: 5, evidence: '本次事故后挫伤面积占体表面积5%' };
  const nearThreshold = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: nearThresholdFact.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: nearThresholdFact.evidence, factIds: ['F1'], met: true }],
  }] }, { ...inputs.injury, description: nearThresholdFact.evidence }, {
    clauses: [clause], requestId: 'age-adjustment-minor-threshold', model: 'test-model',
    extractedFacts: [nearThresholdFact], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(nearThreshold.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(nearThreshold.missingMaterials.some(material => material.includes('6.18')));
});

test('facial-scar disability thresholds require age evidence and use the separate 6.11 rule', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.8.2.6');
  const scar = { id: 'F1', eventId: 'E1', field: 'aggregate_surface_scar_area_cm2', value: 100,
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
    { id: 'F3', eventId: 'E1', field: scar.field, value: scar.value, certainty: 'reported',
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
  assert.equal(markedLeaves.length, 32);
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
    { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
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

test('burn depth and TBSA percentages normalize as one source-bound fact and scale at injury-age boundaries', () => {
  const description = '本次事故后受伤时年龄10周岁，Ⅱ度以上烧烫伤面积占体表面积12%。';
  const normalized = normalizeExtractedFacts({ facts: [{ id: 'A1', eventId: 'E1', field: 'age_at_injury_years',
    value: 10, certainty: 'reported', source: 'description', evidence: '受伤时年龄10周岁' }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = normalized.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const burn = facts.find(fact => fact.field === 'burn_tbsa_ii_plus_percent');
  assert.equal(burn?.value, 12);
  assert.equal(burn?.eventId, 'E1');
  const severe = catalogs.injury.clauses.find(item => item.id === '5.12.3.a');
  assert.equal(evaluateConditionLogic(severe.conditionLogic, facts).met, true);
  assert.ok(retrieveClauses('injury', description, 1, facts).some(item => item.id === severe.id));

  const deep = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: '深II度烧伤面积占体表面积35%。' }).facts;
  assert.ok(deep.some(fact => fact.field === 'burn_tbsa_deep_ii_plus_percent' && fact.value === 35));
  const third = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: 'Ⅲ度烧伤面积占体表面积10%。' }).facts;
  assert.ok(third.some(fact => fact.field === 'burn_tbsa_iii_percent' && fact.value === 10));
  assert.equal(third.some(fact => fact.field === 'burn_tbsa_deep_ii_plus_percent'), false);

  const assessBurn = (id, age, degreePhrase, percent) => {
    const inputText = `2025年3月1日交通事故发生后，受伤时年龄${age}周岁，${degreePhrase}面积占体表面积${percent}%。`;
    const result = normalizeExtractedFacts({ facts: [{ id: 'A1', eventId: 'E1', field: 'age_at_injury_years',
      value: age, certainty: 'reported', source: 'description', evidence: `受伤时年龄${age}周岁` }],
    missingMaterials: [], conflicts: [], requiresReview: false }, { description: inputText });
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic,
      result.facts.map(fact => ({ ...fact, verification: 'quoted' }))).met;
  };
  assert.equal(assessBurn('5.12.1.a', 6, '深II度以上烧烫伤', 35), true);
  assert.equal(assessBurn('5.12.1.a', 7, '深II度以上烧烫伤', 35), null);
  assert.equal(assessBurn('5.12.3.a', 11, 'II度以上烧烫伤', 12), null);
  assert.equal(assessBurn('5.12.3.a', 14, 'II度以上烧烫伤', 16), true);
  assert.equal(assessBurn('5.12.3.a', 15, 'II度以上烧烫伤', 16), null);
  assert.equal(assessBurn('5.12.4.a', 14, 'III度烧伤', 0.4), true);
  assert.equal(assessBurn('5.12.4.a', 15, 'III度烧伤', 0.4), null);
});

test('burn parser requires explicit depth and denominator and rejects uncertain or ranged measurements', () => {
  const extract = description => normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(extract('烧伤面积占体表面积10%。').some(fact => fact.field.startsWith('burn_tbsa_')), false);
  assert.equal(extract('III度烧伤面积10%。').some(fact => fact.field.startsWith('burn_tbsa_')), false);
  const uncertain = extract('考虑III度烧伤面积占体表面积10%。').filter(fact => fact.field.startsWith('burn_tbsa_'));
  assert.ok(uncertain.length > 0);
  assert.ok(uncertain.every(fact => fact.certainty === 'uncertain'));
  assert.equal(extract('III度烧伤面积占体表面积8至10%。').some(fact => fact.field.startsWith('burn_tbsa_')), false);
});

test('local burn-area thresholds use source-bound degree and anatomical site measurements', () => {
  const extract = description => normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const supports = (id, text, age = 15) => {
    const description = `受伤时年龄${age}周岁，${text}`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };
  const cases = [
    ['5.12.5.b', '面部Ⅰ度烧烫伤面积10平方厘米', true],
    ['5.12.5.c', '颈部I度烧伤面积15cm2', true],
    ['5.12.5.c', '颈部浅II度烧烫伤面积2平方厘米', true],
    ['5.12.5.d', '体表I度烧烫伤面积20平方厘米', true],
    ['5.12.5.d', '身体浅Ⅱ度烧伤面积4cm2', true],
    ['5.12.5.b', '面部Ⅰ度烧烫伤面积9.99平方厘米', null],
    ['5.12.5.c', '颈部I度烧伤面积14.99cm2', null],
    ['5.12.5.c', '颈部浅II度烧烫伤面积1.99平方厘米', null],
    ['5.12.5.d', '体表I度烧烫伤面积19.99平方厘米', null],
    ['5.12.5.d', '身体浅Ⅱ度烧伤面积3.99cm2', null],
  ];
  for (const [id, text, expected] of cases) assert.equal(supports(id, text), expected, `${id}: ${text}`);
  const childText = '本次事故后受伤时年龄6周岁，面部Ⅰ度烧烫伤面积5平方厘米。';
  const childFacts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: childText }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.12.5.b').conditionLogic,
    childFacts).met, true);
  assert.equal(supports('5.12.5.b', '面部Ⅰ度烧烫伤面积5平方厘米', 6), true);
  assert.equal(supports('5.12.5.b', '面部Ⅰ度烧烫伤面积4.99平方厘米', 6), null);
  assert.equal(supports('5.12.5.b', '面部Ⅰ度烧烫伤面积6平方厘米', 7), true);
  assert.equal(supports('5.12.5.b', '面部Ⅰ度烧烫伤面积8平方厘米', 11), true);
  assert.equal(supports('5.12.5.b', '面部Ⅰ度烧烫伤面积9.99平方厘米', 15), null);
  assert.equal(supports('5.12.5.b', '面部Ⅰ度烧烫伤面积4.99平方厘米', 15), null);
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.12.5.b').conditionLogic,
    extract('面部Ⅰ度烧烫伤面积5平方厘米')).met, null);
  const noAgeDescription = '面部Ⅰ度烧烫伤面积5平方厘米';
  const noAgeFacts = extract(noAgeDescription);
  const faceClause = catalogs.injury.clauses.find(item => item.id === '5.12.5.b');
  const faceFact = noAgeFacts.find(fact => fact.field === 'burn_area_face_first_degree_cm2');
  const noAgeResult = normalizeResult({ ...providerFixture('injury'), grade: '轻伤二级', facts: [], references: [{
    clauseId: faceClause.id, evidence: faceFact.evidence, reasoning: '模型认为阈值满足。', relation: 'supports',
    conditions: [{ condition: faceClause.text, evidence: faceFact.evidence, factIds: [faceFact.id], met: true }],
  }] }, { ...inputs.injury, description: noAgeDescription }, {
    clauses: [faceClause], requestId: 'burn-area-age-review', model: 'test-model',
    extractedFacts: noAgeFacts, conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(noAgeResult.references.some(reference => reference.id === faceClause.id && reference.relation === 'supports'), false);
  assert.ok(noAgeResult.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
  const facial = extract('面部Ⅰ度烧烫伤面积12平方厘米。');
  assert.equal(facial.find(fact => fact.field === 'burn_area_face_first_degree_cm2')?.value, 12);
  assert.equal(extract('颈部Ⅰ度烧烫伤面积15平方厘米。')
    .some(fact => fact.field === 'burn_area_face_first_degree_cm2'), false);
  assert.equal(extract('本次事故后，面部Ⅰ度烧烫伤面积约12平方厘米。')
    .some(fact => fact.field.startsWith('burn_area_')), false);
  assert.equal(extract('本次事故后，面部Ⅰ度烧烫伤面积8至12平方厘米。')
    .some(fact => fact.field.startsWith('burn_area_')), false);
  assert.equal(extract('本次事故后，面部Ⅰ度烧烫伤面积八至十二平方厘米。')
    .some(fact => fact.field.startsWith('burn_area_')), false);
  assert.equal(extract('未见面部Ⅰ度烧烫伤，面积12平方厘米。')
    .some(fact => fact.field.startsWith('burn_area_')), false);
  assert.equal(extract('面部Ⅰ度以上烧烫伤面积12平方厘米。')
    .some(fact => fact.field.startsWith('burn_area_')), false);
  assert.equal(extract('面部和颈部Ⅰ度烧烫伤面积12平方厘米。')
    .some(fact => fact.field.startsWith('burn_area_')), false);
  const sentence = '本次事故后受伤时年龄6周岁，面部Ⅰ度烧烫伤面积5平方厘米。';
  const linked = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: sentence }).facts;
  const age = linked.find(fact => fact.field === 'age_at_injury_years');
  const burnArea = linked.find(fact => fact.field === 'burn_area_face_first_degree_cm2');
  assert.ok(age?.eventId);
  assert.equal(burnArea?.eventId, age.eventId);
});

test('facial skin injury area thresholds use the age bands in injury standard 6.18', () => {
  const assess = (id, age, area) => {
    const description = `本次事故后受伤时年龄${age}周岁，面部色素异常面积累计${area}平方厘米。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };
  assert.equal(assess('5.2.4.e', 6, 4), true);
  assert.equal(assess('5.2.4.e', 6, 3.99), false);
  assert.equal(assess('5.2.4.e', 7, 4.8), true);
  assert.equal(assess('5.2.4.e', 10, 4.8), true);
  assert.equal(assess('5.2.4.e', 11, 6.4), true);
  assert.equal(assess('5.2.4.e', 14, 6.4), true);
  assert.equal(assess('5.2.4.e', 15, 7.99), false);
  assert.equal(assess('5.2.4.e', 15, 8), true);
  assert.equal(assess('5.2.3.c', 6, 15), true);
  assert.equal(assess('5.2.3.c', 14, 24), true);
  assert.equal(assess('5.2.3.c', 15, 29.99), false);
  const noAge = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: '面部色素异常面积累计5平方厘米。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.2.4.e').conditionLogic,
    noAge).met, null);
  const separateAreas = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: '面部色素异常面积累计2平方厘米。面部细小瘢痕面积累计2平方厘米。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.2.4.e').conditionLogic,
    separateAreas).met, null);
  const faceClause = catalogs.injury.clauses.find(item => item.id === '5.2.4.e');
  const faceFact = noAge.find(fact => fact.field === 'facial_skin_abnormality_area_cm2');
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: '轻伤二级', facts: [], references: [{
    clauseId: faceClause.id, evidence: faceFact.evidence, reasoning: '模型认为面积达到阈值。', relation: 'supports',
    conditions: [{ condition: faceClause.text, evidence: faceFact.evidence, factIds: [faceFact.id], met: true }],
  }] }, { ...inputs.injury, description: '面部色素异常面积累计5平方厘米。' }, {
    clauses: [faceClause], requestId: 'facial-area-age-review', model: 'test-model', extractedFacts: noAge,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === faceClause.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
});

test('cumulative scalp wound length thresholds use age-adjusted values from injury standard 6.18', () => {
  const aggregateAtAge = (age, lengths) => {
    const description = `本次事故后受伤时年龄${age}周岁，检查见右头皮有两处缝合创口，分别长${lengths[0]}cm和${lengths[1]}cm。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const ageEvidence = facts.find(fact => fact.field === 'age_at_injury_years');
    const aggregate = facts.find(fact => fact.field === 'aggregate_wound_length_cm'
      && fact.value === lengths[0] + lengths[1]);
    assert.ok(ageEvidence?.eventId);
    assert.equal(aggregate?.eventId, ageEvidence.eventId);
    return facts;
  };
  const slight = catalogs.injury.clauses.find(item => item.id === '5.1.4.a');
  const serious = catalogs.injury.clauses.find(item => item.id === '5.1.3.a');
  assert.equal(evaluateConditionLogic(slight.conditionLogic, aggregateAtAge(6, [2.5, 1.5])).met, true);
  assert.equal(evaluateConditionLogic(slight.conditionLogic, aggregateAtAge(7, [3, 1.8])).met, true);
  assert.equal(evaluateConditionLogic(slight.conditionLogic, aggregateAtAge(15, [4.5, 3.5])).met, true);
  assert.equal(evaluateConditionLogic(slight.conditionLogic, aggregateAtAge(15, [3.99, 4])).met, false);
  assert.equal(evaluateConditionLogic(serious.conditionLogic, aggregateAtAge(6, [5.5, 4.5])).met, true);
  const noAgeDescription = '本次事故后检查见右头皮有两处缝合创口，分别长4.5cm和3.5cm。';
  const noAgeFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: noAgeDescription,
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(slight.conditionLogic, noAgeFacts).met, true);
  const belowEveryAgeThreshold = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: '本次事故后检查见右头皮有两处缝合创口，分别长1.5cm和2.0cm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(slight.conditionLogic, belowEveryAgeThreshold).met, false);
  const uncertainAgeDescription = '本次事故后检查见右头皮有两处缝合创口，分别长3.5cm和2.0cm。';
  const uncertainAgeFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: uncertainAgeDescription,
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(slight.conditionLogic, uncertainAgeFacts).met, null);
  const total = uncertainAgeFacts.find(fact => fact.field === 'aggregate_wound_length_cm' && fact.value === 5.5);
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: '轻伤二级', facts: [], references: [{
    clauseId: slight.id, evidence: total.evidence, reasoning: '模型认为累计长度达到阈值。', relation: 'supports',
    conditions: [{ condition: slight.text, evidence: total.evidence, factIds: [total.id], met: true }],
  }] }, { ...inputs.injury, description: uncertainAgeDescription }, {
    clauses: [slight], requestId: 'scalp-length-age-review', model: 'test-model', extractedFacts: uncertainAgeFacts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === slight.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));

  const unscopedScalp = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, {
    description: '检查见左额顶部5.1cm、4.5cm疤痕。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(slight.conditionLogic, unscopedScalp).met, true);

});

test('scalp skin-defect and avulsion area thresholds use injury standard 6.18', () => {
  const assess = (id, age, finding, area) => {
    const description = `本次事故后受伤时年龄${age}周岁，头皮${finding}面积累计${area}平方厘米。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const ageEvidence = facts.find(fact => fact.field === 'age_at_injury_years');
    const areaEvidence = facts.find(fact => fact.field.startsWith('scalp_'));
    assert.equal(areaEvidence?.eventId, ageEvidence?.eventId);
    return { facts, met: evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met };
  };
  assert.equal(assess('5.1.2.a', 6, '缺损', 37.5).met, true);
  assert.equal(assess('5.1.2.a', 7, '缺损', 45).met, true);
  assert.equal(assess('5.1.2.a', 11, '缺损', 60).met, true);
  assert.equal(assess('5.1.2.a', 15, '缺损', 75).met, true);
  assert.equal(assess('5.1.3.b', 6, '撕脱伤', 25).met, true);
  assert.equal(assess('5.1.3.b', 7, '缺损', 14.4).met, true);
  assert.equal(assess('5.1.4.b', 11, '撕脱伤', 16).met, true);
  assert.equal(assess('5.1.4.b', 15, '缺损', 10).met, true);

  const extract = description => normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const severe = catalogs.injury.clauses.find(item => item.id === '5.1.2.a');
  assert.equal(evaluateConditionLogic(severe.conditionLogic, extract('本次事故后，头皮缺损面积累计75平方厘米。')).met, true);
  assert.equal(evaluateConditionLogic(severe.conditionLogic, extract('本次事故后，头皮缺损面积累计30平方厘米。')).met, false);
  const noAgeDescription = '本次事故后，头皮皮肤缺损面积累计40平方厘米。';
  const noAgeFacts = extract(noAgeDescription).map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(severe.conditionLogic, noAgeFacts).met, null);
  const areaFact = noAgeFacts.find(fact => fact.field === 'scalp_defect_area_cm2');
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: '重伤二级', facts: [], references: [{
    clauseId: severe.id, evidence: areaFact.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: severe.text, evidence: areaFact.evidence, factIds: [areaFact.id], met: true }],
  }] }, { ...inputs.injury, description: noAgeDescription }, {
    clauses: [severe], requestId: 'scalp-area-age-review', model: 'test-model', extractedFacts: noAgeFacts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === severe.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
  assert.equal(extract('本次事故后，头皮缺损面积约20平方厘米。').some(fact => fact.field.startsWith('scalp_')), false);
  assert.equal(extract('本次事故后，头皮缺损面积10至20平方厘米。').some(fact => fact.field.startsWith('scalp_')), false);
  assert.equal(extract('本次事故后，未见头皮皮肤缺损面积10平方厘米。').some(fact => fact.field.startsWith('scalp_')), false);
  assert.equal(extract('本次事故后，背部皮肤缺损面积20平方厘米。').some(fact => fact.field.startsWith('scalp_')), false);
});

test('body-surface avulsion area uses the injury 6.18 age band for skin-damage clauses', () => {
  const assess = (id, age, finding) => {
    const description = `本次事故后受伤时年龄${age}周岁，${finding}`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.injury.clauses.find(item => item.id === id);
    const fact = facts.find(item => item.field.startsWith('skin_') || item.field === 'scalp_abrasion_area_cm2');
    assert.ok(fact, `${id} should have a deterministic area fact`);
    assert.match(fact.finding, /(?:撕脱伤|缺损|擦伤|挫伤).*面积/u);
    assert.equal(fact.eventId, facts.find(item => item.field === 'age_at_injury_years')?.eventId);
    assert.ok(retrieveClauses('injury', '无关候选词', 0, facts).some(item => item.id === id));
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.11.2.c', 6, '背部皮肤撕脱伤面积累计50平方厘米。'), true);
  assert.equal(assess('5.11.2.c', 7, '背部皮肤撕脱伤面积累计60平方厘米。'), true);
  assert.equal(assess('5.11.2.c', 11, '背部皮肤撕脱伤面积累计80平方厘米。'), true);
  assert.equal(assess('5.11.2.c', 15, '背部皮肤撕脱伤面积累计100平方厘米。'), true);
  assert.equal(assess('5.11.2.d', 11, '皮肤缺损面积累计24平方厘米。'), true);
  assert.equal(assess('5.11.3.c', 7, '背部皮肤撕脱伤面积累计30平方厘米。'), true);
  assert.equal(assess('5.11.3.d', 6, '皮肤缺损面积累计3平方厘米。'), true);
  assert.equal(assess('5.11.4.a', 6, '擦伤面积累计10平方厘米。'), true);
  assert.equal(assess('5.11.4.a', 6, '挫伤面积累计7.5平方厘米。'), true);
  const mixedSurfaceFindings = '本次事故后背部皮肤擦伤面积累计10平方厘米，左上肢皮肤挫伤面积累计7.5平方厘米。';
  const mixedSurfaceFacts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: `受伤时年龄6周岁，${mixedSurfaceFindings}` }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.ok(mixedSurfaceFacts.some(fact => fact.field === 'skin_abrasion_area_cm2' && fact.value === 10));
  assert.ok(mixedSurfaceFacts.some(fact => fact.field === 'skin_contusion_area_cm2' && fact.value === 7.5));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.4.a').conditionLogic,
    mixedSurfaceFacts).met, true);
  assert.equal(assess('5.1.5.b', 6, '头皮擦伤面积累计2.5平方厘米。'), true);
  assert.equal(assess('5.11.2.c', 6, '背部皮肤撕脱伤面积累计49.99平方厘米。'), false);

  const extract = description => normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false }, { description }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  const noAge = extract('本次事故后背部皮肤撕脱伤面积累计75平方厘米。');
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.2.c').conditionLogic,
    noAge).met, null);
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.2.c').conditionLogic,
    extract('本次事故后背部皮肤撕脱伤面积累计40平方厘米。')).met, false);
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.2.c').conditionLogic,
    extract('本次事故后背部皮肤撕脱伤面积累计100平方厘米。')).met, true);
  for (const description of [
    '本次事故后背部皮肤撕脱伤面积约50平方厘米。',
    '本次事故后背部皮肤撕脱伤面积30至50平方厘米。',
    '本次事故后背部皮肤撕脱伤面积疑似50平方厘米。',
    '本次事故后未见背部皮肤撕脱伤面积50平方厘米。',
    '既往背部皮肤撕脱伤面积累计50平方厘米。',
  ]) {
    assert.equal(extract(description).some(fact => fact.field.startsWith('skin_')), false, description);
  }
  assert.ok(extract('本次事故后皮肤缺损面积50平方厘米。')
    .some(fact => fact.field === 'skin_defect_area_cm2'));

  const scalpDefectDescription = '本次事故后受伤时年龄6周岁，头皮缺损面积累计15平方厘米。';
  const scalpDefectFacts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: scalpDefectDescription }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.ok(scalpDefectFacts.some(fact => fact.field === 'skin_defect_area_cm2' && fact.evidence.includes('头皮')));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.2.d').conditionLogic,
    scalpDefectFacts).met, true);

  const separateEventDescription = '2019年受伤时年龄6周岁；2025年本次事故后背部皮肤撕脱伤面积累计75平方厘米。';
  const separateEventFacts = normalizeExtractedFacts({ facts: [ageFact(6, '受伤时年龄6周岁', 'E1')],
    missingMaterials: [], conflicts: [], requiresReview: false }, { description: separateEventDescription })
    .facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.notEqual(separateEventFacts.find(fact => fact.field === 'skin_avulsion_area_cm2')?.eventId, 'E1');
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.2.c').conditionLogic,
    separateEventFacts).met, null);

  const unknownAgeDescription = '本次事故后背部皮肤撕脱伤面积累计75平方厘米。';
  const unknownAgeFacts = extract(unknownAgeDescription);
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.2.c');
  const area = unknownAgeFacts.find(fact => fact.field === 'skin_avulsion_area_cm2');
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: area.evidence, reasoning: '模型认为条件满足。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: area.evidence, factIds: [area.id], met: true }],
  }] }, { ...inputs.injury, description: unknownAgeDescription }, {
    clauses: [clause], requestId: 'skin-area-age-review', model: 'test-model', extractedFacts: unknownAgeFacts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
});

test('localized face, neck and hand skin-area thresholds use the injury 6.18 age bands', () => {
  const assess = (id, age, finding) => {
    const description = `本次事故后受伤时年龄${age}周岁，${finding}`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.injury.clauses.find(item => item.id === id);
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.2.5.c', 6, '面部皮肤擦伤面积累计1平方厘米。'), true);
  assert.equal(assess('5.2.5.c', 7, '面部皮肤擦伤面积累计1.2平方厘米。'), true);
  assert.equal(assess('5.2.5.c', 10, '面部皮肤擦伤面积累计1.2平方厘米。'), true);
  assert.equal(assess('5.2.5.c', 11, '面部皮肤擦伤面积累计1.6平方厘米。'), true);
  assert.equal(assess('5.2.5.c', 14, '面部皮肤擦伤面积累计1.6平方厘米。'), true);
  assert.equal(assess('5.2.5.c', 15, '面部皮肤擦伤面积累计2平方厘米。'), true);
  assert.equal(assess('5.5.5.b', 6, '颈部擦伤面积累计2平方厘米。'), true);
  assert.equal(assess('5.5.5.c', 11, '颈部挫伤面积累计1.6平方厘米。'), true);
  assert.equal(assess('5.10.5.a', 6, '手擦伤面积累计5平方厘米。'), true);
  assert.equal(assess('5.10.5.a', 6, '手挫伤面积累计3平方厘米。'), true);
  assert.notEqual(assess('5.5.5.b', 6, '面部皮肤擦伤面积累计2平方厘米。'), true);
  assert.notEqual(assess('5.2.5.c', 6, '面部皮肤擦伤面积累计0.99平方厘米。'), true);
});

test('general body-surface wound-length thresholds use injury standard 6.18', () => {
  const assess = (id, age, length) => {
    const description = `本次事故后受伤时年龄${age}周岁，左上肢皮肤创口长${length}厘米。`;
    const extracted = normalizeExtractedFacts({ facts: [
      ageFact(age, `受伤时年龄${age}周岁`, 'E1', 'F1'),
      { id: 'F2', eventId: 'E1', field: 'wound_length_cm', value: length, certainty: 'reported',
        source: 'description', evidence: `左上肢皮肤创口长${length}厘米` },
    ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
    const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.injury.clauses.find(item => item.id === id);
    assert.ok(facts.some(fact => fact.field === 'wound_length_cm' && fact.value === length));
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.11.1.b', 6, 100), true);
  assert.equal(assess('5.11.1.b', 7, 120), true);
  assert.equal(assess('5.11.1.b', 10, 120), true);
  assert.equal(assess('5.11.1.b', 11, 160), true);
  assert.equal(assess('5.11.1.b', 14, 160), true);
  assert.equal(assess('5.11.1.b', 15, 200), true);
  assert.notEqual(assess('5.11.1.b', 6, 99.99), true);
  assert.equal(assess('5.11.2.b', 6, 20), true);
  assert.equal(assess('5.11.2.b', 7, 24), true);
  assert.equal(assess('5.11.2.b', 10, 24), true);
  assert.equal(assess('5.11.2.b', 11, 32), true);
  assert.equal(assess('5.11.2.b', 14, 32), true);
  assert.equal(assess('5.11.2.b', 15, 40), true);
  assert.notEqual(assess('5.11.2.b', 6, 19.99), true);

  assert.equal(assess('5.11.3.b', 6, 5), true);
  assert.equal(assess('5.11.3.b', 7, 6), true);
  assert.equal(assess('5.11.3.b', 11, 8), true);
  assert.equal(assess('5.11.3.b', 15, 10), true);
  assert.notEqual(assess('5.11.3.b', 6, 4.99), true);
  assert.equal(assess('5.11.4.b', 6, 0.5), true);
  assert.equal(assess('5.11.4.b', 7, 0.6), true);
  assert.equal(assess('5.11.4.b', 11, 0.8), true);
  assert.equal(assess('5.11.4.b', 15, 1), true);
  assert.notEqual(assess('5.11.4.b', 6, 0.49), true);

  const assessAggregate = (id, age, length) => {
    const description = `本次事故后受伤时年龄${age}周岁，多处创口累计长度${length}厘米。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const measured = facts.find(fact => fact.field === 'aggregate_wound_length_cm');
    assert.equal(facts.some(fact => fact.field === 'wound_length_cm'
      && /(?:多处|多个)/u.test(fact.evidence) && /(?:累计长|总长|长度合计)/u.test(fact.evidence)), false);
    assert.equal(measured?.eventId, facts.find(fact => fact.field === 'age_at_injury_years')?.eventId);
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };
  const oneWoundFacts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: '本次事故后受伤时年龄6周岁，一处创口累计长度4.99厘米。' }).facts;
  assert.ok(oneWoundFacts.some(fact => fact.field === 'wound_length_cm' && fact.value === 4.99));
  assert.equal(assessAggregate('5.11.1.b', 6, 100), true);
  assert.equal(assessAggregate('5.11.3.b', 7, 9), true);
  assert.equal(assessAggregate('5.11.4.b', 6, 0.75), true);
  assert.notEqual(assessAggregate('5.11.3.b', 7, 8.99), true);

  const stabFacts = [{ id: 'F-stab', eventId: 'E1', field: 'clinical_finding', value: '刺创深达肌层',
    certainty: 'reported', source: 'description', evidence: '本次事故后左上肢刺创深达肌层', verification: 'quoted' }];
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.4.b').conditionLogic,
    stabFacts).met, true);

  const noAgeDescription = '本次事故后左上肢皮肤创口长30厘米。';
  const noAgeFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: noAgeDescription }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const clause = catalogs.injury.clauses.find(item => item.id === '5.11.2.b');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, noAgeFacts).met, null);
  const wound = noAgeFacts.find(fact => fact.field === 'wound_length_cm');
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: '轻伤一级', facts: [], references: [{
    clauseId: clause.id, evidence: wound.evidence, reasoning: '模型认为累计长度达到阈值。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: wound.evidence, factIds: [wound.id], met: true }],
  }] }, { ...inputs.injury, description: noAgeDescription }, {
    clauses: [clause], requestId: 'body-wound-length-age-review', model: 'test-model', extractedFacts: noAgeFacts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));

  const splitEventDescription = '2019年受伤时年龄6周岁；2025年本次事故后左上肢皮肤创口长30厘米。';
  const splitEventFacts = normalizeExtractedFacts({ facts: [ageFact(6, '受伤时年龄6周岁', 'E1')],
    missingMaterials: [], conflicts: [], requiresReview: false }, { description: splitEventDescription })
    .facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.notEqual(splitEventFacts.find(fact => fact.field === 'wound_length_cm')?.eventId, 'E1');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, splitEventFacts).met, null);
});

test('limb and hand wound-length thresholds use injury standard 6.18', () => {
  const assess = (id, age, site, count, length) => {
    const countText = count === 1 ? '一处' : `${count}处`;
    const description = `本次事故后受伤时年龄${age}周岁，${site}皮肤${countText}创口累计长度${length}厘米。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };

  assert.equal(assess('5.9.4.l', 6, '左上臂', 1, 5), true);
  assert.equal(assess('5.9.4.l', 7, '左小腿', 2, 9), true);
  assert.notEqual(assess('5.9.4.l', 6, '左上臂', 1, 4.99), true);
  assert.equal(assess('5.9.5.a', 6, '左上臂', 1, 0.5), true);
  assert.equal(assess('5.9.5.a', 6, '左小腿', 2, 0.75), true);
  assert.equal(assess('5.9.5.a', 6, '左手掌', 1, 0.5), true);
  assert.notEqual(assess('5.9.5.a', 6, '左上臂', 1, 0.49), true);
  assert.equal(assess('5.10.5.b', 6, '左手掌', 1, 0.5), true);
  assert.equal(assess('5.10.5.b', 6, '左手掌', 2, 0.75), true);
  assert.notEqual(assess('5.10.5.b', 6, '左手掌', 1, 0.49), true);
  assert.notEqual(assess('5.10.5.b', 6, '左小腿', 2, 0.75), true);
  assert.notEqual(assess('5.10.5.b', 6, '左手掌和左小腿', 2, 0.75), true);
});

test('the high-grade cumulative limb wound-length threshold uses injury standard 6.18', () => {
  const assess = (age, length, site = '左上臂') => {
    const description = `本次事故后受伤时年龄${age}周岁，${site}皮肤多处创口累计长度${length}厘米。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.9.3.m').conditionLogic, facts).met;
  };
  const assessSingle = (age, length) => {
    const description = `本次事故后受伤时年龄${age}周岁，左上臂皮肤创口长${length}厘米。`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.9.3.m').conditionLogic, facts).met;
  };

  assert.equal(assessSingle(6, 22.5), true);
  assert.notEqual(assessSingle(6, 22.49), true);
  assert.equal(assess(6, 22.5), true);
  assert.equal(assess(7, 27), true);
  assert.equal(assess(11, 36), true);
  assert.equal(assess(15, 45), true);
  assert.notEqual(assess(6, 22.49), true);
  assert.notEqual(assess(6, 22.5, '面部'), true);

  const description = '本次事故后，左上臂皮肤多处创口累计长度22.5厘米。';
  const facts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const clause = catalogs.injury.clauses.find(item => item.id === '5.9.3.m');
  const total = facts.find(fact => fact.field === 'aggregate_wound_length_cm');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, null);
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, evidence: total.evidence, reasoning: '模型认为累计长度达到阈值。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: total.evidence, factIds: [total.id], met: true }],
  }] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'high-grade-limb-length-age-review', model: 'test-model', extractedFacts: facts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
});

test('facial wound-length thresholds use injury standard 6.18', () => {
  const assess = (id, age, wound, site = '面部') => {
    const description = `本次事故后受伤时年龄${age}周岁，${site}${wound}`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.injury.clauses.find(item => item.id === id);
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.2.3.a', 6, '皮肤创口长3厘米。'), true);
  assert.notEqual(assess('5.2.3.a', 6, '皮肤创口长2.99厘米。'), true);
  assert.equal(assess('5.2.3.a', 7, '多处皮肤创口累计长度6厘米。'), true);
  assert.equal(assess('5.2.4.a', 6, '皮肤创口长2.25厘米。'), true);
  assert.notEqual(assess('5.2.4.a', 6, '皮肤创口长2.24厘米。'), true);
  assert.equal(assess('5.2.4.a', 6, '瘢痕长2.25厘米。'), true);
  assert.notEqual(assess('5.2.4.a', 6, '瘢痕长2.24厘米。'), true);
  assert.equal(assess('5.2.4.a', 7, '多处皮肤创口累计长度3.6厘米。'), true);
  assert.notEqual(assess('5.2.4.a', 6, '皮肤创口长2.25厘米。', '左上臂'), true);

  const clause = catalogs.injury.clauses.find(item => item.id === '5.2.2.a');
  const centerCue = '面部条状瘢痕（50%以上位于中心区）';
  const assessScar = (age, finding, includeAge = true) => {
    const description = `本次事故后${includeAge ? `受伤时年龄${age}周岁，` : ''}${finding}`;
    const facts = includeAge ? [ageFact(age)] : [];
    if (description.includes(centerCue)) facts.push({ id: 'F-center', eventId: 'E1', field: 'clinical_finding',
      value: centerCue, certainty: 'reported', source: 'description', evidence: centerCue });
    const normalized = normalizeExtractedFacts({ facts, missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(clause.conditionLogic, normalized).met;
  };
  const single = (length, central = true) => `${central ? `${centerCue}` : '面部条状瘢痕'}长${length}cm。`;
  const cumulative = length => `${centerCue}两处分别长${length / 2}cm、${length / 2}cm。`;

  assert.equal(assessScar(6, single(5)), true);
  assert.notEqual(assessScar(6, single(4.99)), true);
  assert.equal(assessScar(7, single(6)), true);
  assert.notEqual(assessScar(7, single(5.99)), true);
  assert.equal(assessScar(11, single(8)), true);
  assert.notEqual(assessScar(11, single(7.99)), true);
  assert.equal(assessScar(15, single(10)), true);
  assert.notEqual(assessScar(15, single(9.99)), true);
  assert.notEqual(assessScar(6, single(10, false)), true);
  assert.notEqual(assessScar(6, single(5), false), true);

  const noAgeDescription = `本次事故后${single(5)}`;
  const noAgeFacts = normalizeExtractedFacts({ facts: [{ id: 'F-center', eventId: 'E1', field: 'clinical_finding',
    value: centerCue, certainty: 'reported', source: 'description', evidence: centerCue }], missingMaterials: [],
    conflicts: [], requiresReview: false }, { description: noAgeDescription }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  const modelRaw = { ...providerFixture('injury'), status: 'preliminary', grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, evidence: noAgeDescription, reasoning: '模型按面部瘢痕阈值判断。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: noAgeDescription,
      factIds: noAgeFacts.map(fact => fact.id), met: true }],
  }] };
  const noAgeResult = normalizeResult(modelRaw, { ...inputs.injury, description: noAgeDescription }, {
    clauses: [clause], requestId: 'facial-linear-scar-no-age', model: 'test-model', extractedFacts: noAgeFacts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.notEqual(noAgeResult.grade, clause.grade);
  assert.notEqual(noAgeResult.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.ok(noAgeResult.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));

  assert.equal(assessScar(6, cumulative(7.5)), true);
  assert.notEqual(assessScar(6, cumulative(7.49)), true);
  assert.equal(assessScar(7, cumulative(9)), true);
  assert.notEqual(assessScar(7, cumulative(8.99)), true);
  assert.equal(assessScar(11, cumulative(12)), true);
  assert.notEqual(assessScar(11, cumulative(11.99)), true);
  assert.equal(assessScar(15, cumulative(15)), true);
  assert.notEqual(assessScar(15, cumulative(14.99)), true);
});

test('external-genital skin wound and scar lengths use injury standard 6.18', () => {
  const assess = (id, age, evidence, includeAge = true) => {
    const description = `${includeAge ? `本次事故后受伤时年龄${age}周岁，` : '本次事故后'}${evidence}`;
    const sourceFacts = includeAge ? [ageFact(age)] : [];
    const facts = normalizeExtractedFacts({ facts: sourceFacts, missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };

  assert.equal(assess('5.8.4.f', 6, '女性外阴皮肤创口长2cm。'), true);
  assert.notEqual(assess('5.8.4.f', 6, '女性外阴皮肤创口长1.99cm。'), true);
  assert.equal(assess('5.8.4.f', 7, '女性外阴皮肤创口长2.4cm。'), true);
  assert.equal(assess('5.8.4.f', 15, '女性外阴皮肤创口长4cm。'), true);
  assert.notEqual(assess('5.8.4.f', 6, '女性外阴皮肤创口长2cm。', false), true);
  assert.equal(assess('5.8.4.f', 6, '女性外阴两处皮肤创口累计长度2cm。'), true);
  assert.notEqual(assess('5.8.4.f', 6, '女性外阴两处皮肤创口累计长度1.99cm。'), true);
  assert.equal(assess('5.8.4.f', 6, '女性外阴两条皮肤瘢痕累计长度2cm。'), true);
  assert.notEqual(assess('5.8.4.f', 6, '女性外阴两条皮肤瘢痕累计长度1.99cm。'), true);

  assert.equal(assess('5.8.4.h', 6, '阴茎皮肤创口长1cm。'), true);
  assert.notEqual(assess('5.8.4.h', 6, '阴茎皮肤创口长0.99cm。'), true);
  assert.equal(assess('5.8.4.h', 7, '阴茎皮肤瘢痕长1.2cm。'), true);
  assert.equal(assess('5.8.4.h', 15, '阴茎皮肤瘢痕长2cm。'), true);
  assert.notEqual(assess('5.8.4.h', 6, '阴茎两处皮肤创口累计长度1cm。'), true);
  const avulsionClause = catalogs.injury.clauses.find(item => item.id === '5.8.4.h');
  assert.equal(evaluateConditionLogic(avulsionClause.conditionLogic, [{ id: 'P1', eventId: 'E1',
    field: 'clinical_finding', value: '阴茎撕脱伤', certainty: 'reported', source: 'description',
    verification: 'quoted', evidence: '阴茎撕脱伤' }]).met, true);

  assert.equal(assess('5.8.4.i', 6, '阴囊皮肤创口长2cm。'), true);
  assert.notEqual(assess('5.8.4.i', 6, '阴囊皮肤创口长1.99cm。'), true);
  assert.equal(assess('5.8.4.i', 7, '阴囊皮肤瘢痕长2.4cm。'), true);
  assert.equal(assess('5.8.4.i', 15, '阴囊皮肤瘢痕长4cm。'), true);
  assert.equal(assess('5.8.4.i', 6, '阴囊两处皮肤创口累计长度2cm。'), true);
  assert.equal(assess('5.8.4.i', 6, '阴囊两条皮肤瘢痕累计长度2cm。'), true);
  const penetratingClause = catalogs.injury.clauses.find(item => item.id === '5.8.4.i');
  assert.equal(evaluateConditionLogic(penetratingClause.conditionLogic, [{ id: 'S1', eventId: 'E1',
    field: 'clinical_finding', value: '阴囊壁贯通创', certainty: 'reported', source: 'description',
    verification: 'quoted', evidence: '阴囊壁贯通创' }]).met, true);
});

test('explicit cumulative scar length stays aggregate and cannot prove a single wound length', () => {
  const description = '本次事故后受伤时年龄6周岁，女性外阴两条皮肤瘢痕累计长度2cm。';
  const facts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [], requiresReview: false },
    { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const measurements = facts.filter(fact => ['wound_length_cm', 'aggregate_wound_length_cm'].includes(fact.field));
  assert.deepEqual(measurements.map(fact => fact.field), ['aggregate_wound_length_cm']);
  assert.equal(measurements[0].value, 2);
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.8.4.f').conditionLogic,
    facts).met, true);

  const incomplete = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [],
    requiresReview: false }, { description: description.replace('2cm', '1.99cm') }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  assert.notEqual(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.8.4.f').conditionLogic,
    incomplete).met, true);

  const earDescription = '本次事故后受伤时年龄6周岁，耳廓多个瘢痕累计长度3cm。';
  const earFacts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [],
    requiresReview: false }, { description: earDescription }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.2.4.l').conditionLogic,
    earFacts).met, true);

  const generalDescription = '本次事故后受伤时年龄6周岁，多个瘢痕累计长度7.5cm。';
  const generalFacts = normalizeExtractedFacts({ facts: [ageFact(6)], missingMaterials: [], conflicts: [],
    requiresReview: false }, { description: generalDescription }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === '5.11.3.b').conditionLogic,
    generalFacts).met, true);
});

test('facial scratch length thresholds use injury standard 6.18 and require age when the result can change', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.2.5.c');
  const assess = (age, length, includeAge = true) => {
    const description = `本次事故后${includeAge ? `受伤时年龄${age}周岁，` : ''}面部划伤长${length}cm。`;
    const sourceFacts = includeAge ? [ageFact(age)] : [];
    const facts = normalizeExtractedFacts({ facts: sourceFacts, missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess(6, 2), true);
  assert.notEqual(assess(6, 1.99), true);
  assert.equal(assess(7, 2.4), true);
  assert.notEqual(assess(7, 2.39), true);
  assert.equal(assess(11, 3.2), true);
  assert.notEqual(assess(11, 3.19), true);
  assert.equal(assess(15, 4), true);
  assert.notEqual(assess(15, 3.99), true);
  assert.notEqual(assess(6, 2, false), true);
});

test('injury 6.18 length and area thresholds cannot be supported by unstructured conclusion facts', () => {
  const unsafe = [];
  for (const clause of catalogs.injury.clauses) {
    if (clause.conditionLogic?.ageAdjustment !== 'injury_standard_6_18') continue;
    const walk = node => {
      if (!node) return;
      if (node.op === 'condition' && node.factMatch?.field === 'clinical_finding'
        && /\d+(?:\.\d+)?\s*(?:cm2|cm²|平方厘米|厘米|cm)/u.test(`${node.sourceText || ''} ${node.conditionText || ''}`)) {
        unsafe.push(`${clause.id}: ${node.conditionText || node.sourceText}`);
      }
      for (const child of node.children || []) walk(child);
    };
    walk(clause.conditionLogic.logic);
  }
  assert.deepEqual(unsafe, []);
});

test('disability 6.11 block-scar areas use verified injury and assessment ages', () => {
  const assess = (id, age, finding, includeAge = true) => {
    const description = `本次事故后${includeAge ? `受伤时年龄${age}周岁，评残时年龄${age}周岁，` : ''}${finding}`;
    const sourceFacts = includeAge ? [ageFact(age), assessmentAgeFact(age)] : [];
    const facts = normalizeExtractedFacts({ facts: sourceFacts, missingMaterials: [],
      conflicts: [], requiresReview: false }, { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.disability.clauses.find(item => item.id === id);
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.8.2.5', 6, '面部中心区块状增生性瘢痕单块面积3.5cm2。'), true);
  assert.notEqual(assess('5.8.2.5', 6, '面部中心区块状增生性瘢痕单块面积3.49cm2。'), true);
  assert.equal(assess('5.8.2.5', 6, '面部块状增生性瘢痕累计面积7.5cm2。'), true);
  assert.equal(assess('5.8.2.5', 6, '面部中心区块状增生性瘢痕多块累计面积4.5cm2。'), true);
  assert.notEqual(assess('5.8.2.5', 6, '面部中心区块状增生性瘢痕多块累计面积4.49cm2。'), true);
  assert.equal(assess('5.9.2.5', 6, '面部块状瘢痕单块面积3.5cm2。'), true);
  assert.notEqual(assess('5.9.2.5', 6, '面部块状瘢痕单块面积3.49cm2。'), true);
  assert.equal(assess('5.9.2.5', 6, '面部多块块状瘢痕累计面积4.5cm2。'), true);
  assert.equal(assess('5.10.2.5', 7, '面部块状瘢痕单块面积2.4cm2。'), true);
  assert.notEqual(assess('5.10.2.5', 7, '面部块状瘢痕单块面积2.39cm2。'), true);
  assert.equal(assess('5.10.2.5', 7, '面部多块块状瘢痕累计面积4cm2。'), true);
  assert.notEqual(assess('5.10.2.5', 7, '面部多块块状瘢痕累计面积3.99cm2。'), true);
  assert.equal(assess('5.10.2.5', 15, '面部块状瘢痕单块面积3cm2。'), true);
  assert.notEqual(assess('5.9.2.5', 6, '面部块状瘢痕单块面积3.5cm2。', false), true);

  const unstructured = [];
  for (const id of ['5.8.2.5', '5.9.2.5', '5.10.2.5']) {
    const walk = node => {
      if (node.op === 'condition' && node.factMatch?.field === 'clinical_finding'
        && /\d+(?:\.\d+)?\s*(?:cm2|cm²|平方厘米)/u.test(`${node.sourceText || ''} ${node.conditionText || ''}`)) {
        unstructured.push(`${id}: ${node.conditionText || node.sourceText}`);
      }
      for (const child of node.children || []) walk(child);
    };
    walk(catalogs.disability.clauses.find(item => item.id === id).conditionLogic.logic);
  }
  assert.deepEqual(unstructured, []);
});

test('disability 6.11 small facial scar areas use age-scaled cumulative surface measurements', () => {
  const assess = (id, age, area, includeAge = true) => {
    const description = `本次事故后${includeAge ? `受伤时年龄${age}周岁，评残时年龄${age}周岁，` : ''}面部片状细小瘢痕累计面积${area}cm2。`;
    const sourceFacts = includeAge ? [ageFact(age), assessmentAgeFact(age)] : [];
    const facts = normalizeExtractedFacts({ facts: sourceFacts, missingMaterials: [], conflicts: [],
      requiresReview: false }, { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.disability.clauses.find(item => item.id === id);
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.8.2.6', 6, 50), true);
  assert.notEqual(assess('5.8.2.6', 6, 49.99), true);
  assert.equal(assess('5.9.2.6', 7, 24), true);
  assert.notEqual(assess('5.9.2.6', 7, 23.99), true);
  assert.equal(assess('5.10.2.6', 14, 8), true);
  assert.notEqual(assess('5.10.2.6', 14, 7.99), true);
  assert.notEqual(assess('5.9.2.6', 6, 15, false), true);

  const unstructuredScarBranches = [];
  for (const id of ['5.8.2.6', '5.9.2.6', '5.10.2.6']) {
    const walk = node => {
      if (node.op === 'condition' && node.factMatch?.field === 'clinical_finding'
        && /细小瘢痕/u.test(`${node.sourceText || ''} ${node.conditionText || ''}`)) {
        unstructuredScarBranches.push(`${id}: ${node.conditionText || node.sourceText}`);
      }
      for (const child of node.children || []) walk(child);
    };
    walk(catalogs.disability.clauses.find(item => item.id === id).conditionLogic.logic);
  }
  assert.deepEqual(unstructuredScarBranches, []);
});

test('disability 6.11 linear-scar width and age-scaled lengths remain separate conditions', () => {
  const metrics = ({ width, total, center }) => [
    ...(width === undefined ? [] : [{ id: 'W', eventId: 'E1', field: 'facial_scar_width_cm', value: width,
      certainty: 'reported', source: 'description', evidence: `面部中心区条状瘢痕宽度${width}cm`, verification: 'quoted' }]),
    ...(total === undefined ? [] : [{ id: 'L', eventId: 'E1', field: 'aggregate_facial_scar_length_cm', value: total,
      certainty: 'reported', source: 'description', evidence: `面部中心区条状瘢痕累计长度${total}cm`, verification: 'quoted' }]),
    ...(center === undefined ? [] : [{ id: 'C', eventId: 'E1', field: 'facial_center_scar_length_cm', value: center,
      certainty: 'reported', source: 'description', evidence: `面部中心区条状瘢痕长度${center}cm`, verification: 'quoted' }]),
  ];
  const assess = (id, age, values, includeAge = true) => {
    const ages = includeAge ? [ageFact(age), assessmentAgeFact(age)] : [];
    const clause = catalogs.disability.clauses.find(item => item.id === id);
    return evaluateConditionLogic(clause.conditionLogic, [...ages, ...metrics(values)]).met;
  };

  assert.equal(assess('5.6.2.2', 6, { width: 0.3, total: 10 }), true);
  assert.notEqual(assess('5.6.2.2', 6, { width: 0.29, total: 10 }), true);
  assert.equal(assess('5.7.2.1', 7, { width: 0.3, total: 12 }), true);
  assert.notEqual(assess('5.7.2.1', 7, { width: 0.29, total: 12 }), true);
  assert.equal(assess('5.8.2.4', 6, { total: 15 }), true);
  assert.equal(assess('5.8.2.4', 6, { width: 0.2, center: 7.5 }), true);
  assert.equal(assess('5.9.2.4', 6, { width: 0.2, total: 5, center: 2.5 }), true);
  assert.notEqual(assess('5.9.2.4', 6, { width: 0.2, total: 5 }), true);
  assert.equal(assess('5.10.2.4', 6, { total: 5 }), true);
  assert.notEqual(assess('5.6.2.2', 6, { width: 0.15, total: 10 }, false), true);

  const unstructured = [];
  for (const id of ['5.6.2.2', '5.7.2.1', '5.8.2.4', '5.9.2.4', '5.10.2.4']) {
    const walk = node => {
      if (node.op === 'condition' && node.factMatch?.field === 'clinical_finding'
        && /\d+(?:\.\d+)?\s*(?:厘米|cm)/u.test(`${node.sourceText || ''} ${node.conditionText || ''}`)) {
        unstructured.push(`${id}: ${node.conditionText || node.sourceText}`);
      }
      for (const child of node.children || []) walk(child);
    };
    walk(catalogs.disability.clauses.find(item => item.id === id).conditionLogic.logic);
  }
  assert.deepEqual(unstructured, []);
});

test('neck wound and scratch length thresholds use injury standard 6.18', () => {
  const assess = (id, age, evidence) => {
    const description = `本次事故后受伤时年龄${age}周岁，${evidence}`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };

  assert.equal(assess('5.5.3.a', 6, '颈前部皮肤创口长5厘米。'), true);
  assert.equal(assess('5.5.3.a', 7, '颈前部多处创口累计长度9.6厘米。'), true);
  assert.notEqual(assess('5.5.3.a', 6, '颈前部皮肤创口长4.99厘米。'), true);
  assert.equal(assess('5.5.4.a', 6, '颈前部皮肤创口长2.5厘米。'), true);
  assert.equal(assess('5.5.4.a', 7, '颈前部多处创口累计长度4.8厘米。'), true);
  assert.notEqual(assess('5.5.4.a', 6, '颈前部皮肤创口长2.49厘米。'), true);
  assert.equal(assess('5.5.5.a', 6, '颈部皮肤创口长0.5厘米。'), true);
  assert.equal(assess('5.5.5.d', 6, '颈部皮肤划伤长2.5厘米。'), true);
  assert.notEqual(assess('5.5.4.a', 6, '左上臂皮肤创口长2.5厘米。'), true);
});

test('conditional cheek, lip and auricle wound-length thresholds use injury standard 6.18', () => {
  const assess = (id, age, injury) => {
    const description = `本次事故后受伤时年龄${age}周岁，${injury}`;
    const facts = normalizeExtractedFacts({ facts: [ageFact(age)], missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };

  assert.equal(assess('5.2.4.b', 6, '右面颊贯通创，皮肤创口长0.5厘米。'), true);
  assert.notEqual(assess('5.2.4.b', 6, '右面颊贯通创，皮肤创口长0.49厘米。'), true);
  assert.equal(assess('5.2.4.c', 6, '上唇全层裂创，皮肤创口长0.5厘米。'), true);
  assert.notEqual(assess('5.2.4.c', 6, '上唇全层裂创，皮肤创口长0.49厘米。'), true);
  assert.equal(assess('5.2.4.l', 6, '右耳廓皮肤2处创口累计长度3厘米。'), true);
  assert.notEqual(assess('5.2.4.l', 6, '右耳廓皮肤2处创口累计长度2.99厘米。'), true);
});

test('neck scar-area thresholds use source-measured scar areas and injury standard 6.18', () => {
  const assess = (id, age, evidence) => {
    const description = `本次事故后受伤时年龄${age}周岁，${evidence}`;
    const sourceFacts = [ageFact(age)];
    if (id === '5.5.2.i') sourceFacts.push({ id: 'F-hypertrophic', eventId: 'E1', field: 'clinical_finding',
      value: '颈前三角区增生瘢痕', certainty: 'reported', source: 'description', evidence: '颈前三角区增生瘢痕' });
    const facts = normalizeExtractedFacts({ facts: sourceFacts, missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };

  assert.equal(assess('5.5.2.i', 6, '颈前三角区增生瘢痕面积累计15平方厘米。'), true);
  assert.equal(assess('5.5.3.b', 6, '颈前三角区瘢痕单块面积5平方厘米。'), true);
  assert.equal(assess('5.5.3.b', 7, '颈前三角区两块瘢痕面积累计7.2平方厘米。'), true);
  assert.equal(assess('5.5.4.b', 6, '颈前部瘢痕单块面积2平方厘米。'), true);
  assert.equal(assess('5.5.4.b', 7, '颈前部两块瘢痕面积累计3.6平方厘米。'), true);
  assert.notEqual(assess('5.5.4.b', 6, '颈前部瘢痕单块面积1.99平方厘米。'), true);
  assert.notEqual(assess('5.5.4.b', 6, '颈前部瘢痕单块面积1至3平方厘米。'), true);
  assert.notEqual(assess('5.5.4.b', 6, '面部瘢痕单块面积2平方厘米。'), true);
  const ambiguousSites = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: '本次事故后颈前部和面部瘢痕单块面积2平方厘米。' }).facts;
  assert.equal(ambiguousSites.some(fact => fact.field === 'surface_scar_area_cm2'), false);
  const repeatedSameSite = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: '本次事故后颈前部瘢痕，颈前部单块面积2平方厘米。' }).facts;
  assert.ok(repeatedSameSite.some(fact => fact.field === 'surface_scar_area_cm2' && fact.value === 2));

  const noAgeDescription = '本次事故后颈前部瘢痕单块面积2平方厘米。';
  const noAgeFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: noAgeDescription }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const clause = catalogs.injury.clauses.find(item => item.id === '5.5.4.b');
  const area = noAgeFacts.find(fact => fact.field === 'surface_scar_area_cm2');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, noAgeFacts).met, null);
  const modelClaim = normalizeResult({ ...providerFixture('injury'), grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, evidence: area.evidence, reasoning: '模型认为瘢痕面积达到阈值。', relation: 'supports',
    conditions: [{ condition: clause.text, evidence: area.evidence, factIds: [area.id], met: true }],
  }] }, { ...inputs.injury, description: noAgeDescription }, {
    clauses: [clause], requestId: 'neck-scar-area-age-review', model: 'test-model', extractedFacts: noAgeFacts,
    conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(modelClaim.references.some(reference => reference.id === clause.id && reference.relation === 'supports'), false);
  assert.ok(modelClaim.missingMaterials.some(material => material.includes('受伤时年龄') && material.includes('6.18')));
});

test('facial block-scar area thresholds use injury standard 6.18 without dropping the central-zone condition', () => {
  const assess = (id, age, finding, { centralZone = false } = {}) => {
    const sourceFinding = centralZone ? `面部块状瘢痕（50%以上位于中心区），${finding}` : finding;
    const description = `本次事故后受伤时年龄${age}周岁，${sourceFinding}`;
    const sourceFacts = [ageFact(age)];
    if (centralZone) sourceFacts.push({ id: 'F-center', eventId: 'E1', field: 'clinical_finding',
      value: '面部块状瘢痕（50%以上位于中心区）', certainty: 'reported', source: 'description',
      evidence: '面部块状瘢痕（50%以上位于中心区）' });
    const facts = normalizeExtractedFacts({ facts: sourceFacts, missingMaterials: [], conflicts: [], requiresReview: false },
      { description }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return evaluateConditionLogic(catalogs.injury.clauses.find(item => item.id === id).conditionLogic, facts).met;
  };

  assert.equal(assess('5.2.2.b', 6, '面部块状瘢痕单块面积3平方厘米。', { centralZone: true }), true);
  assert.notEqual(assess('5.2.2.b', 6, '面部块状瘢痕单块面积3平方厘米。'), true);
  assert.equal(assess('5.2.2.b', 6, '面部块状瘢痕两块以上面积累计5平方厘米。', { centralZone: true }), true);
  assert.equal(assess('5.2.3.b', 6, '面部块状瘢痕单块面积2平方厘米。'), true);
  assert.equal(assess('5.2.3.b', 7, '面部块状瘢痕多块面积累计4.2平方厘米。'), true);
  assert.equal(assess('5.2.4.d', 6, '面部块状瘢痕单块面积1.5平方厘米。'), true);
  assert.equal(assess('5.2.4.d', 7, '面部块状瘢痕多块面积累计3平方厘米。'), true);
  assert.notEqual(assess('5.2.4.d', 6, '面部线状瘢痕单块面积1.5平方厘米。'), true);
});
