export function reportText(result) {
  const lines = [result.standard.name + ' · 辅助评估', `时间：${new Date(result.createdAt).toLocaleString('zh-CN')}`,
    `结论状态：${result.status === 'preliminary' ? '初步评估' : result.status === 'insufficient' ? '材料不足' : '不适用当前标准'}`,
    `预估等级：${result.grade || '暂不输出等级'}`, result.summary, '', '分析依据', result.reasoning,
    '', '材料事实', ...result.facts.map(fact => `${fact.finding}\n材料原文：${fact.evidence}${fact.source === 'image' ? '（图片识别，待核对）' : ''}`),
    '', '条款对照', ...result.references.map(reference => `${reference.id}（${reference.grade}）${reference.text}\n材料依据：${reference.evidence || '尚未确认'}\n分析：${reference.reasoning}\n${reference.conditions.map(condition => `${condition.condition}：${condition.met === true ? '初步满足' : condition.met === false ? '不满足' : '待确认'}；${condition.evidence || '材料未提供'}`).join('\n')}\n出处：${reference.sourceUrl}`),
    '', '需补充材料', ...result.missingMaterials, '', '后续核对', ...result.nextSteps,
    '', '不确定性与限制', ...result.warnings,
    '', `标准版本：${result.standard.version}，${result.standard.effectiveDate}起施行`, `原文：${result.standard.sourceUrl}`,
    '本结果为辅助分析，不是正式司法鉴定意见。最终结论应由具有资质的鉴定机构依据完整材料出具。'];
  return lines.join('\n');
}

export function downloadReport(result) {
  const blob = new Blob([reportText(result)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${result.assessmentType}-${result.createdAt.slice(0, 10)}.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
