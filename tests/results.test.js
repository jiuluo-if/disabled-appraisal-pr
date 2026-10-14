import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, retrieveClauses } from '../gemini/lib/catalog.js';
import { normalizeResult } from '../gemini/lib/results.js';
import { requestSchema, resultSchema } from '../gemini/lib/contracts.js';
import { inputs, providerFixture, resultFixture } from './fixtures.js';
import { readHistory, saveHistory } from '../client/history.js';
import { reportText } from '../client/report.js';

function normalize(raw, type = 'injury', override = {}) {
  return normalizeResult(raw, { ...inputs[type], ...override }, {
    clauses: retrieveClauses(type, inputs[type].description), requestId: 'case-test', model: 'test-model',
  });
}

test('official catalogs retain complete grading clauses and distinguish partial spleen removal', () => {
  assert.equal(catalogs.injury.clauses.length, 390);
  assert.equal(catalogs.disability.clauses.length, 457);
  const byId = Object.fromEntries(catalogs.disability.clauses.map(item => [item.id, item]));
  assert.equal(byId['5.9.4.2'].grade, '九级伤残');
  assert.equal(byId['5.9.4.2'].text, '脾部分切除术后；');
  assert.equal(byId['5.8.4.2'].text, '成年人脾切除术后；');
  assert.match(byId['5.10.3.7'].text, /肋骨骨折6根以上/);
  assert.ok(catalogs.disability.principles.some(item => item.id === '6.12' && item.text.includes('包含本数')));
});

test('valid results use official text rather than model-invented clause wording', () => {
  for (const type of ['injury', 'disability']) {
    const result = resultFixture(type);
    assert.equal(result.status, 'preliminary');
    assert.ok(resultSchema.safeParse(result).success);
    assert.equal(result.references[0].text, catalogs[type].clauses.find(item => item.id === result.references[0].id).text);
  }
});

test('invented clause IDs remove the grade and definitive model reasoning', () => {
  const raw = providerFixture(); raw.references[0].clauseId = '5.999.999'; raw.reasoning = '确定是轻伤二级。';
  const result = normalize(raw);
  assert.equal(result.grade, null); assert.equal(result.status, 'insufficient');
  assert.equal(result.references.length, 0); assert.doesNotMatch(result.reasoning, /确定是轻伤二级/);
});

test('different grading systems cannot share the same grade by accident', () => {
  const raw = providerFixture('disability'); raw.grade = '轻伤二级';
  assert.equal(normalize(raw, 'disability').grade, null);
});

test('official principles are valid background references but cannot by themselves support a grade', () => {
  const raw = providerFixture();
  raw.references.push({ ...raw.references[0], clauseId: '4.1.1' });
  const result = normalize(raw);
  assert.equal(result.grade, '轻伤二级');
  assert.equal(result.references[1].category, '总则与附则');
  assert.equal(result.references[1].grade, '');
  raw.references.shift();
  assert.equal(normalize(raw).grade, null);
});

test('unsupported inline grading citations are not allowed to override a valid structured reference', () => {
  const raw = providerFixture(); raw.reasoning = '确定适用5.999.999，因此构成轻伤二级。';
  const result = normalize(raw);
  assert.equal(result.grade, null); assert.doesNotMatch(result.reasoning, /5.999.999/);
});

test('facts and condition evidence not present in the submitted material cannot support a grade', () => {
  const raw = providerFixture(); raw.facts[0].evidence = '左侧12根肋骨骨折';
  raw.references[0].conditions[0].evidence = '左侧12根肋骨骨折';
  const result = normalize(raw);
  assert.equal(result.status, 'insufficient'); assert.equal(result.facts.length, 0);
  assert.equal(result.references[0].conditions[0].met, null); assert.equal(result.grade, null);
  assert.equal(result.references[0].conditions[0].evidence, '');
});

test('an absent counterexample cannot be displayed as a confirmed negative condition', () => {
  const raw = providerFixture(); raw.references[0].conditions[0] = { condition: '未满足条件', evidence: '', met: false };
  const result = normalize(raw);
  assert.equal(result.references[0].conditions[0].met, null); assert.equal(result.grade, null);
});

test('missing requirements and ongoing treatment never produce a disability grade', () => {
  const missing = providerFixture(); missing.missingMaterials = ['补充明确的影像报告'];
  assert.equal(normalize(missing).grade, null);
  const ongoing = normalize(providerFixture('disability'), 'disability', { treatmentStatus: 'ongoing' });
  assert.equal(ongoing.grade, null); assert.ok(ongoing.warnings.some(item => item.includes('第4.2条')));
});

test('bad arrays are rejected instead of crashing a result view', () => {
  assert.throws(() => normalize({ ...providerFixture(), references: 'not-an-array' }));
  assert.throws(() => normalize({ ...providerFixture(), facts: null }));
});

test('empty input, false image formats and future dates do not pass request validation', () => {
  assert.equal(requestSchema.safeParse({ assessmentType: 'injury' }).success, false);
  assert.equal(requestSchema.safeParse({ ...inputs.injury, images: [{ mimeType: 'image/svg+xml', data: 'eA==' }] }).success, false);
  assert.equal(requestSchema.safeParse({ ...inputs.injury, injuryDate: '2099-01-01' }).success, false);
});

test('damaged history and unavailable storage remain recoverable', () => {
  assert.deepEqual(readHistory('injury', { getItem: () => '{invalid' }), []);
  assert.deepEqual(readHistory('injury', { getItem: () => '{"items":[]}' }), []);
  assert.deepEqual(readHistory('injury', { getItem: () => { throw new Error('denied'); } }), []);
  assert.throws(() => saveHistory('injury', { id: 'id', title: 'title', result: resultFixture() }, {
    getItem: () => '[]', setItem: () => { throw new Error('quota'); },
  }), /记录未保存/);
});

test('history is explicit, deduplicated, bounded and excludes results from the other assessment type', () => {
  let value = '[]';
  const storage = { getItem: () => value, setItem: (key, raw) => { value = raw; } };
  for (let i = 0; i < 55; i++) saveHistory('injury', { id: String(i), title: 'title', result: resultFixture() }, storage);
  assert.equal(readHistory('injury', storage).length, 50);
  saveHistory('injury', { id: '54', title: 'latest', result: resultFixture() }, storage);
  assert.equal(readHistory('injury', storage).length, 50);
  assert.deepEqual(readHistory('disability', storage), []);
});

test('exported report preserves insufficiency, missing materials and official provenance', () => {
  const result = resultFixture('injury', { status: 'insufficient', grade: null, references: [], missingMaterials: ['补充CT报告'] });
  const text = reportText(result);
  assert.match(text, /暂不输出等级/); assert.match(text, /补充CT报告/); assert.match(text, /2013年公布版/);
  assert.match(text, /不是正式司法鉴定意见/);
});
