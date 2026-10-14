import { providerResultSchema, resultSchema } from './contracts.js';
import { catalogs } from './catalog.js';

const grades = {
  injury: ['重伤一级', '重伤二级', '轻伤一级', '轻伤二级', '轻微伤'],
  disability: ['一级伤残', '二级伤残', '三级伤残', '四级伤残', '五级伤残', '六级伤残', '七级伤残', '八级伤残', '九级伤残', '十级伤残'],
};
const normalize = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export const includesEvidence = (source, quote) => Boolean(quote?.trim()) && normalize(source).includes(normalize(quote));

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
  const missingMaterials = [...generated.missingMaterials];
  const facts = [];
  for (const fact of generated.facts) {
    const source = fact.source === 'image' ? recognizedText : input.description;
    if (!includesEvidence(source, fact.evidence)) {
      warnings.push('部分事实无法在提交材料中回查，已移除，不能作为等级依据。');
      continue;
    }
    facts.push({ ...fact, verification: fact.source === 'image' ? 'image_pending' : 'quoted' });
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
      const traceable = includesEvidence(sourceText, condition.evidence);
      return { ...condition, evidence: traceable ? condition.evidence : '', met: traceable ? condition.met : null };
    });
    const aggregateTraceable = includesEvidence(sourceText, proposed.evidence);
    const confirmed = conditions.every(condition => condition.met === true);
    if (!aggregateTraceable && proposed.relation === 'supports' && confirmed) {
      warnings.push('部分条款汇总引用未能逐字回查，已用逐项核对的材料原文替代。');
    }
    const relation = proposed.relation === 'supports' && !confirmed ? 'incomplete' : proposed.relation;
    if (clause.grade && proposed.relation === 'supports' && !confirmed) {
      missingMaterials.push(`补充 ${clause.id} 所要求条件的明确报告、测量值或检查记录。`);
    }
    references.push({ ...clause, sourceUrl: standard.sourceUrl, evidence: aggregateTraceable ? proposed.evidence : conditions.find(condition => condition.evidence)?.evidence || '',
      reasoning: proposed.relation === 'supports' && !confirmed ? '材料原文尚不能完整支持本条必要条件，需补充或核对，不用于当前定级。' : proposed.reasoning,
      relation, conditions });
  }
  let status = generated.status;
  let grade = generated.grade;
  if (status === 'preliminary') {
    const supported = grades[input.assessmentType].includes(grade)
      && facts.length > 0 && references.some(reference => reference.relation === 'supports' && reference.grade === grade);
    if (!supported || invalidReference || missingMaterials.length > 0) {
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
  if (recognizedText) warnings.push('图片识别内容可能存在遗漏或误读，请核对原报告后使用。');
  return resultSchema.parse({
    ...generated, schemaVersion: 2, assessmentType: input.assessmentType, status, grade,
    summary: status === 'insufficient' ? '现有材料不足以形成可靠的等级评估。' : generated.summary,
    reasoning: status !== generated.status || unknownInlineCitation ? '当前材料尚未满足完整的条款条件或评估时机，暂不能输出等级。下方仅保留能够回查的材料及官方条文对照，请补充缺失内容并进行专业复核。' : generated.reasoning,
    facts, references, warnings: [...new Set(warnings)].slice(-20), missingMaterials: [...new Set(missingMaterials)].slice(-20),
    standard, recognizedText, createdAt: new Date().toISOString(), requestId: context.requestId, model: context.model,
  });
}

export function legacyResponse(result) {
  return { grade: result.grade || (result.status === 'not_applicable' ? '不适用当前标准' : '需补充材料'),
    summary: result.summary, logic: result.reasoning, matches: result.references.map(reference => `${reference.id} ${reference.text}`),
    explanation: [...result.warnings, ...result.missingMaterials].join('\n') };
}
