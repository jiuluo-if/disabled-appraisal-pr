import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../gemini/lib/assessment.js';
import { logicFactFields } from '../gemini/lib/condition-fields.js';
import { retrieveClauses } from '../gemini/lib/catalog.js';
import { includesEvidence } from '../gemini/lib/results.js';
import { normalizeForMatching } from '../gemini/lib/text-normalization.js';

test('rule evidence matching shares NFKC, whitespace, and Latin case normalization', () => {
  assert.equal(normalizeForMatching('ＣＴ报告 记载5.0CM2'), 'ct报告记载5.0cm2');
  assert.equal(includesEvidence('ＣＴ报告 记载5.0CM2', 'ct报告记载5.0cm2'), true);
});

test('assessment candidates inherit the same clinical-finding field aliases as rule evaluation', () => {
  const fields = logicFactFields({ op: 'condition', factMatch: { field: 'clinical_finding' } });

  assert.deepEqual([...fields].sort(), ['clinical_finding', 'diagnosis', 'functional_impairment',
    'imaging_finding', 'injury_type', 'symptom', 'treatment'].sort());
});

test('fact retrieval includes clauses whose clinical finding accepts a normalized diagnosis field', () => {
  const fact = { field: 'diagnosis', value: '心脏破裂', certainty: 'reported', source: 'description',
    evidence: '手术记录记载心脏破裂', verification: 'quoted', eventId: 'E1' };
  const clauses = retrieveClauses('injury', '无关描述', 0, [fact]);

  assert.ok(clauses.some(clause => clause.id === '5.6.2.b'));
});

test('fact retrieval includes confirmedBy evidence used by a not-condition', () => {
  const fact = { field: 'diagnosis', value: '眶底骨折', certainty: 'reported', source: 'description',
    evidence: '影像诊断眶底骨折', verification: 'quoted', eventId: 'E1' };
  const clauses = retrieveClauses('injury', '无关描述', 0, [fact]);

  assert.ok(clauses.some(clause => clause.id === '5.2.4.f'));
});

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
