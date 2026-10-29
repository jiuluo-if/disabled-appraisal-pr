import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../gemini/lib/assessment.js';

const config = { textModel: 'test-text', visionModel: 'test-vision' };
const input = {
  assessmentType: 'injury',
  description: 'CT报告明确记载左侧第3、4肋骨骨折，共2处骨折，均为本次外伤导致，无既往损伤。',
  images: [], injuryDate: '', treatmentStatus: 'unknown',
};

test('complete source-verified criteria skip the assessment model call', async () => {
  const calls = [];
  let extractionRequest;
  const provider = { complete: async request => {
    calls.push(request.name);
    extractionRequest = request;
    assert.equal(request.name, 'fact_extraction');
    return { facts: [
      { id: 'F1', field: 'injury_type', value: 'rib_fracture', certainty: 'reported',
        source: 'description', evidence: '左侧第3、4肋骨骨折', eventId: 'E1' },
      { id: 'F2', field: 'fracture_site_count', value: 2, certainty: 'reported',
        source: 'description', evidence: '共2处骨折', eventId: 'E1' },
    ], missingMaterials: [], conflicts: [], requiresReview: false };
  } };

  const result = await assess(input, { provider, config, requestId: 'deterministic-short-circuit' });

  assert.deepEqual(calls, ['fact_extraction']);
  assert.equal(result.status, 'preliminary');
  assert.equal(result.grade, '轻伤二级');
  assert.equal(result.analysisSnapshot?.rules.length, 64);
  assert.match(result.analysisSnapshot?.snapshotId, /^[a-f0-9]{64}$/u);
  assert.ok(result.references.some(reference => reference.relation === 'supports'
    && reference.grade === result.grade));
  const extractionPayload = JSON.parse(extractionRequest.messages[1].content);
  assert.equal('assessmentContext' in extractionPayload, false);
  assert.doesNotMatch(extractionRequest.messages[0].content, /assessmentContext\.selectedInjuryDate/u);

  const repeated = await assess(input, { provider, config, requestId: 'deterministic-short-circuit-repeat' });
  assert.equal(repeated.grade, result.grade);
  assert.equal(repeated.analysisSnapshot.snapshotId, result.analysisSnapshot.snapshotId);
  assert.deepEqual(calls, ['fact_extraction', 'fact_extraction']);
});

test('a grade-changing missing condition requests only a targeted model review', async () => {
  const calls = [];
  const requests = [];
  const provider = { complete: async request => {
    calls.push(request.name);
    requests.push(request);
    if (request.name === 'fact_extraction') {
      return { facts: [
        { id: 'M1', field: 'injury_type', value: 'rib_fracture', certainty: 'reported',
          source: 'description', evidence: '左侧第3肋骨骨折', eventId: 'E1' },
        { id: 'M2', field: 'fractured_rib_numbers', value: [3], certainty: 'reported',
          source: 'description', evidence: '左侧第3肋骨骨折', eventId: 'E1' },
      ], missingMaterials: [], conflicts: [], requiresReview: false };
    }
    return { status: 'insufficient', grade: null, summary: '资料不足', reasoning: '未发现可核验条款',
      facts: [], references: [], missingMaterials: [], nextSteps: [], warnings: [] };
  } };

  const result = await assess({ ...input, description: 'CT报告明确记载左侧第3肋骨骨折。' },
    { provider, config, requestId: 'assessment-review-fallback' });

  assert.deepEqual(calls, ['fact_extraction', 'assessment_result']);
  assert.notEqual(result.status, 'preliminary');
  assert.equal(result.grade, null);
  const reviewPayload = JSON.parse(requests[1].messages[1].content.match(/<verified_facts>\s*([\s\S]*?)\s*<\/verified_facts>/u)[1]);
  assert.equal(reviewPayload.facts.length, 1);
  assert.ok(reviewPayload.reviewConditions.some(item => item.clauseId === '5.6.4.b'));
  assert.match(requests[1].messages[0].content, /只复核待核条件/u);
});

test('facts with no grade-relevant rule candidate return insufficiency without a blind second call', async () => {
  const calls = [];
  const provider = { complete: async request => {
    calls.push(request.name);
    return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
  } };

  const result = await assess({ ...input, description: '目前资料尚未提供诊断或检查结果。' },
    { provider, config, requestId: 'no-relevant-candidate' });

  assert.deepEqual(calls, ['fact_extraction']);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.grade, null);
});

test('selected injury date reaches fact extraction as non-evidentiary event scope context', async () => {
  let extractionRequest;
  const provider = { complete: async request => {
    extractionRequest = request;
    return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
  } };

  await assess({ ...input, description: '当前材料尚未提供诊断或检查结果。', injuryDate: '2025-05-12' },
    { provider, config, requestId: 'selected-injury-date-context' });

  const payload = JSON.parse(extractionRequest.messages[1].content);
  assert.deepEqual(payload.assessmentContext, { selectedInjuryDate: '2025-05-12' });
  assert.doesNotMatch(payload.description, /2025-05-12/u);
  assert.match(extractionRequest.messages[0].content, /selectedInjuryDate 是用户选择的范围提示，不是原文证据/u);
});

test('a source-matched injury date permits deterministic grading of only that event', async () => {
  const calls = [];
  const provider = { complete: async request => {
    calls.push(request.name);
    return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
  } };
  const description = '2014年1月1日交通事故后左侧第3肋骨骨折、左侧第4肋骨骨折，共2处骨折。2020年2月2日交通事故后头部受伤，CT示外伤性蛛网膜下腔出血、脑挫裂伤，入院昏迷，GCS评分5分。';

  const result = await assess({ ...input, description, injuryDate: '2014-01-01' },
    { provider, config, requestId: 'selected-event-deterministic-grade' });

  assert.deepEqual(calls, ['fact_extraction']);
  assert.equal(result.status, 'preliminary');
  assert.equal(result.grade, '轻伤二级');
  const support = result.references.find(reference => reference.id === '5.6.4.b');
  assert.equal(support?.relation, 'supports');
  assert.ok(support.conditions.flatMap(condition => condition.factIds || []).every(id =>
    result.facts.find(fact => fact.id === id)?.eventId === 'E1'));
  assert.ok(result.facts.some(fact => fact.eventId === 'E2'));
});
