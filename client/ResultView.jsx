import React, { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ClipboardCopy, Download, ExternalLink, FileText, Printer, Save } from 'lucide-react';
import { downloadReport, reportText } from './report.js';

const statusNames = { preliminary: '初步评估', insufficient: '材料不足', not_applicable: '标准不适用' };

export function ResultView({ result, onSave, saved, onEditText }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopyError('复制失败，可使用下载报告。'); }
  }
  if (!result) return <section className="result-area result-empty" aria-label="评估结果">
    <FileText size={32} strokeWidth={1.5} />
    <h2>暂无评估结果</h2>
    <span className="empty-state-label">待核对材料</span>
  </section>;
  return <article className="result-area report" aria-label="评估结果">
    <div className="section-heading report-heading">
      <h2>评估结果</h2>
      <div className="tool-buttons">
        <button type="button" className="icon-button" title={saved ? '已保存到本机' : '保存到本机'} aria-label="保存到本机" disabled={saved} onClick={onSave}><Save size={18} /></button>
        <button type="button" className="icon-button" title={copied ? '已复制' : '复制报告'} aria-label="复制报告" onClick={copy}>{copied ? <Check size={18} /> : <ClipboardCopy size={18} />}</button>
        <button type="button" className="icon-button" title="下载报告" aria-label="下载报告" onClick={() => downloadReport(result)}><Download size={18} /></button>
        <button type="button" className="icon-button" title="打印报告" aria-label="打印报告" onClick={() => window.print()}><Printer size={18} /></button>
      </div>
    </div>
    {copyError && <p role="alert" className="inline-error">{copyError}</p>}
    <div className={`conclusion ${result.status}`}>
      <span className={`status-label ${result.status}`}>{result.status === 'preliminary' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{statusNames[result.status]}</span>
      <h3>{result.grade ? `初步考虑：${result.grade}` : result.status === 'not_applicable' ? '暂不适用当前标准' : '暂不输出等级'}</h3>
      <p>{result.summary}</p>
    </div>
    <section className="report-section">
      <h3>分析依据</h3>
      <p className="preserve-lines">{result.reasoning}</p>
    </section>
    <section className="report-section">
      <h3>材料事实 <span className="section-count">{result.facts.length}</span></h3>
      {result.facts.length ? <div className="fact-list">{result.facts.map((fact, index) => <div className="fact-row" key={index}>
        <div className="fact-title"><strong>{fact.finding}</strong><span className="source-label">{fact.source === 'image' ? '图片识别 · 待核对' : '描述原文'}</span></div>
        <blockquote>{fact.evidence}</blockquote>
      </div>)}</div> : <p className="muted">暂无能够回查的明确事实。</p>}
    </section>
    <section className="report-section">
      <h3>官方条款对照 <span className="section-count">{result.references.length}</span></h3>
      {result.references.length ? result.references.map((reference, index) => <div className="reference-row" key={reference.id + index}>
        <div className="reference-title"><strong>{reference.id}</strong><span>{reference.grade || reference.category}</span><span className={`relation-label ${reference.relation}`}>{reference.relation === 'supports' ? '初步支持' : reference.relation === 'incomplete' ? '条件待确认' : '鉴别对照'}</span></div>
        <p className="clause-text">{reference.text}</p>
        <p className="reference-reasoning">{reference.reasoning}</p>
        <div className="condition-table" role="table" aria-label="条款条件核对">
          <div className="condition-header" role="row"><span>必要条件</span><span>材料依据</span><span>状态</span></div>
          {reference.conditions.map((condition, conditionIndex) => <div className="condition-row" role="row" key={conditionIndex}>
            <span>{condition.condition}</span><span>{condition.evidence || '尚未提供'}</span>
            <span className={condition.met === true ? 'condition-met' : 'condition-pending'}>{condition.met === true ? '初步满足' : condition.met === false ? '不满足' : '待确认'}</span>
          </div>)}
        </div>
        <a className="source-link" href={reference.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 官方原文 · {result.standard.version}</a>
      </div>) : <p className="muted">当前材料尚不能支持引用具体等级条款。</p>}
    </section>
    {result.missingMaterials.length > 0 && <section className="report-section missing-materials"><h3><AlertTriangle size={17} />需补充材料</h3><ul>{result.missingMaterials.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    {result.nextSteps.length > 0 && <section className="report-section"><h3>后续核对</h3><ol>{result.nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ol></section>}
    {result.recognizedText && <details className="report-section transcription"><summary>报告识别原文 · 待人工核对</summary><pre>{result.recognizedText}</pre><button type="button" className="text-button" onClick={() => onEditText(result.recognizedText)}>补入描述并重新核对</button></details>}
    {result.warnings.length > 0 && <section className="report-section limitations"><h3>不确定性与限制</h3><ul>{result.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    <footer className="report-footer">
      <p>{result.standard.name} · {result.standard.version}</p>
      <p>{new Date(result.createdAt).toLocaleString('zh-CN')} · 本结果为辅助分析，不是正式司法鉴定意见。</p>
    </footer>
  </article>;
}
