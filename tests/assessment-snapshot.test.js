import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ANALYSIS_SNAPSHOT_VERSION, ASSESSMENT_CODE_VERSION, createAssessmentSnapshot,
  hashAssessmentSources } from '../gemini/lib/assessment-snapshot.js';
import { FACT_SCHEMA_VERSION } from '../gemini/lib/facts.js';

test('assessment code version is independent of the checkout root', () => {
  const sources = root => {
    const pathApi = /^[a-z]:/iu.test(root) ? path.win32 : path.posix;
    return [
      { path: pathApi.join(root, 'gemini', 'lib', 'facts.js'), content: 'export const facts = true;\n' },
      { path: pathApi.join(root, 'gemini', 'server.js'), content: 'export const server = true;\n' },
    ];
  };

  assert.equal(hashAssessmentSources('C:/agent/work/project', sources('C:/agent/work/project')),
    hashAssessmentSources('/home/runner/work/project', sources('/home/runner/work/project')));
  assert.equal(hashAssessmentSources('/home/runner/work/project', sources('/home/runner/work/project')),
    hashAssessmentSources('/home/runner/work/project', sources('/home/runner/work/project').reverse()
      .map(source => ({ ...source, content: source.content.replace(/\n/gu, '\r\n') }))));
});

test('assessment snapshots retain the source digest even when a release label is supplied', () => {
  const snapshot = createAssessmentSnapshot({ assessmentType: 'injury', description: '已核验事实', images: [],
    injuryDate: '', treatmentStatus: 'unknown' }, { facts: [], factAudit: [], conflicts: [], requiresReview: false,
    reviewReasons: [], missingMaterials: [] }, { provider: 'test', textModel: 'test-text', visionModel: 'test-vision' }, {
    factPromptVersion: 'fact-v1', assessmentPromptVersion: 'assessment-v1', codeVersion: 'stable-release-label',
  });

  assert.equal(ANALYSIS_SNAPSHOT_VERSION, '1.1');
  assert.equal(snapshot.snapshot, ANALYSIS_SNAPSHOT_VERSION);
  assert.equal(snapshot.factSchema, FACT_SCHEMA_VERSION);
  assert.equal(snapshot.code, 'stable-release-label');
  assert.equal(snapshot.codeHash, ASSESSMENT_CODE_VERSION);
});
