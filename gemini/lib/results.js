import { providerResultSchema, resultSchema } from './contracts.js';
import { catalogs } from './catalog.js';
import { canonicalMissingMaterials, parseNumber } from './facts.js';

const grades = {
  injury: ['重伤一级', '重伤二级', '轻伤一级', '轻伤二级', '轻微伤'],
  disability: ['一级伤残', '二级伤残', '三级伤残', '四级伤残', '五级伤残', '六级伤残', '七级伤残', '八级伤残', '九级伤残', '十级伤残'],
};
const normalize = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export const includesEvidence = (source, quote) => Boolean(quote?.trim()) && normalize(source).includes(normalize(quote));

function officialCondition(condition, clauseText) {
  const modelText = normalize(condition.replace(/[（(][^）)]*[）)]/g, ''));
  return clauseText.split(/[；;。]/).map(value => value.trim().replace(/[，,、：:]$/g, ''))
    .filter(Boolean).find(fragment => modelText.includes(normalize(fragment))) || null;
}

function evaluateRibCondition(condition, facts) {
  if (!/肋骨骨折/.test(condition)) return undefined;
  const thresholdMatch = condition.match(/(\d+|[零〇一二两三四五六七八九十百]+)\s*处以上/);
  const reliable = fact => ['reported', 'observed', 'derived'].includes(fact.certainty)
    && fact.source === 'description' && fact.verification === 'quoted';
  if (thresholdMatch) {
    const threshold = parseNumber(thresholdMatch[1]);
    const siteCounts = facts.filter(fact => fact.field === 'fracture_site_count' && reliable(fact)
      && Number.isInteger(fact.value) && fact.value >= 0);
    if (!siteCounts.length) return null;
    return siteCounts.every(fact => fact.value >= threshold);
  }
  const injuryFacts = facts.filter(fact => fact.field === 'injury_type' && fact.value === 'rib_fracture');
  if (injuryFacts.some(reliable)) return true;
  if (injuryFacts.some(fact => fact.certainty === 'excluded' && fact.source === 'description' && fact.verification === 'quoted')) return false;
  return null;
}

function deterministicRibReferences(clauses, facts, sourceUrl) {
  const candidates = clauses.flatMap(clause => {
    if (!/肋骨骨折/.test(clause.text)) return [];
    const condition = clause.text.split(/[；;。]/).map(value => value.trim()).find(value => /肋骨骨折/.test(value));
    if (!condition) return [];
    const met = evaluateRibCondition(condition, facts);
    const relevantFields = /(?:处数|\d+\s*处|[一二两三四五六七八九十]+\s*处)/.test(condition)
      ? ['fracture_site_count'] : ['injury_type'];
    const relevantFacts = facts.filter(fact => fact.source === 'description' && fact.verification === 'quoted'
      && relevantFields.includes(fact.field));
    return [{ clause, condition, met, relevantFacts }];
  });
  return candidates.map(({ clause, condition, met, relevantFacts }) => {
    const gradeRank = grades.injury.indexOf(clause.grade);
    const hasHigherIncompleteClause = candidates.some(candidate => grades.injury.indexOf(candidate.clause.grade) < gradeRank
      && candidate.met === null);
    const relation = met === true ? (hasHigherIncompleteClause ? 'differential' : 'supports') : 'incomplete';
    const evidence = relevantFacts[0]?.evidence || '';
    return { ...clause, sourceUrl, evidence,
      reasoning: relation === 'differential' ? '较重条款所需条件尚未确认，本条仅作对照。'
        : met === true ? '可回查事实与本地条文条件相符。' : '材料原文尚不能完整支持本条条件，需补充或核对。',
      relation, conditions: [{ condition, evidence, factIds: relevantFacts.map(fact => fact.id), met }] };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

export function normalizeResult(raw, input, context) {
  const generated = providerResultSchema.parse(raw);
  const { standard } = catalogs[input.assessmentType];
  const allowedClauses = new Map(context.clauses.map(clause => [clause.id, clause]));
  const principles = new Map(catalogs[input.assessmentType].principles.map(item => [item.id,
    { ...item, grade: '', category: '总则与附则' }]));
  const recognizedText = context.recognizedText || '';
  const sourceText = `${input.description}\n${recognizedText}`;
  const allowedIds = new Set([...allowedClauses.keys()].flatMap(id => [id, id.split('.').slice(0, 3).join('.')])
    .concat(catalogs[input.assessmentType].principles.map(item => item.id)));
  const inlineIds = generated.reasoning.normalize('NFKC').match(/[456]\.\d+\.\d+(?:\.[a-z]|\.\d+|[a-z])?\b/g) || [];
  const unknownInlineCitation = inlineIds.some(id => !allowedIds.has(id) && !allowedIds.has(id.replace(/(\d)([a-z])$/, '$1.$2')));
  const warnings = [...generated.warnings, ...(context.extractionWarnings || [])];
  const conflicts = Array.isArray(context.conflicts) ? context.conflicts : [];
  const requiresReview = context.requiresReview === true || conflicts.length > 0;
  const hasValidatedFacts = Array.isArray(context.extractedFacts);
  const missingMaterials = canonicalMissingMaterials([
    ...(hasValidatedFacts ? [] : generated.missingMaterials),
    ...(Array.isArray(context.factMissingMaterials) ? context.factMissingMaterials : []),
  ]);
  const facts = [];
  const sourceFacts = Array.isArray(context.extractedFacts) ? context.extractedFacts : generated.facts.map((fact, index) => ({
    id: `F${index + 1}`, field: 'other', value: fact.finding, certainty: 'reported',
    source: fact.source, evidence: fact.evidence, finding: fact.finding,
  }));
  for (const fact of sourceFacts) {
    const source = fact.source === 'image' ? recognizedText : input.description;
    if (!includesEvidence(source, fact.evidence)) {
      warnings.push('部分事实无法在提交材料中回查，已移除，不能作为等级依据。');
      continue;
    }
    facts.push({ ...fact, finding: fact.finding || `${fact.field}：${Array.isArray(fact.value) ? fact.value.join('、') : String(fact.value ?? '')}`,
      verification: fact.source === 'image' ? 'image_pending' : 'quoted' });
  }
  let invalidReference = unknownInlineCitation;
  if (unknownInlineCitation) warnings.push('部分自由文本引用不在本次原文依据中，已不采纳其结论。');
  const references = [];
  for (const proposed of generated.references) {
    const clause = allowedClauses.get(proposed.clauseId) || principles.get(proposed.clauseId);
    if (!clause) {
      invalidReference = true;
      warnings.push(`条款 ${proposed.clauseId} 不在本次官方原文依据中，已移除。`);
      continue;
    }
    const conditions = proposed.conditions.map(condition => {
      const canonicalCondition = officialCondition(condition.condition, clause.text);
      if (!canonicalCondition && clause.grade) {
        invalidReference = true;
        warnings.push(`条款 ${clause.id} 的条件描述不在本地条文中，未用于等级判断。`);
      }
      const conditionText = canonicalCondition || condition.condition;
      const factIds = Array.isArray(condition.factIds) ? [...new Set(condition.factIds)] : [];
      const referencedFacts = factIds.map(id => facts.find(fact => fact.id === id)).filter(Boolean);
      const matchedFacts = [...new Map([...referencedFacts, ...facts.filter(fact => fact.source === 'description'
        && (includesEvidence(fact.evidence, condition.evidence) || includesEvidence(condition.evidence, fact.evidence)))]
        .map(fact => [fact.id, fact])).values()];
      const boundEvidence = referencedFacts.find(fact => fact.source === 'description' && includesEvidence(sourceText, fact.evidence))?.evidence
        || condition.evidence;
      const traceable = includesEvidence(sourceText, boundEvidence);
      const requiresSiteCount = /处数|\d+\s*处|[一二两三四五六七八九十]+\s*处/.test(conditionText);
      const relevantFacts = requiresSiteCount ? matchedFacts.filter(fact => fact.field === 'fracture_site_count') : matchedFacts;
      const explicitSiteEvidence = requiresSiteCount && /(?:共|累计)?\s*(?:\d+|[零〇一二两三四五六七八九十百]+)\s*处/.test(boundEvidence);
      const reliableFact = relevantFacts.some(fact => ['reported', 'observed', 'derived'].includes(fact.certainty)
        && fact.source === 'description' && fact.verification === 'quoted');
      const factBacked = condition.met === true ? (reliableFact || explicitSiteEvidence && traceable) : relevantFacts.length > 0;
      const ribCondition = evaluateRibCondition(conditionText, matchedFacts);
      const met = canonicalCondition
        ? (ribCondition !== undefined && ribCondition !== null ? ribCondition
          : traceable && factBacked ? condition.met : null)
        : null;
      return { ...condition, condition: canonicalCondition || condition.condition,
        evidence: traceable && matchedFacts.length ? boundEvidence : '',
        ...(factIds.length ? { factIds: factIds.filter(id => facts.some(fact => fact.id === id)) } : {}),
        met };
    });
    const aggregateTraceable = includesEvidence(sourceText, proposed.evidence);
    const confirmed = conditions.length > 0 && conditions.every(condition => condition.met === true);
    if (!aggregateTraceable && proposed.relation === 'supports' && confirmed) {
      warnings.push('部分条款汇总引用未能逐字回查，已用逐项核对的材料原文替代。');
    }
    const relation = proposed.relation === 'differential' ? 'differential' : confirmed ? 'supports' : 'incomplete';
    references.push({ ...clause, sourceUrl: standard.sourceUrl, evidence: aggregateTraceable ? proposed.evidence : conditions.find(condition => condition.evidence)?.evidence || '',
      reasoning: confirmed ? '可回查事实与本地条文列出的适用条件相符。'
        : '材料原文尚不能完整支持本条条件，需补充或核对，不用于当前定级。',
      relation, conditions });
  }
  const hasReliableRibFact = facts.some(fact => fact.field === 'injury_type' && fact.value === 'rib_fracture'
    && ['reported', 'observed', 'derived'].includes(fact.certainty)
    && fact.source === 'description' && fact.verification === 'quoted');
  const stableRibReferences = !requiresReview && hasReliableRibFact
    ? deterministicRibReferences(context.clauses, facts, standard.sourceUrl) : [];
  if (stableRibReferences.length) {
    references.splice(0, references.length, ...references.filter(reference => !/肋骨骨折/.test(reference.text)), ...stableRibReferences);
    invalidReference = false;
  }
  if (requiresReview) references.splice(0, references.length);
  let status = generated.status;
  let grade = generated.grade;
  if (requiresReview) status = 'needs_review';
  const blockingMissingMaterials = !hasValidatedFacts && missingMaterials.length > 0;
  const supportedReference = references.find(reference => grades[input.assessmentType].includes(reference.grade)
    && (stableRibReferences.length > 0 || generated.grade == null || generated.grade === reference.grade)
    && reference.relation === 'supports' && reference.conditions.length > 0
    && reference.conditions.every(condition => condition.met === true));
  const explicitAlternativeStandard = /工伤|劳动能力鉴定|保险合同|保险条款/.test(input.description);
  if (!requiresReview && !supportedReference) {
    if (status === 'needs_review') status = 'insufficient';
    if (status === 'not_applicable' && !explicitAlternativeStandard) status = 'insufficient';
  }
  if (!requiresReview && !invalidReference && !blockingMissingMaterials && facts.length > 0 && supportedReference) {
    status = 'preliminary';
    grade = supportedReference.grade;
    for (let index = references.length - 1; index >= 0; index -= 1) {
      if (references[index].grade && (references[index].relation !== 'supports' || references[index].grade !== grade)) references.splice(index, 1);
    }
  } else if (status === 'preliminary') {
    if (!supportedReference || !grades[input.assessmentType].includes(grade) || invalidReference || blockingMissingMaterials) {
      status = 'insufficient';
      missingMaterials.push('补充能够支持所涉标准完整条件的材料，由专业人员核对后再评估。');
      warnings.push('当前材料或条款依据不足，未保留模型给出的等级。');
    }
  }
  if (input.assessmentType === 'disability' && input.treatmentStatus === 'ongoing' && status === 'preliminary') {
    status = 'insufficient';
    missingMaterials.push('原发损伤及相关并发症治疗终结或临床效果稳定后的复查与功能评定资料。');
    warnings.push('治疗尚未终结，依据该标准第4.2条，暂不输出伤残等级。');
  }
  if (status !== 'preliminary') grade = null;
  if (status === 'needs_review') {
    warnings.push('关键事实存在矛盾或待核实内容，当前结果不用于等级判断。');
    for (const reference of references) {
      if (reference.relation === 'supports') {
        reference.relation = 'incomplete';
        reference.reasoning = '关键事实存在冲突或待核实内容，本条不用于等级判断。';
      }
    }
  }
  if (hasValidatedFacts) {
    if (status === 'needs_review') {
      missingMaterials.splice(0, missingMaterials.length,
        conflicts.length ? '核对冲突事实所涉及的原始资料。' : '核实关键事实的原始资料。');
    } else if (status === 'preliminary') {
      missingMaterials.length = 0;
    } else if (status === 'insufficient') {
      missingMaterials.splice(0, missingMaterials.length,
        ...canonicalMissingMaterials(context.factMissingMaterials || []));
      const excludedOnlyFacts = facts.length > 0 && facts.every(fact => fact.certainty === 'excluded');
      const hasReliableRibFact = facts.some(fact => fact.field === 'injury_type' && fact.value === 'rib_fracture'
        && ['reported', 'observed', 'derived'].includes(fact.certainty)
        && fact.source === 'description' && fact.verification === 'quoted');
      const hasExplicitSiteCount = facts.some(fact => fact.field === 'fracture_site_count'
        && ['reported', 'observed', 'derived'].includes(fact.certainty)
        && fact.source === 'description' && fact.verification === 'quoted');
      const hasUnresolvedRibSiteThreshold = references.some(reference => /肋骨骨折/.test(reference.text)
        && /(?:\d+|[零〇一二两三四五六七八九十百]+)\s*处以上/.test(reference.text));
      if (hasReliableRibFact && hasUnresolvedRibSiteThreshold && !hasExplicitSiteCount) {
        missingMaterials.push('骨折处数未在原文中明确记载，需核实');
      }
      if (excludedOnlyFacts) missingMaterials.splice(0, missingMaterials.length);
      if (input.assessmentType === 'disability' && input.treatmentStatus === 'ongoing') {
        missingMaterials.push('原发损伤及相关并发症治疗终结或临床效果稳定后的复查与功能评定资料。');
      }
      if (missingMaterials.length === 0) missingMaterials.push('补充与适用条款相关的客观材料。');
    }
  }
  const hasRibFacts = facts.some(fact => fact.field === 'injury_type' && fact.value === 'rib_fracture');
  const hasOnlySourceBackedRibFacts = facts.length > 0 && facts.every(fact =>
    ['injury_type', 'anatomical_site', 'laterality', 'fractured_rib_numbers', 'fractured_rib_count', 'fracture_site_count'].includes(fact.field)
      && /肋骨/.test(fact.evidence));
  const hasRibReferences = references.some(reference => /肋骨骨折/.test(reference.text));
  if (status === 'insufficient' && !requiresReview && hasRibFacts && hasRibReferences) {
    const stableReferences = deterministicRibReferences(context.clauses, facts, standard.sourceUrl);
    if (stableReferences.length) references.splice(0, references.length,
      ...(hasOnlySourceBackedRibFacts ? [] : references.filter(reference => !/肋骨骨折/.test(reference.text))),
      ...stableReferences);
  }
  references.sort((a, b) => Number(!a.grade) - Number(!b.grade) || a.id.localeCompare(b.id, 'en'));
  for (const reference of references) reference.conditions.sort((a, b) => a.condition.localeCompare(b.condition, 'zh-CN'));
  if (recognizedText) warnings.push('图片识别内容可能存在遗漏或误读，请核对原报告后使用。');
  const stableSummary = status === 'needs_review'
    ? '材料中存在需要复核的冲突或不确定事实，暂不输出等级。'
    : status === 'insufficient' ? '现有材料不足以形成可靠的等级评估。'
      : status === 'preliminary' && supportedReference
        ? `可回查事实与本地条款 ${supportedReference.id} 的条件初步相符，辅助评估为${supportedReference.grade}。`
        : generated.summary;
  const stableReasoning = status === 'needs_review'
    ? `事实分析识别到以下复核事项：${conflicts.map(item => item.reason).sort().join('；') || '关键事实仍待核实'}。在复核完成前不输出等级。`
    : status === 'insufficient'
      ? `当前资料不足以完成可靠评估。${missingMaterials.length ? `需补充或核实：${missingMaterials.join('；')}。` : '请补充与适用条款相关的客观材料。'}`
      : status === 'preliminary' && supportedReference
        ? `经来源核验的材料事实与本地条款 ${supportedReference.id}（${supportedReference.text}）列出的适用条件相符。此结果仅为辅助评估，仍需专业人员结合完整材料复核。`
        : generated.reasoning;
  return resultSchema.parse({
    ...generated, schemaVersion: 2, assessmentType: input.assessmentType, status, grade,
    summary: stableSummary,
    reasoning: status !== generated.status || unknownInlineCitation || requiresReview || status === 'preliminary' && Boolean(supportedReference)
      ? stableReasoning : generated.reasoning,
    facts, conflicts, requiresReview, references, warnings: [...new Set(warnings)].slice(-20), missingMaterials: [...new Set(missingMaterials)].slice(-20),
    standard, recognizedText, createdAt: new Date().toISOString(), requestId: context.requestId, model: context.model,
  });
}

export function legacyResponse(result) {
  return { grade: result.grade || (result.status === 'not_applicable' ? '不适用当前标准' : '需补充材料'),
    summary: result.summary, logic: result.reasoning, matches: result.references.map(reference => `${reference.id} ${reference.text}`),
    explanation: [...result.warnings, ...result.missingMaterials].join('\n') };
}
