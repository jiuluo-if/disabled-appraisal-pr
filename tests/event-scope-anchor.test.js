import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExtractedFacts } from '../gemini/lib/facts.js';

test('date-parsed injury anchors keep following same-site facts inside the assessment scope', () => {
  for (const eventAnchor of [
    '2025年因车祸受伤',
    '2025年汽车相撞后',
    '2025年坠落伤',
    '2025年烫伤',
  ]) {
    const description = `既往右眼手术记录不属于本次右眼伤情评估范围。${eventAnchor}，右眼视神经萎缩。`;
    const result = normalizeExtractedFacts({ facts: [
      { id: 'F1', field: 'clinical_finding', value: '右眼视神经萎缩', certainty: 'reported', source: 'description',
        evidence: '右眼视神经萎缩' },
    ], missingMaterials: [], conflicts: [], requiresReview: false }, { description });

    assert.ok(result.facts.some(fact => fact.value === '右眼视神经萎缩'), eventAnchor);
    assert.ok(result.scopeText.includes('右眼视神经萎缩'), eventAnchor);
  }
});
