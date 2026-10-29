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
  const states = [true, false, null];
  for (const left of states) for (const right of states) {
    const allExpected = left === false || right === false ? false
      : left === true && right === true ? true : null;
    const anyExpected = left === true || right === true ? true
      : left === false && right === false ? false : null;
    assert.equal(combine('all', [['a', left], ['b', right]]).met, allExpected, `all(${left}, ${right})`);
    assert.equal(combine('any', [['a', left], ['b', right]]).met, anyExpected, `any(${left}, ${right})`);
    assert.equal(combine('all', [['b', right], ['a', left]]).met, allExpected, `all permutation(${right}, ${left})`);
    assert.equal(combine('any', [['b', right], ['a', left]]).met, anyExpected, `any permutation(${right}, ${left})`);
  }
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

test('all conditions cannot borrow positive facts from separate injury events', () => {
  const logic = { annotation: 'explicit', logic: { op: 'all', children: [condition('a'), condition('b')] } };
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'a', value: true, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: 'a evidence' },
    { id: 'F2', eventId: 'E2', field: 'b', value: true, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: 'b evidence' },
  ];
  const evaluateLeaf = (node, scopedFacts) => {
    const fact = scopedFacts.find(item => item.field === node.factMatch.field);
    return fact ? { met: fact.value, evidence: fact.evidence, factIds: [fact.id] }
      : { met: null, evidence: '', factIds: [] };
  };

  assert.equal(evaluateConditionTree(logic, facts, evaluateLeaf).met, null);
  assert.equal(evaluateConditionTree(logic, facts.map(fact => ({ ...fact, eventId: 'E1' })), evaluateLeaf).met, true);
});

test('a clinical report date alone cannot link an unscoped fact to an injury event', () => {
  const logic = { annotation: 'explicit', logic: { op: 'all', children: [condition('a'), condition('b')] } };
  const facts = [
    { id: 'F1', eventId: 'E1', field: 'a', value: true, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '2025年5月12日交通事故后甲部损伤' },
    { id: 'F2', eventId: null, field: 'b', value: true, certainty: 'reported',
      source: 'description', verification: 'quoted', evidence: '2025年5月12日CT报告记载乙部损伤' },
  ];
  const evaluateLeaf = (node, scopedFacts) => {
    const fact = scopedFacts.find(item => item.field === node.factMatch.field);
    return fact ? { met: fact.value, evidence: fact.evidence, factIds: [fact.id] }
      : { met: null, evidence: '', factIds: [] };
  };

  assert.equal(evaluateConditionTree(logic, facts, evaluateLeaf).met, null);
});
