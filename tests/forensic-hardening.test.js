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
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.notEqual(reference?.relation, 'supports');
});

test('digit-separation descriptions surface a system-review warning without suppressing a supported head clause', () => {
  const headEvidence = 'CT明确记载左颅骨凹陷性骨折';
  const description = `合成资料，非真实病例。${headEvidence}。手术记录示左手示指近指间关节囊破裂、仅掌尺侧皮肤相连；中指近节指骨骨折、远端仅在指蹼处皮肤相连。`;
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.3.c');
  const fact = { id: 'F1', eventId: 'E1', field: 'injury_type', value: 'skull_depressed_fracture',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: headEvidence };
  const raw = { ...providerFixture('injury'), status: 'preliminary', grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, relation: 'supports', evidence: headEvidence, reasoning: '',
    conditions: [{ condition: clause.text, evidence: headEvidence, factIds: ['F1'], met: true }],
  }] };
  const assess = value => normalizeResult(raw, { ...inputs.injury, description: value }, {
    clauses: [clause], requestId: 'digit-separation-system-review', model: 'test-model',
    extractedFacts: [fact], conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  const result = assess(description);

  assert.equal(result.grade, clause.grade);
  assert.equal(result.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.ok(result.warnings.some(warning => warning.includes('系统未能可靠归一每指的离断状态和关节平面')));
  assert.equal(assess(`合成资料，非真实病例。${headEvidence}。左手中指中节指骨骨折。`)
    .warnings.some(warning => warning.includes('系统未能可靠归一每指的离断状态和关节平面')), false);
  assert.equal(assess(`合成资料，非真实病例。${headEvidence}。既往史：左手示指离断。`)
    .warnings.some(warning => warning.includes('系统未能可靠归一每指的离断状态和关节平面')), false);
});

test('ocular-content evisceration alone cannot satisfy whole-eye loss', () => {
  const description = '合成资料，非真实病例。2015年9月22日行右眼内容物剜除及羟基磷灰石义眼台植入。';
  const clause = catalogs.injury.clauses.find(item => item.id === '5.2.2.d');
  const extracted = normalizeExtractedFacts(emptyExtraction, { description });
  const unsupportedModelFact = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '一侧眼球缺失',
    certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '行右眼内容物剜除及羟基磷灰石义眼台植入' };
  const raw = { ...providerFixture('injury'), status: 'preliminary', grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, relation: 'supports', evidence: unsupportedModelFact.evidence, reasoning: '',
    conditions: [{ condition: clause.text, evidence: unsupportedModelFact.evidence, factIds: ['F1'], met: true }],
  }] };
  const result = normalizeResult(raw, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'evisceration-is-not-globe-loss', model: 'test-model',
    extractedFacts: extracted.facts.map(fact => ({ ...fact, verification: 'quoted' })),
    conflicts: extracted.conflicts, requiresReview: extracted.requiresReview,
    factMissingMaterials: extracted.missingMaterials, extractionWarnings: extracted.warnings,
  });

  assert.equal(extracted.facts.some(fact => fact.field === 'clinical_finding' && fact.value === '一侧眼球缺失'), false);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [unsupportedModelFact]).met, true);
  assert.equal(result.grade, null);
  assert.notEqual(result.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.ok(result.warnings.some(warning => warning.includes('眼内容物剜除') && warning.includes('不自动认定')));

  const explicitGlobeStatus = normalizeExtractedFacts(emptyExtraction, { description:
    `${description}术后检查明确记载右眼球缺失。` });
  assert.ok(explicitGlobeStatus.facts.some(fact => fact.field === 'clinical_finding' && fact.value === '一侧眼球缺失'));
});

test('facial linear scar clause checks width, total length, and central-zone length independently', () => {
  const description = '本次事故后面部条状瘢痕形成，宽度0.3cm；面部条状瘢痕累计长度8.0cm；面部中心区条状瘢痕长度4.0cm。受伤时年龄20周岁，评残时年龄21周岁。';
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.2.3');
  const extraction = normalizeExtractedFacts({ facts: [
    { id: 'F0', eventId: 'E1', field: 'clinical_finding', value: '面部条状瘢痕形成', certainty: 'reported',
      source: 'description', evidence: '面部条状瘢痕形成' },
    { id: 'W1', eventId: 'E1', field: 'facial_scar_width_cm', value: 0.3, certainty: 'reported',
      source: 'description', evidence: '面部条状瘢痕形成，宽度0.3cm' },
    { id: 'L1', eventId: 'E1', field: 'aggregate_facial_scar_length_cm', value: 8, certainty: 'reported',
      source: 'description', evidence: '面部条状瘢痕累计长度8.0cm' },
    { id: 'C1', eventId: 'E1', field: 'facial_center_scar_length_cm', value: 4, certainty: 'reported',
      source: 'description', evidence: '面部中心区条状瘢痕长度4.0cm' },
    { id: 'A1', eventId: 'E1', field: 'age_at_injury_years', value: 20, certainty: 'reported',
      source: 'description', evidence: '受伤时年龄20周岁' },
    { id: 'A2', eventId: 'E1', field: 'age_at_assessment_years', value: 21, certainty: 'reported',
      source: 'description', evidence: '评残时年龄21周岁' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);
  assert.ok(retrieveClauses('disability', '', 0, facts).some(item => item.id === clause.id));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: description, reasoning: '',
      conditions: [{ condition: clause.text, evidence: description, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'facial-linear-scar-complete',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(result.grade, clause.grade);
  assert.ok(result.references.some(reference => reference.id === clause.id && reference.relation === 'supports'));
  assert.equal(result.missingMaterials.some(material => material.includes('补充受伤时及评残时年龄资料')), false);
  const childDescription = description.replace('宽度0.3cm', '宽度0.2cm')
    .replace('累计长度8.0cm', '累计长度3.0cm').replace('长度4.0cm', '长度1.5cm')
    .replace('20周岁', '6周岁').replace('21周岁', '6周岁');
  const childExtraction = normalizeExtractedFacts({ facts: [
    { id: 'F0', eventId: 'E1', field: 'clinical_finding', value: '面部条状瘢痕形成', certainty: 'reported',
      source: 'description', evidence: '面部条状瘢痕形成' },
    { id: 'W1', eventId: 'E1', field: 'facial_scar_width_cm', value: 0.2, certainty: 'reported',
      source: 'description', evidence: '面部条状瘢痕形成，宽度0.2cm' },
    { id: 'L1', eventId: 'E1', field: 'aggregate_facial_scar_length_cm', value: 3, certainty: 'reported',
      source: 'description', evidence: '面部条状瘢痕累计长度3.0cm' },
    { id: 'C1', eventId: 'E1', field: 'facial_center_scar_length_cm', value: 1.5, certainty: 'reported',
      source: 'description', evidence: '面部中心区条状瘢痕长度1.5cm' },
    { id: 'A1', eventId: 'E1', field: 'age_at_injury_years', value: 6, certainty: 'reported',
      source: 'description', evidence: '受伤时年龄6周岁' },
    { id: 'A2', eventId: 'E1', field: 'age_at_assessment_years', value: 6, certainty: 'reported',
      source: 'description', evidence: '评残时年龄6周岁' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description: childDescription });
  const childFacts = childExtraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const childResult = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: childDescription, reasoning: '',
      conditions: [{ condition: clause.text, evidence: childDescription, factIds: childFacts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description: childDescription }, { clauses: [clause], requestId: 'facial-linear-scar-child-review',
    model: 'test-model', extractedFacts: childFacts, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(childResult.grade, clause.grade);
  assert.equal(childResult.missingMaterials.some(material => material.includes('6.11')), false);
  const childWidthBelowStandard = childFacts.map(fact => fact.field === 'facial_scar_width_cm'
    ? { ...fact, value: 0.1, evidence: '面部条状瘢痕形成，宽度0.1cm' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, childWidthBelowStandard).met, true);
  const age14Facts = childFacts.map(fact => {
    if (fact.field === 'facial_scar_width_cm') return { ...fact, value: 0.2, evidence: '面部条状瘢痕形成，宽度0.2cm' };
    if (fact.field === 'aggregate_facial_scar_length_cm') return { ...fact, value: 4.8, evidence: '面部条状瘢痕累计长度4.8cm' };
    if (fact.field === 'facial_center_scar_length_cm') return { ...fact, value: 2.4, evidence: '面部中心区条状瘢痕长度2.4cm' };
    if (['age_at_injury_years', 'age_at_assessment_years'].includes(fact.field)) {
      const evidence = fact.field === 'age_at_injury_years' ? '受伤时年龄14周岁' : '评残时年龄14周岁';
      return { ...fact, value: 14, evidence };
    }
    return fact;
  });
  assert.equal(evaluateConditionLogic(clause.conditionLogic, age14Facts).met, true);
  const age7BelowBoundaryFacts = age14Facts.map(fact => {
    if (fact.field === 'facial_scar_width_cm') return { ...fact, value: 0.15, evidence: '面部条状瘢痕形成，宽度0.15cm' };
    if (fact.field === 'aggregate_facial_scar_length_cm') return { ...fact, value: 4.79, evidence: '面部条状瘢痕累计长度4.79cm' };
    if (fact.field === 'facial_center_scar_length_cm') return { ...fact, value: 2.39, evidence: '面部中心区条状瘢痕长度2.39cm' };
    if (['age_at_injury_years', 'age_at_assessment_years'].includes(fact.field)) {
      const evidence = fact.field === 'age_at_injury_years' ? '受伤时年龄7周岁' : '评残时年龄7周岁';
      return { ...fact, value: 7, evidence };
    }
    return fact;
  });
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, age7BelowBoundaryFacts).met, true);
  const ageBandConflictFacts = childFacts.map(fact => fact.field === 'age_at_assessment_years'
    ? { ...fact, value: 7, evidence: '评残时年龄7周岁' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, ageBandConflictFacts).met, true);
  const incompleteResult = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: description, reasoning: '',
      conditions: [{ condition: clause.text, evidence: description, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'facial-linear-scar-missing-center-length',
    model: 'test-model', extractedFacts: facts.filter(fact => fact.field !== 'facial_center_scar_length_cm'),
    conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(incompleteResult.grade, null);
  assert.notEqual(incompleteResult.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  const boundaryFacts = facts.map(fact => {
    if (fact.field === 'facial_scar_width_cm') return { ...fact, value: 0.2, evidence: '面部条状瘢痕形成，宽度0.2cm' };
    if (fact.field === 'aggregate_facial_scar_length_cm') return { ...fact, value: 6, evidence: '面部条状瘢痕累计长度6.0cm' };
    if (fact.field === 'facial_center_scar_length_cm') return { ...fact, value: 3, evidence: '面部中心区条状瘢痕长度3.0cm' };
    return fact;
  });
  assert.equal(evaluateConditionLogic(clause.conditionLogic, boundaryFacts).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.filter(fact => !['age_at_injury_years', 'age_at_assessment_years'].includes(fact.field))).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.filter(fact => fact.field !== 'facial_center_scar_length_cm')).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'facial_scar_width_cm'
      ? { ...fact, value: 0.19, evidence: '面部条状瘢痕宽度0.19cm' } : fact)).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'aggregate_facial_scar_length_cm'
      ? { ...fact, value: 5.99, evidence: '面部条状瘢痕累计长度5.99cm' } : fact)).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'facial_center_scar_length_cm'
      ? { ...fact, value: 2.99, evidence: '面部中心区条状瘢痕长度2.99cm' } : fact)).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'facial_center_scar_length_cm' ? { ...fact, eventId: 'E2' } : fact)).met, true);
});

test('one quoted composite vertebral-process conclusion cannot independently prove count and functional effect', () => {
  const conclusion = '四处以上横突、棘突或者椎弓根骨折，影响功能';
  const description = `合成资料，非真实病例。病历结论记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.6.3');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'vertebral-process-composite-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /骨折处数及其与功能受影响的同事件关联/u);
});

test('one quoted composite knee conclusion cannot independently prove injuries, surgery, and residual function impact', () => {
  const conclusion = '一侧膝关节交叉韧带、半月板伴侧副韧带撕裂伤经手术治疗后，影响功能';
  const description = `合成资料，非真实病例。出院诊断记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.6.6');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'knee-composite-conclusion-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /交叉韧带损伤、半月板损伤及侧副韧带撕裂/u);
  assert.match(reference?.reasoning || '', /手术记录和稳定后的功能评估/u);
});

test('one quoted composite eyelid conclusion cannot independently prove anatomy and same-eye vision loss', () => {
  const conclusion = '一侧眼睑轻度畸形（或者眼睑下垂，遮盖部分瞳孔）合并该眼中度视力损害';
  const description = `合成资料，非真实病例。鉴定意见记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.9.2.15');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'eyelid-composite-conclusion-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /眼睑侧别和解剖表现/u);
  assert.match(reference?.reasoning || '', /矫正视功能客观检查/u);
  assert.match(reference?.reasoning || '', /伤前资料/u);
});

test('one quoted composite osteomyelitis conclusion cannot independently prove fracture, sequestrum, and duration', () => {
  const conclusion = '四肢长骨开放性骨折并发慢性骨髓炎、大块死骨形成，长期不愈（1年以上）';
  const description = `合成资料，非真实病例。出院诊断记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.8.6.5');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'osteomyelitis-composite-conclusion-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /开放性骨折、并发慢性骨髓炎、大块死骨形成及持续超过1年不愈/u);
});

test('one quoted composite hand conclusion cannot independently prove finger loss and metacarpal defect', () => {
  const conclusion = '一手小指完全缺失并第5掌骨部分缺损';
  const description = `合成资料，非真实病例。鉴定意见记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.6.15');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'hand-composite-conclusion-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /同一手的侧别、第五掌骨部分缺损以及小指完全缺失/u);
});

test('one quoted composite jaw conclusion cannot independently prove fracture, treatment, and residual dysfunction', () => {
  const conclusion = '颌骨骨折，经牵引或者固定治疗后遗留功能障碍';
  const description = `合成资料，非真实病例。鉴定意见记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.9.2.22');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'jaw-composite-conclusion-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /颌骨骨折/u);
  assert.match(reference?.reasoning || '', /针对本次骨折的牵引或固定治疗/u);
  assert.match(reference?.reasoning || '', /治疗后遗留的功能障碍/u);
});

test('one quoted composite nerve conclusion cannot independently prove nerve level and residual muscle grade', () => {
  const conclusion = '四肢重要神经损伤（上肢肘关节以上，下肢膝关节以上），遗留相应肌群肌力3级以下';
  const description = `合成资料，非真实病例。鉴定意见记载“${conclusion}”。`;
  const clause = catalogs.disability.clauses.find(item => item.id === '5.9.1.7');
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'F1', eventId: 'E1', field: 'clinical_finding',
    value: conclusion, certainty: 'reported', source: 'description', evidence: conclusion }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'nerve-composite-conclusion-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /重要神经损伤及其解剖平面/u);
  assert.match(reference?.reasoning || '', /客观检查确认残留肌力等级达到阈值/u);
});

test('one quoted vertebral surgery conclusion cannot replace level counting and operative linkage', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.8.6.2');
  const conclusion = '三个以上椎体骨折，经手术治疗后';
  const description = `合成资料，非真实病例。本次事故造成${conclusion}。`;
  const facts = [{ id: 'V1', eventId: 'E1', field: 'clinical_finding', value: conclusion,
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: description }];
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: description, reasoning: '',
      conditions: [{ condition: clause.text, evidence: description, factIds: ['V1'], met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'vertebral-count-surgery-composite-alone',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(result.grade, null);
  const reference = result.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'incomplete');
  assert.match(reference?.reasoning || '', /至少3个独立椎体骨折部位及与这些骨折对应的手术治疗/u);
});

test('single-leaf compound organ and function clauses do not grade from one complete conclusion', async t => {
  const cases = [
    { assessmentType: 'injury', id: '5.4.5.a', reason: /眼球损伤和视功能影响/u },
    { assessmentType: 'injury', id: '5.5.2.f', reason: /喉部损伤、遗留发声障碍及其重度程度/u },
    { assessmentType: 'injury', id: '5.9.2.j', reason: /交叉韧带完全断裂及损伤后遗留旋转不稳/u },
    { assessmentType: 'disability', id: '5.9.3.7', reason: /食管损伤及其造成的吞咽功能影响/u },
    { assessmentType: 'disability', id: '5.10.1.6', reason: /重要神经损伤、与其对应的肌群及客观肌力等级/u },
    { assessmentType: 'disability', id: '5.10.3.3', reason: /喉返神经损伤及其功能影响/u },
    { assessmentType: 'disability', id: '5.10.6.1', reason: /齿状突骨折及其造成的功能影响/u },
    { assessmentType: 'disability', id: '5.10.6.14', reason: /重要血管循环障碍、受累肢体与功能后果/u },
  ];

  for (const { assessmentType, id, reason } of cases) {
    await t.test(`${assessmentType} ${id}`, () => {
      const clause = catalogs[assessmentType].clauses.find(item => item.id === id);
      const conclusion = clause.text.replace(/[。；;]$/u, '');
      const description = `合成资料，非真实病例。鉴定意见记载“${conclusion}”。`;
      const facts = [{ id: 'F1', eventId: 'E1', field: 'clinical_finding', value: conclusion,
        certainty: 'reported', source: 'description', verification: 'quoted', evidence: conclusion }];
      const result = normalizeResult({ ...providerFixture(assessmentType), status: 'preliminary', grade: clause.grade,
        facts: [], references: [{ clauseId: id, relation: 'supports', evidence: conclusion, reasoning: '',
          conditions: [{ condition: clause.text, evidence: conclusion, factIds: ['F1'], met: true }] }] },
      { ...inputs[assessmentType], description }, { clauses: [clause], requestId: `single-composite-${id}`,
        model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });

      assert.equal(result.grade, null);
      const reference = result.references.find(item => item.id === id);
      assert.equal(reference?.relation, 'incomplete');
      assert.match(reference?.reasoning || '', reason);
    });
  }
});

test('procedure evidence links to the same mapped organ and rejects another event or side', () => {
  const uterusClause = catalogs.disability.clauses.find(item => item.id === '5.7.5.4');
  const uterusOperation = { id: 'U1', eventId: 'E1', field: 'clinical_finding',
    value: '子宫大部分切除术后', certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '手术记录记载子宫大部分切除术后' };
  const uterusInjury = { id: 'U2', eventId: 'E1', field: 'diagnosis', value: '子宫损伤',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '本次事故导致子宫损伤' };
  assert.equal(evaluateConditionLogic(uterusClause.conditionLogic, [uterusOperation, uterusInjury]).met, true);
  assert.notEqual(evaluateConditionLogic(uterusClause.conditionLogic,
    [uterusOperation, { ...uterusInjury, eventId: 'E2' }]).met, true);
  assert.notEqual(evaluateConditionLogic(uterusClause.conditionLogic,
    [uterusOperation, { ...uterusInjury, value: '肾损伤', evidence: '本次事故导致肾损伤' }]).met, true);

  const testicleClause = catalogs.disability.clauses.find(item => item.id === '5.10.5.4');
  const testicleOperation = { id: 'T1', eventId: 'E1', field: 'clinical_finding',
    value: '睾丸破裂修补术后', certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '本次事故后右侧睾丸破裂修补术后' };
  const rightTesticleInjury = { id: 'T2', eventId: 'E1', field: 'diagnosis', value: '右侧睾丸破裂',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '本次事故导致右侧睾丸破裂' };
  const leftTesticleInjury = { ...rightTesticleInjury, value: '左侧睾丸破裂', evidence: '本次事故导致左侧睾丸破裂' };
  assert.equal(evaluateConditionLogic(testicleClause.conditionLogic,
    [testicleOperation, rightTesticleInjury]).met, true);
  assert.notEqual(evaluateConditionLogic(testicleClause.conditionLogic,
    [testicleOperation, leftTesticleInjury]).met, true);
});

test('surgery after an event requires an explicit causal statement or same-event organ evidence', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.7.4.2');
  const operation = { id: 'K1', eventId: 'E1', field: 'clinical_finding', value: '一侧肾切除术后',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '本次事故后行一侧肾切除术后' };
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [operation]).met, true);
  const unsupported = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: operation.evidence, reasoning: '',
      conditions: [{ condition: clause.text, evidence: operation.evidence, factIds: [operation.id], met: true }] }] },
  { ...inputs.disability, description: `合成资料，非真实病例。${operation.evidence}。` },
  { clauses: [clause], requestId: 'kidney-removal-time-sequence-alone', model: 'test-model',
    extractedFacts: [operation], conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(unsupported.grade, null);
  assert.notEqual(unsupported.references.find(item => item.id === clause.id)?.relation, 'supports');

  const sameEventKidneyInjury = { id: 'K2', eventId: 'E1', field: 'diagnosis', value: '左肾损伤',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '本次事故CT诊断左肾损伤' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [operation, sameEventKidneyInjury]).met, true);

  const explicitlyCausedOperation = { ...operation,
    evidence: '因2025年3月21日本次事故接受一侧肾切除术后' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [explicitlyCausedOperation]).met, true);
  const unrelatedOperation = { ...explicitlyCausedOperation,
    evidence: '因本次事故造成腹部挫伤，本次事故后行一侧肾切除术后' };
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [unrelatedOperation]).met, true);
});

test('mandibular body defect without a fracture cannot satisfy the jaw-fracture clause', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.2.4.t');
  const defect = '下颌骨体缺损';
  const defectDescription = `合成资料，非真实病例。CT示${defect}。`;
  const defectFact = { id: 'M1', eventId: 'E1', field: 'diagnosis', value: defect, certainty: 'reported',
    source: 'description', verification: 'quoted', evidence: `CT示${defect}` };
  const unsupported = normalizeResult({ ...providerFixture('injury'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: defectFact.evidence, reasoning: '',
      conditions: [{ condition: clause.text, evidence: defectFact.evidence, factIds: ['M1'], met: true }] }] },
  { ...inputs.injury, description: defectDescription }, { clauses: [clause], requestId: 'mandibular-defect-is-not-fracture',
    model: 'test-model', extractedFacts: [defectFact], conflicts: [], requiresReview: false, factMissingMaterials: [] });

  assert.equal(unsupported.grade, null);
  assert.notEqual(unsupported.references.find(item => item.id === clause.id)?.relation, 'supports');
  const fracture = { ...defectFact, value: '下颌骨体骨折', evidence: 'CT示下颌骨体骨折' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [fracture]).met, true);
});

test('not nodes preserve unknown and do not merge exclusion facts across events', () => {
  const findNot = node => node.op === 'not' ? node : (node.children || []).map(findNot).find(Boolean);
  const necrosisClause = catalogs.injury.clauses.find(item => item.id === '5.9.3.g');
  const necrosisLogic = { annotation: 'explicit', logic: findNot(necrosisClause.conditionLogic.logic) };
  const necrosis = { id: 'N1', eventId: 'E1', field: 'clinical_finding', value: '股骨头坏死',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '影像诊断股骨头坏死' };
  const noNecrosis = { ...necrosis, certainty: 'excluded', evidence: '影像明确未见股骨头坏死' };
  const uncertainNecrosis = { ...necrosis, certainty: 'uncertain', evidence: '影像考虑股骨头坏死可能' };
  assert.equal(evaluateConditionLogic(necrosisLogic, [necrosis]).met, false);
  assert.equal(evaluateConditionLogic(necrosisLogic, [noNecrosis]).met, true);
  assert.equal(evaluateConditionLogic(necrosisLogic, [uncertainNecrosis]).met, null);
  assert.equal(evaluateConditionLogic(necrosisLogic, []).met, null);

  const coccyxClause = catalogs.injury.clauses.find(item => item.id === '5.9.4.d');
  const coccyxLogic = { annotation: 'explicit', logic: findNot(coccyxClause.conditionLogic.logic) };
  const dislocation = { id: 'C1', eventId: 'E1', field: 'clinical_finding', value: '尾椎脱位',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '影像诊断尾椎脱位' };
  const noFunctionalEffect = { id: 'C2', eventId: 'E1', field: 'clinical_finding', value: '不影响功能',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '评估记载尾椎脱位不影响功能' };
  assert.equal(evaluateConditionLogic(coccyxLogic, [dislocation, noFunctionalEffect]).met, false);
  assert.equal(evaluateConditionLogic(coccyxLogic, [dislocation]).met, null);
  assert.equal(evaluateConditionLogic(coccyxLogic,
    [dislocation, { ...noFunctionalEffect, eventId: 'E2' }]).met, null);
});

test('jaw defect and source-counted missing teeth satisfy separate parts of 5.9.2.23', () => {
  const description = '合成资料，非真实病例。本次事故后CT示左侧上颌骨部分缺损；检查记载7枚牙齿缺失。';
  const clause = catalogs.disability.clauses.find(item => item.id === '5.9.2.23');
  const extraction = normalizeExtractedFacts({ facts: [
    { id: 'J1', eventId: 'E1', field: 'diagnosis', value: '上颌骨部分缺损', certainty: 'reported',
      source: 'description', evidence: 'CT示左侧上颌骨部分缺损' },
    { id: 'D1', eventId: 'E1', field: 'dental_loss_count', value: 7, certainty: 'reported',
      source: 'description', evidence: '检查记载7枚牙齿缺失' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));

  assert.equal(facts.some(fact => fact.field === 'dental_loss_count' && fact.value === 7), true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.filter(fact => fact.field !== 'diagnosis')).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'dental_loss_count'
      ? { ...fact, value: 6, evidence: '检查记载6枚牙齿缺失' } : fact)).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'dental_loss_count' ? { ...fact, eventId: 'E2' } : fact)).met, true);
  const brokenToothDescription = description.replace('牙齿缺失', '牙齿折断');
  const brokenToothFacts = normalizeExtractedFacts({ facts: [
    { id: 'J1', eventId: 'E1', field: 'diagnosis', value: '上颌骨部分缺损', certainty: 'reported',
      source: 'description', evidence: 'CT示左侧上颌骨部分缺损' },
    { id: 'D1', eventId: 'E1', field: 'dental_loss_count', value: 7, certainty: 'reported',
      source: 'description', evidence: '检查记载7枚牙齿折断' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description: brokenToothDescription })
    .facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, brokenToothFacts).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    brokenToothFacts.map(fact => fact.field === 'dental_loss_count' ? { ...fact, certainty: 'uncertain' } : fact)).met, true);
  for (const evidence of ['既往牙齿缺失7枚', '牙冠缺失7枚']) {
    const unsupportedCount = normalizeExtractedFacts({ facts: [{ id: 'D1', eventId: null,
      field: 'dental_loss_count', value: 7, certainty: 'reported', source: 'description', evidence }],
    missingMaterials: [], conflicts: [], requiresReview: false }, { description: `${evidence}。` });
    assert.equal(unsupportedCount.facts.some(fact => fact.field === 'dental_loss_count'), false, evidence);
  }
  const rangedCount = normalizeExtractedFacts({ facts: [{ id: 'D1', eventId: 'E1', field: 'dental_loss_count',
    value: 7, certainty: 'reported', source: 'description', evidence: '检查记载牙齿缺失6至7枚' }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description: '检查记载牙齿缺失6至7枚。' });
  assert.equal(rangedCount.facts.some(fact => fact.field === 'dental_loss_count'), false);
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: description, reasoning: '',
      conditions: [{ condition: clause.text, evidence: description, factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'jaw-defect-seven-teeth',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(result.grade, clause.grade);
  assert.ok(result.references.some(reference => reference.id === clause.id && reference.relation === 'supports'));
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
