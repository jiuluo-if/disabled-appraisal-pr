import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../gemini/lib/assessment.js';

test('a supported lower grade does not skip review of a recalled higher-grade candidate', async () => {
  const calls = [];
  const requests = [];
  const provider = { complete: async request => {
    calls.push(request.name);
    requests.push(request);
    if (request.name === 'fact_extraction') return { facts: [
      { id: 'F1', field: 'injury_type', value: 'skull_depressed_fracture', certainty: 'reported',
        source: 'description', evidence: 'CT明确记载颅骨凹陷性骨折', eventId: 'E1' },
    ], missingMaterials: [], conflicts: [], requiresReview: false };
    return { status: 'insufficient', grade: null, summary: '较高等级候选条件待核',
      reasoning: '没有足够原文证明更高条款的全部条件。', facts: [], references: [],
      missingMaterials: [], nextSteps: [], warnings: [] };
  } };

  const result = await assess({ assessmentType: 'injury',
    description: 'CT明确记载颅骨凹陷性骨折。', images: [], injuryDate: '', treatmentStatus: 'unknown' },
  { provider, config: { textModel: 'test-text', visionModel: 'test-vision' }, requestId: 'higher-grade-review' });

  assert.deepEqual(calls, ['fact_extraction', 'assessment_result']);
  const payload = JSON.parse(requests[1].messages[1].content.match(/<verified_facts>\s*([\s\S]*?)\s*<\/verified_facts>/u)[1]);
  assert.ok(payload.reviewConditions.some(item => item.clauseId === '5.1.2.c'));
  assert.equal(result.status, 'insufficient');
  assert.equal(result.grade, null);
  assert.equal(result.references.find(reference => reference.id === '5.1.2.c')?.relation, 'incomplete');
  assert.equal(result.references.some(reference => reference.grade === '重伤二级'
    && reference.relation === 'supports'), false);
});
