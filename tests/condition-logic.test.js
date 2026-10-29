import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConditionTree } from '../gemini/lib/condition-logic.js';

const condition = field => ({ op: 'condition', sourceText: field, conditionText: field,
  factMatch: { field } });
const combine = (op, states) => {
  const facts = states.flatMap(([field, met], index) => met === undefined ? [] : [{
    id: `F${index + 1}`, eventId: 'E1', field, value: met,
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: `${field} evidence`,
  }]);
  const evaluateLeaf = (node, scopedFacts) => {
    const fact = scopedFacts.find(item => item.field === node.factMatch.field);
    return fact ? { met: fact.value, evidence: fact.evidence, factIds: [fact.id] }
      : { met: null, evidence: '', factIds: [] };
  };
  return evaluateConditionTree({ annotation: 'explicit', logic: { op,
    children: states.map(([field]) => condition(field)) } }, facts, evaluateLeaf);
};

test('generic condition tree preserves three-valued all and any logic', () => {
  assert.equal(combine('all', [['a', true], ['b', null]]).met, null);
  assert.equal(combine('all', [['a', true], ['b', false]]).met, false);
  assert.equal(combine('all', [['a', true], ['b', true]]).met, true);
  assert.equal(combine('any', [['a', false], ['b', null]]).met, null);
  assert.equal(combine('any', [['a', false], ['b', true]]).met, true);
  assert.equal(combine('any', [['a', false], ['b', false]]).met, false);
});

test('generic not condition keeps unknown distinct from false', () => {
  const evaluateLeaf = (_node, facts) => facts.length
    ? { met: facts[0].value, evidence: facts[0].evidence, factIds: [facts[0].id] }
    : { met: null, evidence: '', factIds: [] };
  const evaluate = value => evaluateConditionTree({ annotation: 'explicit', logic: {
    op: 'not', sourceText: 'not a', conditionText: 'not a', children: [condition('a')],
  } }, value === undefined ? [] : [{ id: 'F1', eventId: 'E1', field: 'a', value,
    certainty: 'reported', source: 'description', verification: 'quoted', evidence: 'a evidence' }], evaluateLeaf);

  assert.equal(evaluate(true).met, false);
  assert.equal(evaluate(false).met, true);
  assert.equal(evaluate(undefined).met, null);
});
