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

test('5.1.2.c binds a documented craniotomy decompression and hematoma evacuation as treatment', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.c');
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'diagnosis', value: '颞顶骨粉碎性骨折', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: 'CT示颞顶骨粉碎性骨折' },
    { id: 'F2', eventId: 'E1', field: 'diagnosis', value: '脑疝', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '诊断脑疝' },
    { id: 'F3', eventId: 'E1', field: 'treatment', value: '右侧颞顶部开颅、去骨瓣减压、血肿清除术',
      certainty: 'reported', source: 'description', verification: 'quoted',
      evidence: '本次手术记录：右侧颞顶部开颅、去骨瓣减压、血肿清除术' },
  ];
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);

  const planned = facts.map(fact => fact.id === 'F3' ? { ...fact,
    value: '拟行右侧颞顶部开颅、去骨瓣减压、血肿清除术',
    evidence: '本次手术计划：拟行右侧颞顶部开颅、去骨瓣减压、血肿清除术' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, planned).met, true);

  const otherEvent = facts.map(fact => fact.id === 'F3' ? { ...fact, eventId: 'E2' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, otherEvent).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, facts.filter(fact => fact.id !== 'F2')).met, true);
});

test('5.1.2.m binds completed surgery to the same-event traumatic hydrocephalus diagnosis', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.m');
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '外伤性脑积水', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '本次事故造成外伤性脑积水' },
    { id: 'F2', eventId: 'E1', field: 'treatment', value: '脑室腹腔分流术', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '因外伤性脑积水行脑室腹腔分流术' },
  ];
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);

  const commaSeparatedIndication = facts.map(fact => fact.id === 'F2' ? { ...fact,
    evidence: '因外伤性脑积水，行脑室腹腔分流术' } : fact);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, commaSeparatedIndication).met, true);

  const planned = facts.map(fact => fact.id === 'F2' ? { ...fact,
    value: '拟行脑室腹腔分流术', evidence: '因外伤性脑积水拟行脑室腹腔分流术' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, planned).met, true);

  const otherEvent = facts.map(fact => fact.id === 'F2' ? { ...fact, eventId: 'E2' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, otherEvent).met, true);

  const unrelatedSurgery = facts.map(fact => fact.id === 'F2' ? { ...fact,
    evidence: '因同次事故的脑挫伤行脑室腹腔分流术' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, unrelatedSurgery).met, true);

  const genericAccidentOnly = facts.map(fact => fact.id === 'F2' ? { ...fact,
    evidence: '因本次事故行脑室腹腔分流术' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, genericAccidentOnly).met, true);

  const description = '本次事故造成外伤性脑积水，因外伤性脑积水行脑室腹腔分流术。';
  const normalized = normalizeResult({ ...providerFixture('injury'), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description }, { clauses: [clause],
    requestId: 'traumatic-hydrocephalus-surgery-binding', model: 'test-model', extractedFacts: facts,
    conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(normalized.grade, clause.grade);
  assert.equal(normalized.references.find(reference => reference.id === clause.id)?.relation, 'supports');
});

test('5.12.4.k accepts an explicit same-event need for hardware replacement without inventing a completed operation', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.12.4.k');
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '骨折内固定物损坏', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '检查确认骨折内固定物损坏' },
    { id: 'F2', eventId: 'E1', field: 'clinical_finding', value: '骨折内固定物需要手术更换', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '医师评估骨折内固定物需要手术更换' },
  ];
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);

  const otherEvent = facts.map(fact => fact.id === 'F2' ? { ...fact, eventId: 'E2' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, otherEvent).met, true);

  const uncertain = facts.map(fact => fact.id === 'F2' ? { ...fact, certainty: 'uncertain',
    evidence: '医师考虑骨折内固定物可能需要手术更换' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, uncertain).met, true);

  const prosthesisClause = catalogs.injury.clauses.find(item => item.id === '5.12.4.l');
  const prosthesisFacts = facts.map(fact => ({ ...fact,
    value: fact.value.replaceAll('骨折内固定物', '置入式假体装置'),
    evidence: fact.evidence.replaceAll('骨折内固定物', '置入式假体装置'),
  }));
  assert.equal(evaluateConditionLogic(prosthesisClause.conditionLogic, prosthesisFacts).met, true);

  const description = '检查确认骨折内固定物损坏，医师评估骨折内固定物需要手术更换。';
  const normalized = normalizeResult({ ...providerFixture('injury'), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description }, { clauses: [clause],
    requestId: 'hardware-replacement-need-binding', model: 'test-model', extractedFacts: facts,
    conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(normalized.grade, clause.grade);
  assert.equal(normalized.references.find(reference => reference.id === clause.id)?.relation, 'supports');
});

test('5.6.3.2 links thoracoplasty and rib resection to the same thoracic site, side, and event', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.6.3.2');
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '一侧胸廓成形术后', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '本次损伤后右侧胸廓成形术后，记录为一侧胸廓成形术后' },
    { id: 'F2', eventId: 'E1', field: 'clinical_finding', value: '切除6根以上肋骨', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '右侧胸廓成形术后切除6根以上肋骨' },
  ];
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);

  const otherEvent = facts.map(fact => fact.id === 'F2' ? { ...fact, eventId: 'E2' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, otherEvent).met, true);

  const oppositeSide = facts.map(fact => fact.id === 'F2' ? { ...fact,
    evidence: '左侧胸廓成形术后切除6根以上肋骨' } : fact);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, oppositeSide).met, true);

  const description = '本次损伤后右侧胸廓成形术后，记录为一侧胸廓成形术后；右侧胸廓成形术后切除6根以上肋骨。';
  const normalized = normalizeResult({ ...providerFixture('disability'), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.disability, description, treatmentStatus: 'stable' }, { clauses: [clause],
    requestId: 'thoracoplasty-rib-count-binding', model: 'test-model', extractedFacts: facts,
    conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(normalized.grade, clause.grade);
  assert.equal(normalized.references.find(reference => reference.id === clause.id)?.relation, 'supports');
});

test('source-quoted postoperative states satisfy their own criterion without requiring another primary-injury organ anchor', () => {
  const pancreasClause = catalogs.disability.clauses.find(item => item.id === '5.6.4.3');
  const pancreasFacts = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '胰腺部分切除术后', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '胰腺部分切除术后' },
    { id: 'F2', eventId: 'E1', field: 'clinical_finding', value: '功能障碍', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '胰腺部分切除术后出现胰腺功能障碍' },
    { id: 'F3', eventId: 'E1', field: 'clinical_finding', value: '需药物治疗', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '胰腺部分切除术后胰腺功能障碍需药物治疗' },
  ];
  assert.equal(evaluateConditionLogic(pancreasClause.conditionLogic, pancreasFacts).met, true);

  const esophagusClause = catalogs.disability.clauses.find(item => item.id === '5.8.3.3');
  const esophagusFacts = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '食管部分切除术后', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '食管部分切除术后' },
    { id: 'F2', eventId: 'E1', field: 'clinical_finding', value: '后遗胸腔胃', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '食管部分切除术后形成后遗胸腔胃' },
  ];
  assert.equal(evaluateConditionLogic(esophagusClause.conditionLogic, esophagusFacts).met, true);
  assert.notEqual(evaluateConditionLogic(esophagusClause.conditionLogic,
    esophagusFacts.map(fact => fact.id === 'F1' ? { ...fact, eventId: 'E2' } : fact)).met, true);

  const heartClause = catalogs.disability.clauses.find(item => item.id === '5.8.3.7');
  const unrelatedPostoperativeFinding = [
    { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '心脏修补术后', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '心脏修补术后' },
    { id: 'F2', eventId: 'E1', field: 'symptom', value: '心悸', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '心脏手术后出现心悸' },
  ];
  assert.notEqual(evaluateConditionLogic(heartClause.conditionLogic, unrelatedPostoperativeFinding).met, true);

  const heartRepair = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: '心脏修补术后',
    certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '因本次事故导致心脏损伤行心脏修补术后' };
  const heartInjury = { id: 'F2', eventId: 'E1', field: 'diagnosis', value: '心脏损伤', certainty: 'reported',
    source: 'description', verification: 'quoted', evidence: '本次事故导致心脏损伤' };
  assert.equal(evaluateConditionLogic(heartClause.conditionLogic, [heartRepair, heartInjury]).met, true);
  assert.notEqual(evaluateConditionLogic(heartClause.conditionLogic,
    [{ ...heartRepair, evidence: '本次事故后行心脏修补术后' }, { ...heartInjury, eventId: 'E2' }]).met, true);
  assert.notEqual(evaluateConditionLogic(heartClause.conditionLogic,
    [{ ...heartRepair, evidence: '因本次事故导致肾损伤行心脏修补术后' },
      { ...heartInjury, value: '肾损伤', evidence: '本次事故导致肾损伤' }]).met, true);

  const vesselRepair = { id: 'F3', eventId: 'E1', field: 'clinical_finding', value: '大血管修补术后',
    certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '因本次事故导致主动脉损伤行大血管修补术后' };
  const vesselInjury = { id: 'F4', eventId: 'E1', field: 'diagnosis', value: '主动脉损伤', certainty: 'reported',
    source: 'description', verification: 'quoted', evidence: '本次事故导致主动脉损伤' };
  assert.equal(evaluateConditionLogic(heartClause.conditionLogic, [vesselRepair, vesselInjury]).met, true);
  assert.notEqual(evaluateConditionLogic(heartClause.conditionLogic,
    [{ ...vesselRepair, evidence: '本次事故后行大血管修补术后' }, { ...vesselInjury, eventId: 'E2' }]).met, true);
  assert.notEqual(evaluateConditionLogic(heartClause.conditionLogic,
    [{ ...vesselRepair, evidence: '因本次事故导致肾损伤行大血管修补术后' },
      { ...vesselInjury, value: '肾损伤', evidence: '本次事故导致肾损伤' }]).met, true);
});

test('heart and pericardial repair procedure names do not prove rupture without direct lesion evidence', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.6.2.b');
  const evaluate = (value, evidence, requestId) => {
    const fact = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence };
    const result = normalizeResult({ ...providerFixture('injury'), status: 'preliminary', grade: clause.grade,
      facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence, reasoning: '',
        conditions: [{ condition: clause.text, evidence, factIds: ['F1'], met: true }] }] },
    { ...inputs.injury, description: `合成资料，非真实病例。${evidence}` },
    { clauses: [clause], requestId, model: 'test-model', extractedFacts: [fact], conflicts: [],
      requiresReview: false, factMissingMaterials: [] });
    return { result, fact };
  };

  for (const [value, evidence] of [
    ['心脏破裂', '本次手术计划：拟行心脏破裂修补术。'],
    ['心脏破裂', '本次手术记录：行心脏破裂修补术。'],
    ['心包破裂', '本次手术计划：拟行心包破裂修补术。'],
    ['心包破裂', '本次手术记录：行心包破裂修补术。'],
  ]) {
    const { result } = evaluate(value, evidence, `procedure-title-only-${value}`);
    assert.equal(result.grade, null, evidence);
    assert.notEqual(result.references.find(reference => reference.id === clause.id)?.relation, 'supports', evidence);
    const parsed = normalizeExtractedFacts(emptyExtraction, { description: `合成资料，非真实病例。${evidence}` }).facts;
    assert.equal(parsed.some(fact => fact.field === 'clinical_finding' && fact.value === value), false, evidence);
  }

  const cardiacEvidence = '本次手术探查见右心室前壁约2cm穿通伤，活动性出血并已缝合修补。';
  const directCardiac = evaluate('心脏破裂', cardiacEvidence, 'direct-cardiac-wall-injury');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [directCardiac.fact]).met, true);
  assert.equal(directCardiac.result.grade, clause.grade);

  const pericardialEvidence = '本次手术探查见心包全层裂口约4cm，予缝扎止血。';
  const directPericardial = evaluate('心包破裂', pericardialEvidence, 'direct-pericardial-wall-injury');
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [directPericardial.fact]).met, true);
  assert.equal(directPericardial.result.grade, clause.grade);

  const deterministicFacts = normalizeExtractedFacts(emptyExtraction, { description: pericardialEvidence }).facts;
  assert.ok(deterministicFacts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '心包破裂' && fact.sourceRefs?.some(reference => reference.source === 'description')));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, deterministicFacts).met, true);
});

test('corrected visual acuity is bound to the injured eye rather than the next eye mentioned', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.4.4.f');
  const wrongEyeDescription = '合成资料，非真实病例。右眼本次外伤后复查，左眼矫正视力0.4，右眼矫正视力1.0。';
  const wrongEyeFacts = normalizeExtractedFacts(emptyExtraction, { description: wrongEyeDescription }).facts;
  assert.equal(wrongEyeFacts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '一眼矫正视力减退至0.5以下'), false);
  const modelClaim = { id: 'F1', field: 'clinical_finding', value: '一眼矫正视力减退至0.5以下',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: wrongEyeDescription };
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [modelClaim]).met, true);

  const sameEyeDescription = '合成资料，非真实病例。右眼本次外伤后复查，右眼矫正视力0.5，左眼视力1.0。';
  const sameEyeFacts = normalizeExtractedFacts(emptyExtraction, { description: sameEyeDescription }).facts;
  assert.ok(sameEyeFacts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '一眼矫正视力减退至0.5以下'));
});

test('moderate shock requires a documented grade and an explicit current-injury causal link', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.12.2.d');
  const assess = description => {
    const extracted = normalizeExtractedFacts(emptyExtraction, { description });
    const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
    return { extracted, facts, met: evaluateConditionLogic(clause.conditionLogic, facts).met };
  };
  const supportedDescription = '合成资料，非真实病例。诊断：本次外伤所致中度失血性休克，收缩压75mmHg，脉搏110次/分，全身状况为抑制、苍白、皮肤冷。';
  const supported = assess(supportedDescription);
  assert.ok(supported.facts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '各种损伤引起休克(中度)'));
  assert.equal(supported.met, true);
  const supportedResult = normalizeResult({ ...providerFixture('injury'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: supportedDescription, reasoning: '',
      conditions: [{ condition: clause.text, evidence: supportedDescription,
        factIds: supported.facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.injury, description: supportedDescription }, { clauses: [clause], requestId: 'moderate-shock-supported',
    model: 'test-model', extractedFacts: supported.facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(supportedResult.grade, clause.grade);

  const equivalent = assess('合成资料，非真实病例。诊断为中度失血性休克，系本次交通事故所致。');
  assert.ok(equivalent.facts.some(fact => fact.field === 'clinical_finding'
    && fact.value === '各种损伤引起休克(中度)'));
  assert.equal(equivalent.met, true);
  const unrelatedUncertainty = assess('合成资料，非真实病例。诊断：本次外伤所致中度失血性休克，另考虑轻度脱水。');
  assert.equal(unrelatedUncertainty.met, true);

  const quotedClause = '合成资料，非真实病例。诊断仅为休克；说明文字引用标准原文：各种损伤引起休克（中度）。';
  const modelOnlyFact = { id: 'MODEL', eventId: 'E1', field: 'clinical_finding', value: '各种损伤引起休克(中度)',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: quotedClause };
  const rejectedResult = normalizeResult({ ...providerFixture('injury'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: quotedClause, reasoning: '',
      conditions: [{ condition: clause.text, evidence: quotedClause, factIds: [modelOnlyFact.id], met: true }] }] },
  { ...inputs.injury, description: quotedClause }, { clauses: [clause], requestId: 'moderate-shock-model-only',
    model: 'test-model', extractedFacts: [modelOnlyFact], conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(rejectedResult.grade, null);
  assert.notEqual(rejectedResult.references.find(reference => reference.id === clause.id)?.relation, 'supports');

  for (const description of [
    '合成资料，非真实病例。本次外伤后血压75mmHg，脉搏110次/分，面色苍白、皮肤冷；病历只记载休克。',
    '合成资料，非真实病例。诊断：本次外伤后出现中度失血性休克，收缩压75mmHg，脉搏110次/分，抑制、苍白、皮肤冷。',
    '合成资料，非真实病例。诊断需核验：本次外伤所致中度休克是否成立。',
    '合成资料，非真实病例。诊断中度失血性休克。另有本次外伤所致其他损伤。',
    '合成资料，非真实病例。诊断：疑似本次外伤所致中度失血性休克，收缩压75mmHg，脉搏110次/分，抑制、苍白、皮肤冷。',
    '合成资料，非真实病例。既往外伤所致中度失血性休克；本次外伤后只记载休克。',
    '合成资料，非真实病例。患者父亲诊断本次外伤所致中度失血性休克。',
  ]) {
    const result = assess(description);
    assert.equal(result.facts.some(fact => fact.field === 'clinical_finding'
      && fact.value === '各种损伤引起休克(中度)'), false, description);
    assert.notEqual(result.met, true, description);
  }
});

test('quoted standard text cannot stand in for a patient finding', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.4.6.3');
  const criterion = clause.conditionLogic.logic.sourceText;
  const evaluate = (description, requestId) => {
    const fact = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: criterion, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: criterion };
    const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
      facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: criterion, reasoning: '',
        conditions: [{ condition: clause.text, evidence: criterion, factIds: ['F1'], met: true }] }] },
    { ...inputs.disability, description }, { clauses: [clause], requestId, model: 'test-model', extractedFacts: [fact],
      conflicts: [], requiresReview: false, factMissingMaterials: [] });
    return result;
  };

  const standardQuote = '合成资料，非真实病例。标准原文：' + criterion + '。本段仅引用鉴定标准条文，没有受检者手功能检查结果。';
  const rejected = evaluate(standardQuote, 'quoted-standard-is-not-patient-fact');
  assert.equal(rejected.grade, null);
  assert.notEqual(rejected.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.match([...rejected.warnings, ...rejected.nextSteps].join(' '), /标准.{0,12}(?:引用|原文)|条文.{0,12}(?:引用|原文)/u);
  assert.equal(evaluate('合成资料，非真实病例。标准原文\n' + criterion,
    'standard-heading-before-quotation').grade, null);
  assert.equal(evaluate('合成资料，非真实病例。引用《人体损伤致残程度分级》第5.4.6.3条：' + criterion + '。',
    'quoted-named-standard-is-not-patient-fact').grade, null);
  assert.equal(evaluate('合成资料，非真实病例。《人体损伤致残程度分级》第5.4.6.3条：' + criterion + '。',
    'standard-citation-without-quote-verb-is-not-patient-fact').grade, null);

  const patientFinding = '合成资料，非真实病例。手功能评估记录：' + criterion + '。';
  const supported = evaluate(patientFinding, 'quoted-patient-finding-remains-supported');
  assert.equal(supported.grade, clause.grade);
  assert.equal(supported.references.find(reference => reference.id === clause.id)?.relation, 'supports');

  const standardThenPatientFinding = '合成资料，非真实病例。标准原文：' + criterion
    + '。另有受检者手功能评估记录：' + criterion + '。';
  const repeated = evaluate(standardThenPatientFinding, 'patient-finding-after-standard-quotation');
  assert.equal(repeated.grade, clause.grade);
  assert.equal(repeated.references.find(reference => reference.id === clause.id)?.relation, 'supports');
});

test('an isolated prior appraisal conclusion cannot stand in for source findings', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.9.1.a');
  const condition = clause.conditionLogic.logic.factMatch.values[0];
  const assess = (description, requestId, responseOverrides = {}) => {
    const fact = { id: 'F1', eventId: 'E1', field: 'clinical_finding', value: condition, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: condition };
    return normalizeResult({ ...providerFixture('injury'), ...responseOverrides, status: 'preliminary', grade: clause.grade, facts: [],
      references: [{ clauseId: clause.id, relation: 'supports', evidence: condition, reasoning: '',
        conditions: [{ condition: clause.text, evidence: condition, factIds: ['F1'], met: true }] }] },
    { ...inputs.injury, description }, { clauses: [clause], requestId, model: 'test-model', extractedFacts: [fact],
      conflicts: [], requiresReview: false, factMissingMaterials: [] });
  };

  const priorConclusion = assess(`合成资料，非真实病例。原鉴定意见：${condition}，原结论为重伤一级。`,
    'isolated-prior-appraisal-conclusion', { summary: '原结论重伤一级，应按此定级。', reasoning: '引用原鉴定意见后认定重伤一级。' });
  assert.equal(priorConclusion.grade, null);
  assert.notEqual(priorConclusion.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.match([...priorConclusion.warnings, ...priorConclusion.nextSteps].join(' '), /鉴定结论|鉴定意见/u);
  assert.doesNotMatch(`${priorConclusion.summary} ${priorConclusion.reasoning}`, /重伤一级/u);
  assert.equal(assess(`合成资料，非真实病例。鉴定意见记载：${condition}。`,
    'appraisal-conclusion-is-not-patient-finding').grade, null);

  const sourceExam = assess(`合成资料，非真实病例。本次影像与体格检查记录：${condition}。`, 'current-source-findings-remain-supported');
  assert.equal(sourceExam.grade, clause.grade);
  assert.equal(sourceExam.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  const priorAndExam = assess(`合成资料，非真实病例。原鉴定意见：${condition}。本次影像与体格检查记录：${condition}。`,
    'independent-source-finding-after-prior-appraisal');
  assert.equal(priorAndExam.grade, clause.grade);
  assert.equal(priorAndExam.references.find(reference => reference.id === clause.id)?.relation, 'supports');
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

test('postposed epilepsy qualifiers cannot turn uncertain or excluded diagnoses into support', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.l');
  const examples = [
    ['影像示脑外伤后左颞叶软化灶，外伤性迟发性癫痫待排。', 'uncertain'],
    ['诊断为外伤性迟发性癫痫可能。', 'uncertain'],
    ['外伤性迟发性癫痫可疑。', 'uncertain'],
    ['外伤性迟发性癫痫不除外。', 'uncertain'],
    ['外伤性迟发性癫痫未排除。', 'uncertain'],
    ['外伤性迟发性癫痫明确排除。', 'excluded'],
  ];
  for (const [description, certainty] of examples) {
    const derived = normalizeExtractedFacts(emptyExtraction, { description }).facts
      .filter(fact => fact.field === 'clinical_finding' && fact.value === '外伤性迟发性癫痫');
    assert.equal(derived.some(fact => fact.certainty === 'reported'), false, description);
    assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
      derived.map(fact => ({ ...fact, verification: 'quoted' }))).met, true, description);

    const modelFact = { id: 'M1', field: 'diagnosis', value: '外伤性迟发性癫痫', certainty: 'reported',
      source: 'description', evidence: '外伤性迟发性癫痫' };
    const validated = normalizeExtractedFacts({ facts: [modelFact], missingMaterials: [], conflicts: [],
      requiresReview: false }, { description }).facts.filter(fact => fact.value === '外伤性迟发性癫痫');
    assert.ok(validated.some(fact => fact.certainty === certainty), description);
    assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
      validated.map(fact => ({ ...fact, verification: 'quoted' }))).met, true, description);
  }

  const definitive = normalizeExtractedFacts(emptyExtraction, {
    description: '法医诊断明确为外伤性迟发性癫痫。',
  }).facts.filter(fact => fact.value === '外伤性迟发性癫痫')
    .map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, definitive).met, true);

  const sahClause = catalogs.injury.clauses.find(item => item.id === '5.1.2.f');
  const uncertainSah = normalizeExtractedFacts(emptyExtraction, { description:
    '合成资料，非真实病例。外伤性蛛网膜下腔出血可疑，伴头痛、呕吐和短暂意识不清。' })
    .facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.notEqual(evaluateConditionLogic(sahClause.conditionLogic, uncertainSah).met, true);
});

test('postposed fracture uncertainty applies to structured vertebral diagnoses', () => {
  const uncertain = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。影像示L1左侧横突骨折可疑。',
  }).facts;
  assert.equal(uncertain.some(fact => fact.field === 'diagnosis'
    && fact.value === 'L1左侧横突骨折' && fact.certainty === 'reported'), false);

  const definitive = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。影像明确示L1左侧横突骨折。',
  }).facts;
  assert.ok(definitive.some(fact => fact.field === 'diagnosis'
    && fact.value === 'L1左侧横突骨折' && fact.certainty === 'reported'));
});

test('a following negated condition does not negate the preceding wound measurement', () => {
  const facts = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。左前臂创口长5cm，未见骨折。',
  }).facts;
  assert.ok(facts.some(fact => fact.field === 'wound_length_cm' && fact.value === 5
    && fact.certainty === 'reported'));
});

test('orbital enophthalmos measurements bind to the correct threshold and fracture side', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.2.2.h');
  const atThresholdDescription = '合成资料，非真实病例。CT示左眼眶骨折致左眼球内陷5mm。';
  const atThreshold = normalizeExtractedFacts(emptyExtraction, {
    description: atThresholdDescription,
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const belowThreshold = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。CT示左眼眶骨折致左眼球内陷4.9mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const mismatchedSide = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。CT示左眼眶骨折致右眼球内陷5mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const unrelatedFractureCause = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。CT示左眼眶骨折，另有肋骨骨折致左眼球内陷5mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));

  assert.equal(atThreshold.find(fact => fact.field === 'orbital_enophthalmos_cm')?.value, 0.5);
  assert.ok(retrieveClauses('injury', atThresholdDescription, 0, atThreshold)
    .some(item => item.id === clause.id));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, atThreshold).met, true);
  const acceptedModelSupport = normalizeResult({ ...providerFixture('injury'), status: 'preliminary',
    grade: clause.grade, facts: [], references: [{ clauseId: clause.id, relation: 'supports',
      evidence: atThresholdDescription, reasoning: '',
      conditions: [{ condition: clause.text, evidence: atThresholdDescription, factIds: atThreshold.map(fact => fact.id), met: true }] }] },
  { ...inputs.injury, description: atThresholdDescription }, { clauses: [clause], requestId: 'orbital-enophthalmos-at-threshold',
    model: 'test-model', extractedFacts: atThreshold, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(acceptedModelSupport.grade, clause.grade);
  assert.equal(acceptedModelSupport.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, belowThreshold).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, mismatchedSide).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, unrelatedFractureCause).met, true);

  const chineseNumber = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。CT示左眼眶下壁骨折致左眼球内陷五毫米。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(chineseNumber.find(fact => fact.field === 'orbital_enophthalmos_cm')?.value, 0.5);

  const moderateClause = catalogs.injury.clauses.find(item => item.id === '5.2.3.g');
  const moderateMeasurement = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。CT示左眼眶下壁骨折致左眼球内陷2mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(moderateClause.conditionLogic, moderateMeasurement).met, true);

  const evidence = '合成资料，非真实病例。CT示左眼眶下壁骨折致左眼球内陷1.9mm。';
  const rejectedModelSupport = normalizeResult({ ...providerFixture('injury'), status: 'preliminary',
    grade: clause.grade, facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence, reasoning: '',
      conditions: [{ condition: clause.text, evidence, factIds: belowThreshold.map(fact => fact.id), met: true }] }] },
  { ...inputs.injury, description: evidence }, { clauses: [clause], requestId: 'orbital-enophthalmos-below-threshold',
    model: 'test-model', extractedFacts: belowThreshold, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(rejectedModelSupport.grade, null);
  assert.notEqual(rejectedModelSupport.references.find(reference => reference.id === clause.id)?.relation, 'supports');
});

test('disability orbital enophthalmos thresholds use measured sequela values', () => {
  const clauseNine = catalogs.disability.clauses.find(item => item.id === '5.9.2.16');
  const clauseTen = catalogs.disability.clauses.find(item => item.id === '5.10.2.9');
  const atFiveMillimetres = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。左眼眶骨折后遗左眼球内陷5mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const atTwoMillimetres = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。左眼眶骨折后遗左眼球内陷2mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const belowTwoMillimetres = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。左眼眶骨折后遗左眼球内陷1.9mm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));

  const description = '合成资料，非真实病例。左眼眶骨折后遗左眼球内陷5mm。';
  assert.ok(retrieveClauses('disability', description, 0, atFiveMillimetres)
    .some(item => item.id === clauseNine.id));
  assert.equal(evaluateConditionLogic(clauseNine.conditionLogic, atFiveMillimetres).met, true);
  assert.equal(evaluateConditionLogic(clauseTen.conditionLogic, atTwoMillimetres).met, true);
  assert.notEqual(evaluateConditionLogic(clauseTen.conditionLogic, belowTwoMillimetres).met, true);

  const stableResult = normalizeResult({ ...providerFixture('disability'), status: 'preliminary',
    grade: clauseNine.grade, facts: [], references: [{ clauseId: clauseNine.id, relation: 'supports',
      evidence: description, reasoning: '', conditions: [{ condition: clauseNine.text, evidence: description,
        factIds: atFiveMillimetres.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description, treatmentStatus: 'stable' }, { clauses: [clauseNine],
    requestId: 'disability-orbital-enophthalmos-stable', model: 'test-model', extractedFacts: atFiveMillimetres,
    conflicts: [], requiresReview: false, factMissingMaterials: [] });
  const ongoingResult = normalizeResult({ ...providerFixture('disability'), status: 'preliminary',
    grade: clauseNine.grade, facts: [], references: [{ clauseId: clauseNine.id, relation: 'supports',
      evidence: description, reasoning: '', conditions: [{ condition: clauseNine.text, evidence: description,
        factIds: atFiveMillimetres.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description, treatmentStatus: 'ongoing' }, { clauses: [clauseNine],
    requestId: 'disability-orbital-enophthalmos-ongoing', model: 'test-model', extractedFacts: atFiveMillimetres,
    conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(stableResult.grade, clauseNine.grade);
  assert.equal(ongoingResult.grade, null);
  assert.equal(ongoingResult.status, 'insufficient');
});

test('unscoped clause evidence cannot support a grade beside explicitly scoped event facts', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.7.6.1');
  const value = clause.conditionLogic.logic.predicate.value;
  const evidence = '本次损伤导致双下肢长度相差8cm';
  const unscoped = { id: 'L1', field: 'limb_length_difference_cm', value, certainty: 'derived',
    source: 'description', verification: 'quoted', evidence };
  const scoped = { id: 'E1', eventId: 'E1', field: 'injury_type', value: 'rib_fracture',
    certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '本次交通事故致肋骨骨折' };

  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [unscoped, scoped]).met, true);
  const linked = { ...unscoped, eventId: 'E1' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [linked, scoped]).met, true);

  const description = `合成资料，非真实病例。${evidence}。另有本次交通事故致肋骨骨折的记录。`;
  const makeResult = (facts, requestId) => normalizeResult({ ...providerFixture('disability'),
    status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence, reasoning: '',
      conditions: [{ condition: clause.text, evidence, factIds: ['L1'], met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId,
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false,
    factMissingMaterials: [] });
  const result = makeResult([unscoped, scoped], 'unscoped-clause-fact-event-gate');
  assert.equal(result.grade, null);
  assert.notEqual(result.references.find(reference => reference.id === clause.id)?.relation, 'supports');
  const linkedResult = makeResult([linked, scoped], 'linked-clause-fact-event-gate');
  assert.equal(linkedResult.grade, clause.grade);
});

test('limb length discrepancy thresholds bind only to directly linked current injuries and matching regions', () => {
  const lowerEight = catalogs.disability.clauses.find(item => item.id === '5.7.6.1');
  const upperEight = catalogs.disability.clauses.find(item => item.id === '5.8.6.6');
  const description = '合成资料，非真实病例。本次骨盆骨折导致双下肢长度相差8cm。';
  const facts = normalizeExtractedFacts(emptyExtraction, { description }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  const discrepancy = facts.find(fact => fact.field === 'limb_length_difference_cm');

  assert.equal(discrepancy?.value, 8);
  assert.ok(retrieveClauses('disability', description, 0, facts).some(item => item.id === lowerEight.id));
  assert.equal(evaluateConditionLogic(lowerEight.conditionLogic, facts).met, true);
  assert.notEqual(evaluateConditionLogic(upperEight.conditionLogic, facts).met, true);

  const thresholdCases = [
    ['下', '8cm', '5.7.6.1', 8], ['上', '8cm', '5.8.6.6', 8],
    ['下', '6cm', '5.8.6.7', 6], ['上', '6cm', '5.9.6.7', 6],
    ['下', '4cm', '5.9.6.8', 4], ['上', '4cm', '5.10.6.9', 4],
    ['下', '2cm', '5.10.6.10', 2], ['下', '八厘米', '5.7.6.1', 8],
    ['下', '80毫米', '5.7.6.1', 8],
  ];
  for (const [limb, measurement, clauseId, expectedValue] of thresholdCases) {
    const text = `合成资料，非真实病例。本次损伤导致双${limb}肢长度相差${measurement}。`;
    const normalizedFacts = normalizeExtractedFacts(emptyExtraction, { description: text }).facts
      .map(fact => ({ ...fact, verification: 'quoted' }));
    const targetClause = catalogs.disability.clauses.find(item => item.id === clauseId);
    assert.equal(normalizedFacts.find(fact => fact.field === 'limb_length_difference_cm')?.value, expectedValue, text);
    assert.equal(evaluateConditionLogic(targetClause.conditionLogic, normalizedFacts).met, true, text);
  }
  const belowEight = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。本次损伤导致双下肢长度相差7.9cm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.notEqual(evaluateConditionLogic(lowerEight.conditionLogic, belowEight).met, true);
  const inclusiveBoundary = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。本次损伤导致双下肢长度相差8cm以上。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(lowerEight.conditionLogic, inclusiveBoundary).met, true);
  const lowerBoundBelowThreshold = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。本次损伤导致双下肢长度相差7cm以上。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.notEqual(evaluateConditionLogic(lowerEight.conditionLogic, lowerBoundBelowThreshold).met, true);
  const equivalentWording = normalizeExtractedFacts(emptyExtraction, {
    description: '合成资料，非真实病例。本次损伤导致双下肢长度差异8cm。',
  }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(equivalentWording.find(fact => fact.field === 'limb_length_difference_cm')?.value, 8);
  assert.equal(evaluateConditionLogic(lowerEight.conditionLogic, equivalentWording).met, true);

  const linkedExtraction = normalizeExtractedFacts({ facts: [{ id: 'L1', eventId: 'E1', field: 'clinical_finding',
    value: '双下肢长度相差8cm', certainty: 'reported', source: 'description',
    evidence: '本次骨盆骨折导致双下肢长度相差8cm' }], missingMaterials: [], conflicts: [], requiresReview: false },
  { description });
  assert.equal(linkedExtraction.facts.find(fact => fact.field === 'limb_length_difference_cm')?.eventId, 'E1');
  const diagnosisAnchoredExtraction = normalizeExtractedFacts({ facts: [{ id: 'D1', eventId: 'E1', field: 'injury_type',
    value: 'pelvic_fracture', certainty: 'reported', source: 'description', evidence: '本次骨盆骨折' }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  assert.equal(diagnosisAnchoredExtraction.facts.find(fact => fact.field === 'limb_length_difference_cm')?.eventId, 'E1');
  const ambiguousExtraction = normalizeExtractedFacts({ facts: ['E1', 'E2'].map(eventId => ({ id: 'L' + eventId,
    eventId, field: 'clinical_finding', value: '双下肢长度相差8cm', certainty: 'reported',
    source: 'description', evidence: '本次骨盆骨折导致双下肢长度相差8cm' })),
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  assert.equal(ambiguousExtraction.facts.find(fact => fact.field === 'limb_length_difference_cm')?.eventId, undefined);

  const pelvicClause = catalogs.injury.clauses.find(item => item.id === '5.8.2.a');
  const pelvicDescription = '合成资料，非真实病例。本次骨盆骨折畸形愈合导致双下肢相对长度相差5cm。';
  const pelvicFacts = normalizeExtractedFacts({ facts: [{ id: 'P1', eventId: 'E1', field: 'clinical_finding',
    value: '骨盆骨折畸形愈合', certainty: 'reported', source: 'description', evidence: '本次骨盆骨折畸形愈合' }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description: pelvicDescription }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(pelvicFacts.find(fact => fact.field === 'limb_length_difference_cm')?.eventId, 'E1');
  assert.equal(evaluateConditionLogic(pelvicClause.conditionLogic, pelvicFacts).met, true);

  for (const text of [
    '合成资料，非真实病例。本次骨盆骨折后双下肢长度相差8cm。',
    '合成资料，非真实病例。既往骨盆骨折导致双下肢长度相差8cm。',
    '合成资料，非真实病例。本次肋骨骨折，另记双下肢长度相差8cm。',
  ]) {
    const unlinked = normalizeExtractedFacts(emptyExtraction, { description: text }).facts;
    assert.equal(unlinked.some(fact => fact.field === 'limb_length_difference_cm'), false, text);
  }
  const modelInventedDescription = '合成资料，非真实病例。本次骨盆骨折后双下肢长度相差8cm。';
  const modelInvented = normalizeExtractedFacts({ facts: [{ id: 'M1', field: 'limb_length_difference_cm',
    value: 8, certainty: 'reported', source: 'description', evidence: modelInventedDescription }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description: modelInventedDescription });
  assert.equal(modelInvented.facts.some(fact => fact.field === 'limb_length_difference_cm'), false);
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

test('typed fields can recall every explicit clause beyond lexical ranking', () => {
  const sampleFact = (clause, node, index) => {
    const match = node.factMatch || node.confirmedBy;
    if (node.predicate?.field) return { id: `P${index}`, field: node.predicate.field, value: null,
      certainty: 'reported', source: 'description', evidence: '' };
    if (!match) return null;
    const field = match.field || match.fields?.[0];
    if (!field) return null;
    const value = match.values?.[0] ?? match.valueIncludes?.[0] ?? 'candidate evidence';
    const evidence = match.evidenceAliases?.[0] || (typeof value === 'string' ? value : '');
    return { id: `M${index}`, field, value, certainty: 'reported', source: 'description', evidence };
  };
  const makeFacts = catalog => catalog.clauses.flatMap((clause, index) => {
    if (clause.conditionLogic?.annotation !== 'explicit') return [];
    let fact = null;
    const walk = node => {
      if (!node || fact) return;
      fact = sampleFact(clause, node, index);
      for (const child of node.children || []) walk(child);
    };
    walk(clause.conditionLogic.logic);
    return fact ? [fact] : [];
  });

  for (const type of ['injury', 'disability']) {
    const clauses = catalogs[type].clauses.filter(clause => clause.conditionLogic?.annotation === 'explicit');
    const candidates = new Set(retrieveClauses(type, '', 0, makeFacts(catalogs[type])).map(clause => clause.id));
    const missing = clauses.filter(clause => !candidates.has(clause.id)).map(clause => clause.id);
    assert.deepEqual(missing, []);
  }
});

test('service normalization rejects model support for every opaque grading clause', () => {
  let checked = 0;
  for (const [assessmentType, catalog] of Object.entries(catalogs)) for (const clause of catalog.clauses) {
    if (clause.conditionLogic.annotation !== 'opaque') continue;
    checked += 1;
    const description = `合成资料，非真实病例。${clause.text}`;
    const fact = { id: 'F1', field: 'clinical_finding', value: clause.text, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: clause.text };
    const raw = { ...providerFixture(assessmentType), status: 'preliminary', grade: clause.grade, facts: [],
      references: [{ clauseId: clause.id, relation: 'supports', evidence: clause.text, reasoning: '',
        conditions: [{ condition: clause.text, evidence: clause.text, factIds: ['F1'], met: true }] }] };
    const result = normalizeResult(raw, { ...inputs[assessmentType], description }, { clauses: [clause],
      requestId: `opaque-service-gate-${assessmentType}-${clause.id}`, model: 'test-model',
      extractedFacts: [fact], conflicts: [], requiresReview: false, factMissingMaterials: [] });
    const reference = result.references.find(item => item.id === clause.id);

    assert.equal(result.grade, null, clause.id);
    assert.notEqual(reference?.relation, 'supports', clause.id);
    assert.equal(reference?.evidence, '', clause.id);
    assert.ok(reference?.conditions.every(condition => condition.evidence === ''
      && condition.factIds.length === 0 && condition.met === null), clause.id);
  }
  assert.equal(checked, 36);
});

test('service normalization rejects unsupported model support claims for every explicit clause', () => {
  let checked = 0;
  for (const [assessmentType, catalog] of Object.entries(catalogs)) for (const clause of catalog.clauses) {
    if (clause.conditionLogic.annotation !== 'explicit') continue;
    checked += 1;
    const description = '合成资料，非真实病例。本次材料仅记载无关行政信息。';
    const fact = { id: 'F1', field: 'administrative_note', value: '行政信息', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '无关行政信息' };
    const raw = { ...providerFixture(assessmentType), status: 'preliminary', grade: clause.grade, facts: [],
      references: [{ clauseId: clause.id, relation: 'supports', evidence: clause.text, reasoning: '',
        conditions: [{ condition: clause.text, evidence: clause.text, factIds: ['F1'], met: true }] }] };
    const result = normalizeResult(raw, { ...inputs[assessmentType], description }, { clauses: [clause],
      requestId: `explicit-service-gate-${assessmentType}-${clause.id}`, model: 'test-model',
      extractedFacts: [fact], conflicts: [], requiresReview: false, factMissingMaterials: [] });

    assert.equal(result.grade, null, clause.id);
    assert.ok(result.references.every(reference => reference.relation !== 'supports'), clause.id);
  }
  assert.equal(checked, 811);
});

test('neck triangle scar areas bind to measured facts and cannot borrow another site', () => {
  const assess = (id, area, site = '颈前三角区') => {
    const description = `本次事故后${site}瘢痕累计面积${area}cm2。`;
    const facts = normalizeExtractedFacts(emptyExtraction, { description }).facts
      .map(fact => ({ ...fact, verification: 'quoted' }));
    const clause = catalogs.disability.clauses.find(item => item.id === id);
    assert.ok(facts.some(fact => fact.field === 'aggregate_surface_scar_area_cm2' && fact.value === area));
    assert.ok(retrieveClauses('disability', '', 0, facts).some(item => item.id === id));
    return evaluateConditionLogic(clause.conditionLogic, facts).met;
  };

  assert.equal(assess('5.9.3.1', 50), true);
  assert.notEqual(assess('5.9.3.1', 49.99), true);
  assert.equal(assess('5.10.3.2', 25), true);
  assert.notEqual(assess('5.10.3.2', 24.99), true);

  const description = '本次事故后背部瘢痕累计面积25cm2。';
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.3.2');
  const facts = [{ id: 'B1', eventId: 'E1', field: 'aggregate_surface_scar_area_cm2', value: 25,
    certainty: 'reported', source: 'description', evidence: '背部瘢痕累计面积25cm2', verification: 'quoted' }];
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, facts).met, true);
  const result = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: description, reasoning: '',
      conditions: [{ condition: clause.text, evidence: description,
        factIds: facts.map(fact => fact.id), met: true }] }] },
  { ...inputs.disability, description }, { clauses: [clause], requestId: 'neck-triangle-area-model-override',
    model: 'test-model', extractedFacts: facts, conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(result.grade, null);
  assert.notEqual(result.references.find(reference => reference.id === clause.id)?.relation, 'supports');
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

test('rib-disability grades bind model summaries to actual root-count and malunion facts', () => {
  const clauses = ['5.10.3.7', '5.8.3.6', '5.9.3.11']
    .map(id => catalogs.disability.clauses.find(clause => clause.id === id));
  const headEvidence = '合成资料，非真实病例。本次事故另有头部软组织损伤。';
  const description = `${headEvidence}本次事故后CT明确共12根肋骨骨折；复查确认后遗6处畸形愈合。`;
  const modelReferences = facts => clauses.map(clause => ({ clauseId: clause.id, relation: 'supports',
    evidence: headEvidence, reasoning: '', conditions: [{ condition: clause.text, evidence: headEvidence,
      factIds: facts.map(fact => fact.id), met: true }] }));
  const uncertainFacts = [
    { id: 'HEAD', eventId: 'E1', field: 'clinical_finding', value: '头部软组织损伤', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: headEvidence },
    { id: 'RIB', eventId: 'E1', field: 'injury_type', value: 'rib_fracture', certainty: 'uncertain',
      source: 'description', verification: 'quoted', evidence: '右侧肋骨骨折可疑' },
  ];
  const rejected = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: '十级伤残',
    facts: [], references: modelReferences(uncertainFacts) }, { ...inputs.disability, description }, {
    clauses, requestId: 'unrelated-evidence-rib-disability-reject', model: 'test-model',
    extractedFacts: uncertainFacts, conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  assert.equal(rejected.grade, null);
  assert.ok(rejected.references.every(reference => reference.relation !== 'supports' && reference.evidence === ''));

  const supportedFacts = [
    { id: 'RIB12', eventId: 'E1', field: 'fractured_rib_count', value: 12, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '本次事故后CT明确共12根肋骨骨折' },
    { id: 'MAL6', eventId: 'E1', field: 'clinical_finding', value: '后遗6处畸形愈合', certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '复查确认后遗6处畸形愈合' },
    uncertainFacts[0],
  ];
  const supported = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: '十级伤残',
    facts: [], references: modelReferences(supportedFacts) }, { ...inputs.disability, description, treatmentStatus: 'stable' }, {
    clauses, requestId: 'rib-disability-evidence-rebound-positive', model: 'test-model',
    extractedFacts: supportedFacts, conflicts: [], requiresReview: false, factMissingMaterials: [],
  });
  const reference = supported.references.find(item => item.id === '5.8.3.6');
  assert.equal(supported.grade, '八级伤残');
  assert.equal(reference?.relation, 'supports');
  assert.match(reference?.evidence || '', /12根肋骨骨折/);
  assert.match(reference?.evidence || '', /6处畸形愈合/);
  assert.doesNotMatch(reference?.evidence || '', /头部软组织损伤/);
});

test('postoperative sutured chest wounds are not counted as original traumatic wound lengths', () => {
  const description = '合成资料，非真实病例。左胸另有约2.5cm长刀刺创口；受伤后行胸腹探查和心室修补术。术后活体检验另见胸部正中约20.0cm纵行缝合创口。';
  const result = normalizeExtractedFacts(emptyExtraction, { description });
  const lengths = result.facts.filter(fact => fact.field === 'wound_length_cm');

  assert.ok(lengths.some(fact => fact.value === 2.5));
  assert.equal(lengths.some(fact => fact.value === 20), false);

  const sectionHeadingStyle = '合成资料，非真实病例。手术沿胸部正中切口长约20.0cm，切开皮肤、皮下组织。㈡活体检验：\n伤者神清，胸部正中见20.0cm纵行缝合创口。';
  const sectionFacts = normalizeExtractedFacts(emptyExtraction, { description: sectionHeadingStyle }).facts;
  assert.equal(sectionFacts.some(fact => fact.field === 'wound_length_cm' && fact.value === 20), false);

  const separateEvent = '既往因其他疾病手术沿胸部正中切口长约20cm。此次外伤后法医检查：胸部正中见20cm缝合创口。';
  const separateEventFacts = normalizeExtractedFacts(emptyExtraction, { description: separateEvent }).facts;
  assert.ok(separateEventFacts.some(fact => fact.field === 'wound_length_cm' && fact.value === 20));
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

test('5.9.6.2 stays opaque until vertebral levels and surgery-object linkage are source-verifiable', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.9.6.2');
  assert.equal(clause.conditionLogic.annotation, 'opaque');
  assert.match(clause.conditionLogic.reason, /椎体.*(?:层面|数量).*(?:附件|手术|影像)/u);
});

test('cranial nerve, articular surface, and juvenile physeal composites stay opaque without typed components', () => {
  const clauses = [
    catalogs.injury.clauses.find(item => item.id === '5.1.4.f'),
    catalogs.injury.clauses.find(item => item.id === '5.9.3.f'),
    catalogs.disability.clauses.find(item => item.id === '5.10.6.7'),
  ];
  for (const clause of clauses) {
    assert.equal(clause.conditionLogic.annotation, 'opaque', clause.id);
    assert.ok(clause.conditionLogic.reason.trim(), clause.id);
  }
});

test('traumatic glaucoma surgery clauses verify diagnosis and current-event treatment separately', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.2.12');
  const [glaucomaBranch] = clause.conditionLogic.logic.children;
  assert.equal(glaucomaBranch.op, 'all');
  assert.deepEqual(glaucomaBranch.children.map(child => child.factMatch.field), ['diagnosis', 'treatment']);

  const diagnosis = { id: 'G1', eventId: 'E1', field: 'diagnosis', value: '左眼外伤性青光眼',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '本次事故导致左眼外伤性青光眼' };
  const treatment = { id: 'G2', eventId: 'E1', field: 'treatment', value: '左眼小梁切除术',
    certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '因本次事故导致左眼外伤性青光眼，接受左眼小梁切除术' };
  assert.equal(evaluateConditionLogic(clause.conditionLogic, [diagnosis, treatment]).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [diagnosis, { ...treatment, eventId: 'E2' }]).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [diagnosis, { ...treatment,
    value: '肾修补术', evidence: '因本次事故导致左眼外伤性青光眼，接受肾修补术' }]).met, true);
});

test('a same-organ partial splenectomy cannot satisfy age-specific total-splenectomy clauses', () => {
  const partial = { id: 'SP1', eventId: 'E1', field: 'treatment', value: '脾部分切除术',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '成年人因本次事故接受脾部分切除术' };
  const minorTotal = catalogs.disability.clauses.find(item => item.id === '5.7.4.4');
  const adultTotal = catalogs.disability.clauses.find(item => item.id === '5.8.4.2');
  const partialClause = catalogs.disability.clauses.find(item => item.id === '5.9.4.2');

  assert.notEqual(evaluateConditionLogic(minorTotal.conditionLogic, [partial]).met, true);
  assert.notEqual(evaluateConditionLogic(adultTotal.conditionLogic, [partial]).met, true);
  assert.equal(evaluateConditionLogic(partialClause.conditionLogic, [partial]).met, true);
});

test('ISO-dated current injuries keep later measurements event-bound without merging a second accident', () => {
  const description = '2016-10-06遭酒瓶击伤后右眼受伤，右眼内眦创口长5.5cm。2018-03-12另一次事故后左面部受伤，左面部创口长5.5cm。';
  const facts = normalizeExtractedFacts({ facts: [
    { id: 'D1', field: 'injury_date', value: '2016-10-06', certainty: 'reported', source: 'description',
      evidence: '2016-10-06遭酒瓶击伤后右眼受伤，右眼内眦创口长5.5cm', eventId: 'E1' },
    { id: 'D2', field: 'injury_date', value: '2018-03-12', certainty: 'reported', source: 'description',
      evidence: '2018-03-12另一次事故后左面部受伤，左面部创口长5.5cm', eventId: 'E2' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description }).facts;
  const wounds = facts.filter(fact => fact.field === 'wound_length_cm');

  assert.deepEqual(wounds.map(fact => fact.eventId), ['E1', 'E2']);
  assert.equal(facts.some(fact => fact.field === 'aggregate_wound_length_cm' && fact.value === 11), false);
});

test('forehead scars crossing the hairline count only their verified facial segment', () => {
  const description = '头部被打伤后约1小时就诊，受伤时30周岁。查体见右额部不规则创口约10厘米，皮瓣外翻，深达颅骨，未触及颅骨凹陷；双瞳孔光反射灵敏，耳鼻道无出血。诊断为右额头皮撕脱伤，行清创缝合。2016年8月30日检验见右额部瘢痕长7.8厘米，其中5.0厘米位于发际下；右眉弓上方两道瘢痕，长0.5厘米、0.8厘米。';
  const extraction = normalizeExtractedFacts({ facts: [{ id: 'AGE-I', field: 'age_at_injury_years', value: 30,
    certainty: 'reported', source: 'description', evidence: '受伤时30周岁' }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const facts = extraction.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const gradeOne = catalogs.injury.clauses.find(item => item.id === '5.2.3.a');
  const gradeTwo = catalogs.injury.clauses.find(item => item.id === '5.2.4.a');

  assert.ok(facts.some(fact => fact.field === 'aggregate_wound_length_cm' && fact.value === 6.3));
  assert.notEqual(evaluateConditionLogic(gradeOne.conditionLogic, facts).met, true);
  assert.equal(evaluateConditionLogic(gradeTwo.conditionLogic, facts).met, true);
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
    { assessmentType: 'disability', id: '5.8.6.1', reason: /两个不同椎体均为压缩性骨折且各自压缩程度达到1\/3/u },
    { assessmentType: 'disability', id: '5.10.6.14', reason: /重要血管循环障碍、受累肢体与功能后果/u },
    { assessmentType: 'injury', id: '5.9.2.q', reason: /同一足部除第一趾外三趾.*趾骨—跖骨对应关系/u },
    { assessmentType: 'injury', id: '5.6.3.a', reason: /心脏挫伤、心包积血及二者之间的损伤因果关系/u },
    { assessmentType: 'injury', id: '5.7.2.i', reason: /肾损伤、肾性高血压诊断及损伤因果关系/u },
    { assessmentType: 'injury', id: '5.8.2.g', reason: /重度狭窄的明确诊断或客观检查/u },
    { assessmentType: 'injury', id: '5.9.1.b', reason: /两肢共六个大关节功能完全丧失/u },
    { assessmentType: 'injury', id: '5.10.2.f', reason: /不能分别核验三指数量、拇指排除条件及每指离断平面/u },
    { assessmentType: 'disability', id: '5.7.6.4', reason: /不能分别核验关节名称、肢体归属及每个关节的功能丧失百分比/u },
    { assessmentType: 'disability', id: '5.9.6.6', reason: /不能分别核验左、右前臂的旋转活动及功能丧失百分比/u },
    { assessmentType: 'disability', id: '5.8.6.10', reason: /不能分别核验同一肢体各关节的侧别、关节功能丧失百分比/u },
    { assessmentType: 'disability', id: '5.9.6.11', reason: /不能分别核验同一肢体各关节的侧别、关节功能丧失百分比/u },
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

  const rightKidneyOperation = { id: 'K3', eventId: 'E1', field: 'treatment', value: '右肾切除术',
    certainty: 'reported', source: 'description', verification: 'quoted',
    evidence: '因本次事故导致右肾损伤行右肾切除术，术后记录为一侧肾切除术后' };
  const rightKidneyInjury = { ...sameEventKidneyInjury, id: 'K4', value: '右肾损伤',
    evidence: '本次事故导致右肾损伤' };
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    [rightKidneyOperation, rightKidneyInjury, sameEventKidneyInjury]).met, true);
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

test('alveolar defect needs an independently source-counted four-tooth loss', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.2.26');
  const conclusion = '牙槽骨部分缺损，合并牙齿缺失或者折断4枚以上';
  const bundledDescription = `合成资料，非真实病例。结论记载“${conclusion}”。`;
  const bundledFact = { id: 'A1', eventId: 'E1', field: 'clinical_finding', value: conclusion,
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: conclusion };
  const bundled = normalizeResult({ ...providerFixture('disability'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: conclusion, reasoning: '',
      conditions: [{ condition: clause.text, evidence: conclusion, factIds: ['A1'], met: true }] }] },
  { ...inputs.disability, description: bundledDescription }, { clauses: [clause], requestId: 'alveolar-four-tooth-bundle',
    model: 'test-model', extractedFacts: [bundledFact], conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(bundled.grade, null);

  const description = '合成资料，非真实病例。CT示牙槽骨部分缺损；检查记载4枚牙齿缺失。';
  const facts = normalizeExtractedFacts({ facts: [
    { id: 'A2', eventId: 'E1', field: 'diagnosis', value: '牙槽骨部分缺损', certainty: 'reported',
      source: 'description', evidence: 'CT示牙槽骨部分缺损' },
    { id: 'A3', eventId: 'E1', field: 'dental_loss_count', value: 4, certainty: 'reported',
      source: 'description', evidence: '检查记载4枚牙齿缺失' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, facts).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'dental_loss_count' ? { ...fact, eventId: 'E2' } : fact)).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    facts.map(fact => fact.field === 'dental_loss_count' ? { ...fact, value: 3, evidence: '检查记载3枚牙齿缺失' } : fact)).met, true);
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

test('all, any, and not apply three-valued truth tables without treating unknown as false', () => {
  const factFor = (state, index) => {
    const value = `事实${String.fromCharCode(65 + index)}`;
    const certainty = state === 'true' ? 'reported' : state === 'false' ? 'excluded' : 'uncertain';
    const qualifier = state === 'true' ? '影像证实' : state === 'false' ? '影像明确排除' : '影像考虑';
    return { id: `F${index + 1}`, eventId: 'E1', field: 'clinical_finding', value, certainty,
      source: 'description', verification: 'quoted', evidence: `${qualifier}${value}` };
  };
  const leaf = index => ({ op: 'condition', sourceText: `事实${String.fromCharCode(65 + index)}`,
    conditionText: `事实${String.fromCharCode(65 + index)}`, factMatch: { field: 'clinical_finding',
      values: [`事实${String.fromCharCode(65 + index)}`] } });
  const truth = ['true', 'false', 'unknown'];
  const combineExpected = (op, states) => op === 'all'
    ? states.includes('false') ? false : states.every(state => state === 'true') ? true : null
    : states.includes('true') ? true : states.every(state => state === 'false') ? false : null;

  for (const left of truth) for (const right of truth) {
    const facts = [factFor(left, 0), factFor(right, 1)];
    for (const op of ['all', 'any']) {
      const logic = { annotation: 'explicit', logic: { op, children: [leaf(0), leaf(1)] } };
      assert.equal(evaluateConditionLogic(logic, facts).met, combineExpected(op, [left, right]), `${op}: ${left}, ${right}`);
    }
    const notLogic = { annotation: 'explicit', logic: { op: 'not', children: [leaf(0)] } };
    assert.equal(evaluateConditionLogic(notLogic, [facts[0]]).met,
      left === 'true' ? false : left === 'false' ? true : null, `not: ${left}`);
  }
});

test('surgical difficulty requires a same-event causal link without requiring a performed operation', () => {
  const clause = catalogs.disability.clauses.find(item => item.id === '5.10.4.1');
  const conclusion = '腹壁疝，难以手术修补';
  const conditionFact = { id: 'H1', eventId: 'E1', field: 'clinical_finding', value: conclusion,
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: conclusion };
  const analyze = (facts, description, requestId) => normalizeResult({ ...providerFixture('disability'),
    status: 'preliminary', grade: clause.grade, facts: [], references: [{ clauseId: clause.id, relation: 'supports',
      evidence: conclusion, reasoning: '', conditions: [{ condition: clause.text, evidence: conclusion,
        factIds: facts.map(fact => fact.id), met: true }] }] }, { ...inputs.disability, description },
  { clauses: [clause], requestId, model: 'test-model', extractedFacts: facts, conflicts: [],
    requiresReview: false, factMissingMaterials: [] });
  const missingCause = analyze([conditionFact], `合成资料，非真实病例。${conclusion}。`, 'hernia-cause-missing');
  assert.equal(missingCause.grade, null);

  const causeFact = { id: 'H2', eventId: 'E1', field: 'clinical_finding', value: '因本次事故所致腹壁疝',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: '因本次事故所致腹壁疝' };
  const explicitlyLinked = analyze([conditionFact, causeFact],
    `合成资料，非真实病例。因本次事故所致腹壁疝。${conclusion}。`, 'hernia-cause-same-event');
  assert.equal(explicitlyLinked.grade, clause.grade);
  const crossEvent = analyze([conditionFact, { ...causeFact, eventId: 'E2' }],
    `合成资料，非真实病例。${conclusion}。另次事件因本次事故所致腹壁疝。`, 'hernia-cause-cross-event');
  assert.equal(crossEvent.grade, null);
});

test('combined nasal and maxillary fractures require both typed diagnoses', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.2.4.o');
  const combined = '鼻骨骨折合并上颌骨额突骨折';
  const bundledDescription = `合成资料，非真实病例。鉴定结论记载${combined}。`;
  const bundledFact = { id: 'N1', eventId: 'E1', field: 'clinical_finding', value: combined,
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: combined };
  const bundled = normalizeResult({ ...providerFixture('injury'), status: 'preliminary', grade: clause.grade,
    facts: [], references: [{ clauseId: clause.id, relation: 'supports', evidence: combined, reasoning: '',
      conditions: [{ condition: clause.text, evidence: combined, factIds: ['N1'], met: true }] }] },
  { ...inputs.injury, description: bundledDescription }, { clauses: [clause], requestId: 'nasal-maxillary-composite-alone',
    model: 'test-model', extractedFacts: [bundledFact], conflicts: [], requiresReview: false, factMissingMaterials: [] });
  assert.equal(bundled.grade, null);

  const imagingText = '合成资料，非真实病例。CT示鼻骨骨折合并上颌骨额突骨折。';
  const imagingFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: imagingText }).facts.map(fact => ({ ...fact, verification: 'quoted' }));
  assert.ok(imagingFacts.some(fact => fact.field === 'diagnosis' && /鼻骨骨折/u.test(fact.value)));
  assert.ok(imagingFacts.some(fact => fact.field === 'diagnosis' && /上颌骨额突骨折/u.test(fact.value)));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, imagingFacts).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    imagingFacts.filter(fact => !/上颌骨额突骨折/u.test(fact.value))).met, true);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic,
    imagingFacts.map(fact => /上颌骨额突骨折/u.test(fact.value) ? { ...fact, eventId: 'E2' } : fact)).met, true);

  const uncertainFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: '合成资料，非真实病例。CT示鼻骨骨折合并上颌骨额突骨折可疑。' }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  assert.equal(uncertainFacts.some(fact => fact.field === 'diagnosis' && /上颌骨额突骨折/u.test(fact.value)
    && fact.certainty === 'reported'), false);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, uncertainFacts).met, true);

  const reversedFacts = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description: '合成资料，非真实病例。CT示上颌骨额突骨折合并鼻骨骨折。' }).facts
    .map(fact => ({ ...fact, verification: 'quoted' }));
  assert.ok(reversedFacts.some(fact => fact.field === 'diagnosis' && /鼻骨骨折/u.test(fact.value)));
  assert.ok(reversedFacts.some(fact => fact.field === 'diagnosis' && /上颌骨额突骨折/u.test(fact.value)));
  assert.equal(evaluateConditionLogic(clause.conditionLogic, reversedFacts).met, true);
});

test('assessment scope excludes hand findings without excluding current eye evidence', () => {
  const description = '合成资料，非真实病例。早期左手损伤不属于本次眼部补充评估范围。早期影像明确左手第4掌骨骨折。本次事故后右眼视神经萎缩。';
  const extraction = normalizeExtractedFacts({ facts: [
    { id: 'H1', field: 'diagnosis', value: '左手第4掌骨骨折', certainty: 'reported', source: 'description',
      evidence: '早期影像明确左手第4掌骨骨折' },
    { id: 'E1', field: 'diagnosis', value: '右眼视神经萎缩', certainty: 'reported', source: 'description',
      evidence: '本次事故后右眼视神经萎缩' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

  assert.equal(extraction.facts.some(fact => /左手第4掌骨骨折/u.test(fact.value)), false);
  assert.ok(extraction.facts.some(fact => /右眼视神经萎缩/u.test(fact.value)));
  assert.equal(extraction.scopeText.includes('左手第4掌骨骨折'), false);
  assert.ok(extraction.scopeText.includes('右眼视神经萎缩'));

  const unrelatedCurrentDescription = '合成资料，非真实病例。早期左手损伤不属于本次眼部补充评估范围。2026年本次事故后左手第4掌骨骨折。2026年本次事故后右眼视神经萎缩。';
  const unrelatedCurrent = normalizeExtractedFacts({ facts: [
    { id: 'H3', field: 'diagnosis', value: '左手第4掌骨骨折', certainty: 'reported', source: 'description',
      evidence: '2026年本次事故后左手第4掌骨骨折' },
    { id: 'E2', field: 'diagnosis', value: '右眼视神经萎缩', certainty: 'reported', source: 'description',
      evidence: '2026年本次事故后右眼视神经萎缩' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description: unrelatedCurrentDescription });
  assert.equal(unrelatedCurrent.facts.some(fact => /左手第4掌骨骨折/u.test(fact.value)), false);
  assert.ok(unrelatedCurrent.facts.some(fact => /右眼视神经萎缩/u.test(fact.value)));
  assert.equal(unrelatedCurrent.scopeText.includes('左手第4掌骨骨折'), false);
  assert.ok(unrelatedCurrent.scopeText.includes('右眼视神经萎缩'));

  const currentHandDescription = '合成资料，非真实病例。早期左手损伤不属于本次手部补充评估范围。2026年本次事故后左手第4掌骨骨折。';
  const currentHand = normalizeExtractedFacts({ facts: [{ id: 'H2', field: 'diagnosis', value: '左手第4掌骨骨折',
    certainty: 'reported', source: 'description', evidence: '2026年本次事故后左手第4掌骨骨折' }],
    missingMaterials: [], conflicts: [], requiresReview: false }, { description: currentHandDescription });
  assert.ok(currentHand.facts.some(fact => fact.value === '左手第4掌骨骨折'));
  assert.ok(currentHand.scopeText.includes('左手第4掌骨骨折'));

  const excludedSites = [
    ['既往左上肢损伤不属于本次评估范围。左肱骨骨折。', '左肱骨骨折'],
    ['既往右足损伤不属于本次评估范围。右足第2跖骨骨折。', '右足第2跖骨骨折'],
    ['既往面部损伤不属于本次评估范围。鼻骨骨折。', '鼻骨骨折'],
    ['既往颈部损伤不属于本次评估范围。甲状软骨骨折。', '甲状软骨骨折'],
    ['既往胸部损伤不属于本次评估范围。右肺挫伤。', '右肺挫伤'],
    ['既往生殖器损伤不属于本次评估范围。左侧睾丸挫伤。', '左侧睾丸挫伤'],
  ];
  for (const [text, finding] of excludedSites) {
    const scoped = normalizeExtractedFacts({ facts: [{ id: 'X1', field: 'diagnosis', value: finding,
      certainty: 'reported', source: 'description', evidence: finding }], missingMaterials: [], conflicts: [],
      requiresReview: false }, { description: text });
    assert.equal(scoped.facts.some(fact => fact.value === finding), false, text);
    assert.equal(scoped.scopeText.includes(finding), false, text);
  }
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

test('vulvar wound evidence alone cannot waive the length threshold in 5.8.4.f', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.8.4.f');
  const evidence = '病例记录女性外阴皮肤创口。';
  const fact = { id: 'V1', eventId: 'E1', field: 'clinical_finding', value: '女性外阴皮肤创口',
    certainty: 'reported', source: 'description', verification: 'quoted', evidence };
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, [fact]).met, true);

  const raw = { ...providerFixture('injury'), status: 'preliminary', grade: clause.grade, facts: [], references: [{
    clauseId: clause.id, relation: 'supports', evidence, reasoning: '',
    conditions: [{ condition: clause.text, evidence, factIds: ['V1'], met: true }],
  }] };
  const result = normalizeResult(raw, { ...inputs.injury, description: evidence }, { clauses: [clause],
    requestId: 'vulvar-wound-length-required', model: 'test-model', extractedFacts: [fact], conflicts: [],
    requiresReview: false, factMissingMaterials: [] });
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
