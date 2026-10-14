import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { loadStandards } from './api.js';

export function StandardsView({ type }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    loadStandards(type, controller.signal).then(setCatalog).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [type, revision]);
  const filtered = useMemo(() => (catalog?.clauses || []).filter(clause => {
    const search = query.normalize('NFKC').replace(/\s/g, '').toLowerCase();
    return (!grade || clause.grade === grade) && `${clause.id} ${clause.category} ${clause.text}`.normalize('NFKC').replace(/\s/g, '').toLowerCase().includes(search);
  }), [catalog, query, grade]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 40));
  return <section className="standards-view">
    <div className="section-heading"><h2>标准条款</h2>{catalog && <a className="source-link" href={catalog.standard.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />官方原文</a>}</div>
    {catalog && <div className="standard-provenance"><strong>{catalog.standard.name}</strong><span>{catalog.standard.version} · {catalog.standard.effectiveDate}起施行</span></div>}
    <div className="standard-filters"><label className="search-field"><Search size={17} /><input aria-label="搜索标准条款" placeholder="条款编号、部位或关键词" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <select aria-label="筛选等级" value={grade} onChange={event => { setGrade(event.target.value); setPage(0); }}><option value="">全部等级</option>{[...new Set(catalog?.clauses.map(clause => clause.grade) || [])].map(item => <option key={item}>{item}</option>)}</select>
    </div>
    {error ? <div className="empty-view"><p role="alert">{error}</p><button type="button" className="secondary-button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />重试</button></div>
      : !catalog ? <div className="empty-view"><Loader2 className="spin" size={22} /><p>正在加载条款</p></div>
      : <>
        <div className="standards-table"><div className="standards-table-head"><span>条款</span><span>等级 / 部位</span><span>原文</span></div>
          {filtered.slice(page * 40, (page + 1) * 40).map(clause => <div className="standard-row" key={clause.id}><strong>{clause.id}</strong><div><span>{clause.grade}</span><small>{clause.category}</small></div><p>{clause.text}</p></div>)}
        </div>
        {!filtered.length && <div className="empty-view">没有匹配的条款</div>}
        <div className="pagination"><span>{filtered.length} 条</span><div><button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={!page} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button><span>{page + 1} / {pageCount}</span><button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button></div></div>
        <details className="principles"><summary>鉴定原则、时机与附则</summary>{catalog.principles.map(item => <p key={item.id}><strong>{item.id}</strong> {item.text}</p>)}</details>
      </>}
  </section>;
}
