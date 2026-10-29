import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

test('a rib fracture described as "为可疑" cannot become a confirmed clause fact', () => {
  const evidence = '右侧肋骨骨折为可疑';
  const description = `CT报告提示${evidence}，建议进一步三维检查。`;
  const snapshot = normalizeExtractedFacts({ facts: [
    { id: 'F-rib', field: 'injury_type', value: 'rib_fracture', certainty: 'reported',
      source: 'description', evidence, eventId: 'E1' },
  ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });
  const ribFacts = snapshot.facts.filter(fact => fact.field === 'injury_type' && fact.value === 'rib_fracture');
  const clause = catalogs.injury.clauses.find(item => item.id === '5.6.5.a');

  assert.ok(ribFacts.length > 0);
  assert.ok(ribFacts.every(fact => fact.certainty === 'uncertain'));
  assert.equal(snapshot.factAudit.find(item => item.rawFactId === 'F-rib')?.gradeEligible, false);
  assert.notEqual(evaluateConditionLogic(clause.conditionLogic, snapshot.facts).met, true);
});
