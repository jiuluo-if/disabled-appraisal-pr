import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { hashAssessmentSources } from '../gemini/lib/assessment-snapshot.js';

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
