import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../gemini/lib/catalog.js';
import { evaluateConditionLogic } from '../gemini/lib/results.js';

const clause = catalogs.disability.clauses.find(item => item.id === '5.4.5.1');
const fact = (id, value, eventId = 'E1', evidence = value) => ({ id, eventId, field: 'clinical_finding', value,
  certainty: 'reported', source: 'description', verification: 'quoted', evidence });
const currentBladderInjury = fact('I1', '膀胱损伤', 'E1', '本次事故导致膀胱损伤');

test('bladder loss with either qualifying permanent diversion path satisfies 5.4.5.1', () => {
  const ureterostomy = [currentBladderInjury,
    fact('B1', '膀胱切除术后', 'E1', '针对膀胱损伤行膀胱切除术后'), fact('D1', '永久性输尿管腹壁造瘘')];
  const bowelBladder = [currentBladderInjury, fact('B2', '膀胱完全缺失'), fact('D2', '肠代膀胱'),
    fact('D3', '永久性造口')];

  assert.equal(evaluateConditionLogic(clause.conditionLogic, ureterostomy).met, true);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, bowelBladder).met, true);
});

test('incomplete diversion details and facts from different events do not satisfy 5.4.5.1', () => {
  const missingStoma = [currentBladderInjury,
    fact('B1', '膀胱切除术后', 'E1', '针对膀胱损伤行膀胱切除术后'), fact('D1', '肠代膀胱')];
  const splitEvents = [currentBladderInjury, fact('B2', '膀胱完全缺失', 'E1'), fact('D2', '肠代膀胱', 'E2'),
    fact('D3', '永久性造口', 'E2')];

  assert.equal(evaluateConditionLogic(clause.conditionLogic, missingStoma).met, null);
  assert.equal(evaluateConditionLogic(clause.conditionLogic, splitEvents).met, null);
});
