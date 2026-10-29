import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { normalizeExtractedFacts, sourceReferenceMatches } from '../gemini/lib/facts.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

const thresholds = [
  ['5.9.2.a', 50],
  ['5.9.3.a', 25],
  ['5.9.4.a', 10],
];

const condition = id => catalogs.injury.clauses.find(clause => clause.id === id).conditionLogic;
const jointFact = ({ id = 'F1', joint = '膝', side = '左', value = 50, certainty = 'reported', eventId = 'E1', extra = '' } = {}) => ({
  id, field: 'joint_function_loss_percent', value, certainty, source: 'description', verification: 'quoted', eventId,
  evidence: `本次事故后${side}${joint}关节功能丧失${value}%${extra}`,
});

test('injury joint-loss thresholds accept typed measurements at their inclusive boundaries', () => {
  for (const [id, threshold] of thresholds) {
    const fact = jointFact({ value: threshold });
    assert.equal(evaluateConditionLogic(condition(id), [fact]).met, true, id);
  }
});

test('typed joint measurements preserve the model proposal and verified source position', () => {
  const description = '本次事故后左膝关节功能丧失50%。';
  const snapshot = normalizeExtractedFacts({ facts: [{ id: 'F-joint', eventId: 'E1',
    field: 'joint_function_loss_percent', value: 50, certainty: 'reported', source: 'description', evidence: description }],
  missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const fact = snapshot.facts.find(item => item.field === 'joint_function_loss_percent');
  const audit = snapshot.factAudit.find(item => item.rawFactId === 'F-joint');

  assert.equal(fact.value, 50);
  assert.equal(audit.proposedValue, 50);
  assert.equal(audit.gradeEligible, true);
  assert.equal(sourceReferenceMatches(fact.sourceRefs[0], { description }), true);
  assert.equal(evaluateConditionLogic(condition('5.9.2.a'), [fact]).met, true);
});

test('legacy clinical findings remain source-verified while generic joint conclusions stay insufficient', () => {
  const legacyFinding = { id: 'F-legacy', field: 'clinical_finding', value: '左膝关节功能丧失50%',
    certainty: 'reported', source: 'description', verification: 'quoted', eventId: 'E1',
    evidence: '本次事故后左膝关节功能丧失50%' };
  const genericConclusion = { ...legacyFinding, value: '四肢任一大关节功能丧失50％以上',
    evidence: '本次事故后四肢任一大关节功能丧失50％以上' };

  assert.equal(evaluateConditionLogic(condition('5.9.2.a'), [legacyFinding]).met, true);
  assert.notEqual(evaluateConditionLogic(condition('5.9.2.a'), [genericConclusion]).met, true);
});

test('joint-loss predicates reject wrong site, below-threshold, approximate, and upper-bound evidence', () => {
  const cases = [
    ['5.9.2.a', jointFact({ joint: '髋臼', value: 60 })],
    ['5.9.2.a', jointFact({ value: 49 })],
    ['5.9.2.a', jointFact({ value: 60, extra: '约' })],
    ['5.9.2.a', { ...jointFact({ value: 60 }), evidence: '本次事故后左膝关节功能丧失60%以下' }],
  ];
  for (const [id, fact] of cases) assert.notEqual(evaluateConditionLogic(condition(id), [fact]).met, true, id);
});

test('same-joint conflicting percentages remain unknown, while distinct joints do not cross-conflict', () => {
  const logic = condition('5.9.2.a');
  const sameJoint = [jointFact({ value: 50 }), jointFact({ id: 'F2', value: 60 })];
  assert.equal(evaluateConditionLogic(logic, sameJoint).met, null);
  const uncertainSameJoint = [jointFact({ value: 50 }), jointFact({ id: 'F3', value: 60, certainty: 'uncertain' })];
  assert.equal(evaluateConditionLogic(logic, uncertainSameJoint).met, null);

  const separateJoints = [jointFact({ value: 50 }), jointFact({ id: 'F2', joint: '肩', value: 30 })];
  assert.equal(evaluateConditionLogic(logic, separateJoints).met, true);
  const oppositeSides = [jointFact({ value: 50 }), jointFact({ id: 'F3', side: '右', value: 30 })];
  assert.equal(evaluateConditionLogic(logic, oppositeSides).met, true);
});

