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
  const provider = { complete: async request => {
    calls.push(request.name);
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
  assert.ok(result.references.some(reference => reference.relation === 'supports'
    && reference.grade === result.grade));
});

test('incomplete facts still request targeted model assessment', async () => {
  const calls = [];
  const provider = { complete: async request => {
    calls.push(request.name);
    if (request.name === 'fact_extraction') {
      return { facts: [], missingMaterials: [], conflicts: [], requiresReview: false };
    }
    return { status: 'insufficient', grade: null, summary: '资料不足', reasoning: '未发现可核验条款',
      facts: [], references: [], missingMaterials: [], nextSteps: [], warnings: [] };
  } };

  const result = await assess({ ...input, description: '病历资料已提交。' },
    { provider, config, requestId: 'assessment-review-fallback' });

  assert.deepEqual(calls, ['fact_extraction', 'assessment_result']);
  assert.notEqual(result.status, 'preliminary');
  assert.equal(result.grade, null);
});
