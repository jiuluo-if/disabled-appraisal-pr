import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, retrieveClauses } from '../gemini/lib/catalog.js';
import { normalizeResult } from '../gemini/lib/results.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { inputs, providerFixture } from './fixtures.js';

test('a selected injury date scopes grading to its verified event when other dated events are present', () => {
  const description = '2014年1月1日交通事故后左侧第3肋骨骨折、左侧第4肋骨骨折，共2处骨折。2020年2月2日交通事故后头部受伤。';
  const extracted = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description });
  const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const clause = catalogs.injury.clauses.find(item => item.id === '5.6.4.b');
  const evaluate = injuryDate => normalizeResult({ ...providerFixture('injury'), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description, injuryDate }, {
    clauses: retrieveClauses('injury', description, 40, facts), requestId: `selected-event-${injuryDate || 'unset'}`,
    model: 'test-model', extractedFacts: facts, conflicts: extracted.conflicts,
    requiresReview: extracted.requiresReview, reviewReasons: extracted.reviewReasons,
    factMissingMaterials: extracted.missingMaterials,
  });

  const selected = evaluate('2014-01-01');
  assert.equal(selected.status, 'preliminary');
  assert.equal(selected.grade, clause.grade);
  const reference = selected.references.find(item => item.id === clause.id);
  assert.equal(reference?.relation, 'supports');
  assert.ok(reference.conditions.flatMap(condition => condition.factIds || []).every(id =>
    facts.find(fact => fact.id === id)?.eventId === 'E1'));

  const ambiguous = evaluate('');
  assert.equal(ambiguous.status, 'needs_review');
  assert.equal(ambiguous.grade, null);

  const mismatched = evaluate('2015-07-01');
  assert.equal(mismatched.status, 'needs_review');
  assert.equal(mismatched.grade, null);
});

test('a selected date cannot resolve two explicitly separate incidents on the same day', () => {
  const description = '2025年5月12日交通事故后左侧第3肋骨骨折、左侧第4肋骨骨折，共2处骨折；另一次交通事故发生于2025年5月12日，头部受伤。';
  const extracted = normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
    { description });
  const facts = extracted.facts.map(fact => ({ ...fact, verification: 'quoted' }));
  const result = normalizeResult({ ...providerFixture('injury'), status: 'insufficient', grade: null,
    facts: [], references: [] }, { ...inputs.injury, description, injuryDate: '2025-05-12' }, {
    clauses: retrieveClauses('injury', description, 40, facts), requestId: 'same-day-separate-incidents',
    model: 'test-model', extractedFacts: facts, conflicts: extracted.conflicts,
    requiresReview: extracted.requiresReview, reviewReasons: extracted.reviewReasons,
    factMissingMaterials: extracted.missingMaterials,
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.grade, null);
  assert.ok(facts.some(fact => fact.eventId === 'E1'));
  assert.ok(facts.some(fact => fact.eventId === 'E2'));
});
