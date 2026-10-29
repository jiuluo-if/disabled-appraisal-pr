import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtractedFacts, sourceReferenceMatches } from '../gemini/lib/facts.js';

test('source references verify the exact quote occurrence when a quote repeats', () => {
  const description = '初次检查：CT记录颅骨骨折。复查CT记录颅骨骨折。';
  const quote = 'CT记录颅骨骨折';
  const secondStart = description.lastIndexOf(quote);
  const valid = { source: 'description', sourceId: 'description', evidence: quote,
    normalizedStart: secondStart, normalizedEnd: secondStart + quote.length };
  const misplaced = { ...valid, normalizedStart: 0, normalizedEnd: quote.length };

  assert.equal(sourceReferenceMatches(valid, { description }), true);
  assert.equal(sourceReferenceMatches(misplaced, { description }), false);
  assert.equal(sourceReferenceMatches({ ...valid, positions: [] }, { description }), false);
  assert.equal(sourceReferenceMatches({ ...valid, positionsComplete: false }, { description }), false);
});

test('duplicate OCR page labels retain every quote position without claiming a page number', () => {
  const quote = '检查记录显示双侧对称';
  const recognizedText = `【图片1】\n${quote}。\n\n【图片1】\n${quote}。`;
  const snapshot = normalizeExtractedFacts({ facts: [{ id: 'F1', field: 'diagnosis', value: '双侧对称',
    certainty: 'reported', source: 'image', evidence: quote }], missingMaterials: [], conflicts: [], requiresReview: false },
  { recognizedText });
  const [reference] = snapshot.facts.find(fact => fact.field === 'diagnosis').sourceRefs;

  assert.equal(reference.sourceId, null);
  assert.equal(reference.positions.length, 2);
  assert.equal(sourceReferenceMatches(reference, { recognizedText }), true);
  assert.equal(sourceReferenceMatches({ ...reference, positions: [{ normalizedStart: 0, normalizedEnd: quote.length }] },
    { recognizedText }), false);
});
