import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { FACT_SCHEMA_VERSION } from './facts.js';
import { RULES_VERSION } from './catalog.js';

export const ANALYSIS_SNAPSHOT_VERSION = '1.0';

const digest = value => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const sourceDirectory = new URL('.', import.meta.url);
const sourceFiles = [
  ...readdirSync(sourceDirectory).filter(name => name.endsWith('.js')).sort()
    .map(name => new URL(name, sourceDirectory)),
  new URL('../server.js', import.meta.url),
];
export const ASSESSMENT_CODE_VERSION = createHash('sha256').update(sourceFiles
  .map(file => `${file.pathname}\n${readFileSync(file)}`).join('\n'), 'utf8').digest('hex');

export function createAssessmentSnapshot(input, extracted, config, { factPromptVersion, assessmentPromptVersion,
  codeVersion = 'development-unversioned' } = {}) {
  const inputDigest = digest({
    assessmentType: input.assessmentType,
    description: input.description,
    images: (input.images || []).map(image => ({ mimeType: image.mimeType,
      digest: createHash('sha256').update(image.data, 'utf8').digest('hex') })),
    injuryDate: input.injuryDate,
    treatmentStatus: input.treatmentStatus,
  });
  const factsDigest = digest({
    facts: extracted.facts,
    factAudit: extracted.factAudit,
    conflicts: extracted.conflicts,
    requiresReview: extracted.requiresReview,
    missingMaterials: extracted.missingMaterials,
  });
  const versions = {
    snapshot: ANALYSIS_SNAPSHOT_VERSION,
    factSchema: FACT_SCHEMA_VERSION,
    factPrompt: factPromptVersion,
    assessmentPrompt: assessmentPromptVersion,
    rules: RULES_VERSION,
    code: codeVersion,
    provider: config.provider || 'unknown',
    textModel: config.textModel,
    visionModel: config.visionModel,
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    thinking: config.thinking ?? null,
    jsonMode: config.jsonMode ?? null,
  };
  return {
    ...versions,
    inputDigest,
    factsDigest,
    snapshotId: digest({ ...versions, inputDigest, factsDigest }),
  };
}
