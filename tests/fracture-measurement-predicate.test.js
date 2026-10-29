import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, retrieveClauses } from '../gemini/lib/catalog.js';
import { normalizeExtractedFacts, sourceReferenceMatches } from '../gemini/lib/facts.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

const clause = id => catalogs.injury.clauses.find(item => item.id === id);

function factsFor({ bone, value, evidence, eventId = 'E1', certainty = 'reported' }) {
  return [
    { id: 'F-fracture', field: 'clinical_finding', value: `${bone}骨折`, certainty: 'reported',
      source: 'description', evidence: `本次事故造成${bone}骨折`, eventId, verification: 'quoted' },
    { id: 'F-shortening', field: 'bone_shortening_cm', value, certainty, source: 'description',
      evidence, eventId, verification: 'quoted' },
  ];
}

test('femoral shaft shortening is checked as a quoted numeric threshold', () => {
  const rule = clause('5.9.2.g');
  const factSet = factsFor({ bone: '股骨干', value: 6,
    evidence: '本次事故造成右股骨干骨折，骨折缩短6cm。' });

  assert.equal(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
});

test('tibial shaft shortening is checked as a quoted numeric threshold', () => {
  const rule = clause('5.9.2.h');
  const factSet = factsFor({ bone: '胫腓骨', value: 5,
    evidence: '本次事故造成右胫腓骨骨折，骨折缩短5cm。' });

  assert.equal(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
});

test('typed shortening facts recall the relevant rule independently of lexical ranking', () => {
  const factSet = factsFor({ bone: '股骨干', value: 6,
    evidence: '本次事故造成右股骨干骨折，骨折缩短6cm。' });
  const candidates = retrieveClauses('injury', '', 0, factSet).map(item => item.id);

  assert.ok(candidates.includes('5.9.2.g'));
  assert.ok(candidates.includes('5.9.2.h'));
});

test('bone shortening accepts a verified millimetre measurement after unit conversion', () => {
  const rule = clause('5.9.2.g');
  const factSet = factsFor({ bone: '股骨干', value: 5,
    evidence: '本次事故造成右股骨干骨折，骨折缩短50mm。' });

  assert.equal(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
});

test('an explicit lower bound can support the threshold only when the bound reaches it', () => {
  const rule = clause('5.9.2.g');
  const atThreshold = factsFor({ bone: '股骨干', value: 5,
    evidence: '本次事故造成右股骨干骨折，骨折缩短5cm以上。' });
  const belowThreshold = factsFor({ bone: '股骨干', value: 4.9,
    evidence: '本次事故造成右股骨干骨折，骨折缩短4.9cm以上。' });

  assert.equal(evaluateConditionLogic(rule.conditionLogic, atThreshold).met, true);
  assert.notEqual(evaluateConditionLogic(rule.conditionLogic, belowThreshold).met, true);
});

test('bone angulation is checked numerically at the inclusive 30 degree boundary', () => {
  const rule = clause('5.9.2.g');
  const factSet = [
    { id: 'F-fracture', field: 'clinical_finding', value: '股骨干骨折', certainty: 'reported',
      source: 'description', evidence: '本次事故造成右股骨干骨折', eventId: 'E1', verification: 'quoted' },
    { id: 'F-angle', field: 'bone_angulation_degrees', value: 30, certainty: 'reported', source: 'description',
      evidence: '本次事故造成右股骨干骨折，成角畸形30°。', eventId: 'E1', verification: 'quoted' },
  ];

  assert.equal(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
  factSet[1] = { ...factSet[1], evidence: '本次事故造成右股骨干骨折，成角畸形30o以上。' };
  assert.equal(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
  factSet[1] = { ...factSet[1], value: 29, evidence: '本次事故造成右股骨干骨折，成角畸形29°。' };
  assert.notEqual(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
});

test('shortening below threshold, approximate, upper-bounded, or attributed to another bone cannot support the clause', () => {
  const rule = clause('5.9.2.g');
  for (const item of [
    { bone: '股骨干', value: 4.9, evidence: '本次事故造成右股骨干骨折，骨折缩短4.9cm。' },
    { bone: '股骨干', value: 5.2, evidence: '本次事故造成右股骨干骨折，骨折缩短约5.2cm。' },
    { bone: '股骨干', value: 5.2, evidence: '本次事故造成右股骨干骨折，骨折缩短5.2cm以下。' },
    { bone: '股骨干', value: 5.1, evidence: '本次事故造成右股骨干骨折，骨折缩短4.9cm，另记5.1cm。' },
    { bone: '股骨干', value: 6, evidence: '本次事故造成股骨干骨折；另记右胫腓骨骨折缩短6cm。' },
    { bone: '胫腓骨', value: 6, evidence: '本次事故造成右胫腓骨骨折，骨折缩短6cm。' },
  ]) {
    assert.notEqual(evaluateConditionLogic(rule.conditionLogic, factsFor(item)).met, true, item.evidence);
  }
});

test('fracture shortening and the matching fracture must belong to the same event', () => {
  const rule = clause('5.9.2.g');
  const factSet = factsFor({ bone: '股骨干', value: 6,
    evidence: '本次事故造成右股骨干骨折，骨折缩短6cm。', eventId: 'E2' });
  factSet[0].eventId = 'E1';

  assert.notEqual(evaluateConditionLogic(rule.conditionLogic, factSet).met, true);
});

test('normalized measurement facts retain the original proposal and a verifiable source position', () => {
  const description = '本次事故造成右股骨干骨折，骨折缩短6cm。';
  const snapshot = normalizeExtractedFacts({ facts: [
    { id: 'F1', eventId: 'E1', field: 'bone_shortening_cm', value: 6, certainty: 'reported',
      source: 'description', evidence: '本次事故造成右股骨干骨折，骨折缩短6cm' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const fact = snapshot.facts.find(item => item.field === 'bone_shortening_cm');
  const audit = snapshot.factAudit.find(item => item.rawFactId === 'F1');

  assert.equal(fact.value, 6);
  assert.equal(audit.proposedValue, 6);
  assert.deepEqual(audit.normalizedFactIds, [fact.id]);
  assert.equal(audit.gradeEligible, true);
  assert.equal(fact.sourceRefs.length, 1);
  assert.equal(sourceReferenceMatches(fact.sourceRefs[0], { description }), true);
});
