import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';

const extract = description => normalizeExtractedFacts({ facts: [
  { id: 'F-discharge', eventId: 'E1', field: 'treatment', value: '出院', certainty: 'reported',
    source: 'description', evidence: '术后复查CT未见颅内出血' },
], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

test('a treatment value with one unique source sentence is rebound to that evidence and source-scoped event', () => {
  const description = '2015年2月6日受伤后治疗并办理出院。术后复查CT未见颅内出血。';
  const snapshot = extract(description);
  const discharge = snapshot.facts.find(fact => fact.field === 'treatment' && fact.value === '出院');

  assert.ok(discharge);
  assert.equal(discharge.evidence, '2015年2月6日受伤后治疗并办理出院');
  assert.equal(discharge.certainty, 'reported');
  assert.equal(discharge.eventId, 'E1');
  assert.deepEqual(discharge.sourceRefs?.map(reference => reference.evidence), [discharge.evidence]);
});

test('a treatment value with multiple source sentences is not normalized against an unrelated quote', () => {
  const description = '2015年2月6日办理出院。复查后于2月7日出院。术后复查CT未见颅内出血。';
  const snapshot = extract(description);

  assert.equal(snapshot.facts.some(fact => fact.field === 'treatment' && fact.value === '出院'), false);
  assert.deepEqual(snapshot.factAudit.find(item => item.rawFactId === 'F-discharge')?.reasonCode,
    'canonicalization_rejected');
});
