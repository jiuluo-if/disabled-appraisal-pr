import test from 'node:test';
import assert from 'node:assert/strict';
import { applyClauseLogicMetadata } from '../gemini/lib/catalog.js';

test('explicit condition leaves must anchor to their official clause text', () => {
  const catalogs = { injury: { clauses: [{ id: '5.1.1.a', text: 'A项损伤；B项后果。' }] }, disability: { clauses: [] } };
  const metadata = { version: 1, clauses: { injury: { '5.1.1.a': { annotation: 'explicit', logic: {
    op: 'all', sourceText: 'A项损伤；B项后果', conditionText: 'A项损伤；B项后果', children: [
      { op: 'condition', sourceText: 'A项损伤', conditionText: 'A项损伤',
        factMatch: { field: 'diagnosis', values: ['A项损伤'] } },
      { op: 'condition', sourceText: '条文以外的阈值', conditionText: '条文以外的阈值',
        factMatch: { field: 'clinical_finding', values: ['条文以外的阈值'] } },
    ],
  } } } } };

  assert.throws(() => applyClauseLogicMetadata(catalogs, metadata), /原文|锚点|条文/u);

  const sourceBacked = structuredClone(metadata);
  const secondLeaf = sourceBacked.clauses.injury['5.1.1.a'].logic.children[1];
  secondLeaf.sourceText = 'B项后果';
  secondLeaf.conditionText = 'B项后果';
  secondLeaf.factMatch.values = ['B项后果'];
  assert.equal(applyClauseLogicMetadata(catalogs, sourceBacked).injury.clauses[0].conditionLogic.annotation, 'explicit');
});
