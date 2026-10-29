import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { normalizeResult } from '../gemini/lib/results.js';
import { inputs, providerFixture } from './fixtures.js';

test('an unrelated fact conflict does not block a fully supported clause', () => {
  const description = '诊断记载外伤性脑脓肿。报告记载头痛；复查未见头痛。';
  const facts = [
    { id: 'F1', field: 'clinical_finding', value: '外伤性脑脓肿', certainty: 'reported',
      source: 'description', evidence: '诊断记载外伤性脑脓肿', verification: 'quoted', eventId: 'E1' },
    { id: 'F2', field: 'symptom', value: '头痛', certainty: 'reported', source: 'description',
      evidence: '报告记载头痛', verification: 'quoted', eventId: 'E1' },
    { id: 'F3', field: 'symptom', value: '头痛', certainty: 'excluded', source: 'description',
      evidence: '复查未见头痛', verification: 'quoted', eventId: 'E1' },
  ];
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.j');
  const result = normalizeResult({ ...providerFixture(), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'unrelated-conflict-test', model: 'test-model', extractedFacts: facts,
    conflicts: [{ factIds: ['F2', 'F3'], reason: '头痛状态相互矛盾。' }], requiresReview: true,
    factMissingMaterials: [],
  });

  assert.equal(result.status, 'preliminary');
  assert.equal(result.grade, clause.grade);
  assert.equal(result.requiresReview, false);
  assert.equal(result.conflicts.length, 1);
});

test('a conflict on the decisive finding keeps the grade in manual review', () => {
  const description = '诊断记载外伤性脑脓肿；复查未见外伤性脑脓肿。';
  const facts = [
    { id: 'F1', field: 'clinical_finding', value: '外伤性脑脓肿', certainty: 'reported',
      source: 'description', evidence: '诊断记载外伤性脑脓肿', verification: 'quoted', eventId: 'E1' },
    { id: 'F2', field: 'clinical_finding', value: '外伤性脑脓肿', certainty: 'excluded',
      source: 'description', evidence: '复查未见外伤性脑脓肿', verification: 'quoted', eventId: 'E1' },
  ];
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.j');
  const result = normalizeResult({ ...providerFixture(), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'decisive-conflict-test', model: 'test-model', extractedFacts: facts,
    conflicts: [{ factIds: ['F1', 'F2'], reason: '诊断与复查结果相反。' }], requiresReview: true,
    factMissingMaterials: [],
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.grade, null);
  assert.equal(result.requiresReview, true);
});

test('a lower-grade conflict does not block an independently supported higher grade', () => {
  const description = '诊断记载外伤性脑脓肿。CT记载左侧第3肋骨骨折；复查未见左侧第3肋骨骨折。';
  const facts = [
    { id: 'F1', field: 'clinical_finding', value: '外伤性脑脓肿', certainty: 'reported',
      source: 'description', evidence: '诊断记载外伤性脑脓肿', verification: 'quoted', eventId: 'E1' },
    { id: 'F2', field: 'injury_type', value: 'rib_fracture', certainty: 'reported', source: 'description',
      evidence: 'CT记载左侧第3肋骨骨折', verification: 'quoted', eventId: 'E1' },
    { id: 'F3', field: 'injury_type', value: 'rib_fracture', certainty: 'excluded', source: 'description',
      evidence: '复查未见左侧第3肋骨骨折', verification: 'quoted', eventId: 'E1' },
  ];
  const clause = catalogs.injury.clauses.find(item => item.id === '5.1.2.j');
  const result = normalizeResult({ ...providerFixture(), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description }, {
    clauses: [clause], requestId: 'lower-grade-conflict-test', model: 'test-model', extractedFacts: facts,
    conflicts: [{ factIds: ['F2', 'F3'], reason: '肋骨骨折记载存在冲突。' }], requiresReview: true,
    factMissingMaterials: [],
  });

  assert.equal(result.status, 'preliminary');
  assert.equal(result.grade, clause.grade);
  assert.equal(result.requiresReview, false);
});
