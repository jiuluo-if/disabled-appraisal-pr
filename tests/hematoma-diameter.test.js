import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

const extract = description => normalizeExtractedFacts({ facts: [], missingMaterials: [], conflicts: [], requiresReview: false },
  { description });

test('liver and spleen hematoma diameter thresholds use source-linked measurements and centimeter normalization', () => {
  const liver = extract('CT示肝脏实质内血肿直径25mm。');
  const liverMeasure = liver.facts.find(fact => fact.field === 'organ_hematoma_diameter_cm');
  assert.equal(liverMeasure?.value, 2.5);
  assert.equal(liverMeasure?.verification, 'quoted');
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(clause => clause.id === '5.7.3.b').conditionLogic,
    liver.facts).met, true);
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(clause => clause.id === '5.7.3.c').conditionLogic,
    liver.facts).met, null);

  const variant = extract('CT示肝实质血肿直径二十五毫米。');
  assert.equal(variant.facts.find(fact => fact.field === 'organ_hematoma_diameter_cm')?.value, 2.5);
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(clause => clause.id === '5.7.3.b').conditionLogic,
    variant.facts).met, true);

  const spleen = extract('CT示脾实质内血肿直径2.0cm。');
  assert.equal(evaluateConditionLogic(catalogs.injury.clauses.find(clause => clause.id === '5.7.3.c').conditionLogic,
    spleen.facts).met, true);
});

test('subthreshold, uncertain, and historical hematoma measurements do not satisfy the size criterion', () => {
  const clause = catalogs.injury.clauses.find(item => item.id === '5.7.3.b');
  const predicate = clause.conditionLogic.logic.children.find(node => node.predicate);
  for (const description of [
    'CT示肝脏实质内血肿直径1.9cm。',
    'CT示肝脏实质内血肿直径约2.5cm。',
    '既往CT示肝脏实质内血肿直径2.5cm。',
    'CT示脾实质内血肿直径2.5cm。',
  ]) {
    const snapshot = extract(description);
    const result = evaluateConditionLogic({ annotation: 'explicit', logic: predicate }, snapshot.facts);
    assert.notEqual(result.met, true, description);
  }
});

test('a model cannot raise the verified hematoma diameter above the value in the source', () => {
  const description = 'CT示肝脏实质内血肿直径2.5cm。';
  const snapshot = normalizeExtractedFacts({ facts: [{ id: 'F-claim', eventId: 'E1',
    field: 'organ_hematoma_diameter_cm', value: 3, certainty: 'reported', source: 'description',
    evidence: description.slice(0, -1) }], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

  assert.equal(snapshot.facts.some(fact => fact.field === 'organ_hematoma_diameter_cm' && fact.value === 3), false);
  assert.equal(snapshot.facts.some(fact => fact.field === 'organ_hematoma_diameter_cm' && fact.value === 2.5), true);
  assert.equal(snapshot.factAudit.find(item => item.rawFactId === 'F-claim')?.status, 'excluded');
  assert.equal(snapshot.factAudit.find(item => item.rawFactId === 'F-claim')?.gradeEligible, false);
});
