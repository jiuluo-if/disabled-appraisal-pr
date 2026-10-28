import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, BookOpen, Check, FileText, History, Loader2, RotateCcw, Scale, Trash2, Upload, X } from 'lucide-react';
import { analyze, apiBase } from './api.js';
import { prepareImage } from './images.js';
import { clearHistory, hasLegacyHistory, readHistory, saveHistory } from './history.js';
import { assessmentToday } from '../gemini/lib/assessment-date.js';
import { ResultView } from './ResultView.jsx';
import { StandardsView } from './StandardsView.jsx';

const settings = {
  injury: { title: '伤情程度评估', standard: '人体损伤程度鉴定标准', icon: Activity,
    placeholder: '例如：CT报告明确记载左侧第3、4肋骨骨折，两处骨折均由本次外伤导致。', alternative: '伤残等级评估', url: 'https://appraise.lintsing.net/' },
  disability: { title: '伤残等级评估', standard: '人体损伤致残程度分级', icon: Scale,
    placeholder: '例如：出院记录、手术名称、治疗是否终结，以及复查后的功能检查数据。', alternative: '伤情程度评估', url: 'https://analyst.lintsing.net/' },
};

export function App({ type }) {
  const config = settings[type];
  const BrandIcon = config.icon;
  const [tab, setTab] = useState('assessment');
  const [description, setDescription] = useState('');
  const [injuryDate, setInjuryDate] = useState('');
  const [treatmentStatus, setTreatmentStatus] = useState('unknown');
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [lastInput, setLastInput] = useState('');
  const [records, setRecords] = useState(() => readHistory(type));
  const [legacy, setLegacy] = useState(() => hasLegacyHistory(type));
  const [ready, setReady] = useState('checking');
  const [previewImage, setPreviewImage] = useState(null);
  const active = useRef(null);
  const inputRef = useRef(null);
  const resultRef = useRef(null);
  const previewRef = useRef(null);
  useEffect(() => {
    if (previewImage) previewRef.current?.showModal();
  }, [previewImage]);
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timer = setTimeout(() => controller.abort(), 12000);
    fetch(`${apiBase}/health/ready`, { signal: controller.signal })
      .then(response => { if (mounted) setReady(response.ok ? 'ready' : 'unavailable'); })
      .catch(() => { if (mounted) setReady('unavailable'); })
      .finally(() => clearTimeout(timer));
    return () => { mounted = false; clearTimeout(timer); controller.abort(); active.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  function invalidate() { setResult(null); setError(''); setNotice(''); }
  function cancel() { active.current?.controller.abort(); active.current = null; setBusy(false); setError('本次分析已取消，未生成新的结论。'); }
  function reset() { cancel(); setDescription(''); setInjuryDate(''); setTreatmentStatus('unknown'); setImages([]); invalidate(); }
  async function upload(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    if (images.length + files.length > 6) { setError('一次最多上传6张报告图片。'); return; }
    setUploading(true); invalidate();
    try {
      const prepared = await Promise.all(files.map(prepareImage));
      setImages(previous => [...previous, ...prepared]);
    } catch (error) { setError(error.message); } finally { setUploading(false); }
  }
  async function submit(event) {
    event?.preventDefault();
    if (active.current || busy || uploading || (!description.trim() && !images.length)) return;
    const controller = new AbortController();
    const id = Symbol('analysis');
    active.current = { id, controller };
    const input = { assessmentType: type, description: description.trim(), injuryDate, treatmentStatus,
      images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data })) };
    setBusy(true); invalidate();
    try {
      const value = await analyze(input, controller.signal);
      if (active.current?.id !== id || controller.signal.aborted) return;
      setResult(value); setLastInput(input.description);
      if (window.innerWidth < 800) setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (error) {
      if (active.current?.id === id) setError(error.name === 'AbortError' ? '本次分析已取消。' : error.name === 'TimeoutError' ? '分析超时，未生成结论，请重试。' : error.message);
    } finally {
      if (active.current?.id === id) { setBusy(false); active.current = null; }
    }
  }
  function save() {
    try {
      setRecords(saveHistory(type, { id: result.requestId, title: lastInput.slice(0, 70) || result.summary,
        description: lastInput, injuryDate, treatmentStatus, result }));
      setNotice('已保存到本机。');
    } catch (error) { setNotice(error.message); }
  }
  function clearRecords() {
    if (!window.confirm('确定清空本机评估记录，包括旧版记录吗？')) return;
    try { clearHistory(type); setRecords([]); setLegacy(false); setNotice('本机记录已清空。'); } catch (error) { setNotice(error.message); }
  }
  function openRecord(record) {
    active.current?.controller.abort(); active.current = null; setBusy(false);
    setDescription(record.description || ''); setImages([]); setResult(record.result); setLastInput(record.description || '');
    setInjuryDate(record.injuryDate || ''); setTreatmentStatus(record.treatmentStatus || 'unknown');
    setTab('assessment'); setError(''); setNotice('');
  }
  function exportLegacy() {
    try {
      const raw = localStorage.getItem(type === 'injury' ? 'injury_history' : 'disability_history') || '[]';
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${type}-legacy-unverified.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice('无法读取旧版记录。'); }
  }
  return <div className={`app-shell ${type}`}>
    <header className="app-header"><div className="header-inner"><div className="brand"><div className="brand-mark"><BrandIcon size={23} /></div><div><h1>{config.title}</h1><p>{config.standard}</p></div></div><div className="header-meta"><span className={`service-state ${ready}`}><i />{ready === 'checking' ? '连接中' : ready === 'ready' ? '服务已连接' : '服务暂不可用'}</span><a href={config.url}>{config.alternative}</a></div></div></header>
    <div className="navigation-band"><nav className="navigation" role="tablist" aria-label="视图">{[{ id: 'assessment', label: '评估', icon: FileText }, { id: 'standards', label: '标准条款', icon: BookOpen }, { id: 'history', label: '本机记录', icon: History }].map(item => <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} onClick={() => setTab(item.id)}><item.icon size={17} />{item.label}{item.id === 'history' && records.length > 0 && <span className="nav-count">{records.length}</span>}</button>)}</nav></div>
    <main className="main-content">
      {notice && <div className="notice" role="status"><Check size={16} />{notice}<button type="button" className="icon-button" aria-label="关闭提示" title="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {tab === 'assessment' && <div className="assessment-layout">
        <form className="input-area" onSubmit={submit}>
          <div className="section-heading"><h2>评估材料</h2><span className="section-meta">{type === 'injury' ? '损伤程度' : '致残程度'}</span></div>
          <label className="field-label" htmlFor="description">病历与检查记录</label>
          <textarea id="description" value={description} disabled={busy} maxLength={40000} onChange={event => { setDescription(event.target.value); invalidate(); }} placeholder={config.placeholder} />
          <div className="input-meta"><span>{description.length.toLocaleString()} 字</span></div>
          <div className="context-fields"><label><span className="field-label">受伤日期</span><input type="date" value={injuryDate} max={assessmentToday()} disabled={busy} onChange={event => { setInjuryDate(event.target.value); invalidate(); }} /></label><label><span className="field-label">治疗状态</span><select value={treatmentStatus} disabled={busy} onChange={event => { setTreatmentStatus(event.target.value); invalidate(); }}><option value="unknown">尚不明确</option><option value="ongoing">治疗中</option><option value="stable">治疗终结或稳定</option></select></label></div>
          <div className="section-heading upload-heading"><h3>报告图片</h3><span className="section-meta">{images.length} / 6</span></div>
          <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden-input" aria-label="上传报告图片" onChange={upload} disabled={busy || uploading} />
          {images.length > 0 && <div className="image-list">{images.map((image, index) => <div className="image-item" key={image.id}><button type="button" className="image-preview-button" title="查看报告图片" aria-label={`查看报告图片${index + 1}`} onClick={() => setPreviewImage(image)}><img src={image.preview} alt={`报告图片${index + 1}`} /></button><div><strong>报告 {index + 1}</strong><span>{image.name}</span></div><button type="button" className="icon-button" aria-label={`移除报告图片${index + 1}`} title="移除图片" disabled={busy || uploading} onClick={() => { setImages(items => items.filter(item => item.id !== image.id)); invalidate(); }}><X size={17} /></button></div>)}</div>}
          <button type="button" className="upload-button" disabled={busy || uploading || images.length >= 6} onClick={() => inputRef.current?.click()}>{uploading ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}{uploading ? '正在处理图片' : images.length ? '添加报告图片' : '上传报告图片'}</button>
          {error && <div className="error-message" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
          <div className="assessment-actions"><button type="button" className="icon-button reset-button" aria-label="清空材料" title="清空材料" disabled={uploading} onClick={reset}><RotateCcw size={18} /></button><button type="submit" className="primary-button" disabled={busy || uploading || (!description.trim() && !images.length)}>{busy ? <Loader2 size={18} className="spin" /> : <BrandIcon size={18} />}{busy ? '正在分析' : error ? '重新分析' : '开始评估'}</button>{busy && <button type="button" className="secondary-button" onClick={cancel}><X size={16} />取消</button>}</div>
          <div className="analysis-progress" aria-live="polite">{busy ? `正在核对材料与条款 · ${elapsed} 秒` : uploading ? '正在读取和处理图片' : ''}</div>
        </form>
        <div ref={resultRef} className="result-container"><ResultView result={result} busy={busy} elapsed={elapsed} error={error} onRetry={() => submit()} retryDisabled={uploading || (!description.trim() && !images.length)} onSave={save} saved={Boolean(result && records.some(record => record.id === result.requestId))} onEditText={text => { setDescription(previous => `${previous}\n\n${text}`.trim()); invalidate(); document.getElementById('description')?.focus(); }} /></div>
      </div>}
      {tab === 'standards' && <StandardsView type={type} />}
      {tab === 'history' && <section className="history-view"><div className="section-heading"><h2>本机评估记录</h2>{(records.length > 0 || legacy) && <button type="button" className="text-button destructive" onClick={clearRecords}><Trash2 size={16} />清空记录</button>}</div>
        {legacy && <div className="legacy-notice"><AlertTriangle size={18} /><span>旧版记录可能包含模拟结果，未纳入已核对记录。</span><button type="button" className="text-button" onClick={exportLegacy}>导出旧记录</button></div>}
        {records.length ? <div className="history-list">{records.map(record => <button type="button" className="history-row" key={record.id} onClick={() => openRecord(record)}><span className="history-date">{new Date(record.result.createdAt).toLocaleString('zh-CN')}</span><strong>{record.title}</strong><span className={`status-label ${record.result.status}`}>{record.result.grade || '暂不输出等级'}</span></button>)}</div> : <div className="empty-view"><History size={30} strokeWidth={1.5} /><p>暂无已保存的评估记录</p></div>}
      </section>}
    </main>
    <footer className="app-footer">辅助评估结果不替代正式司法鉴定意见。</footer>
    {previewImage && <dialog className="preview-dialog" ref={previewRef} aria-label="报告图片预览" onClose={() => setPreviewImage(null)} onClick={event => { if (event.target === event.currentTarget) previewRef.current?.close(); }}><div className="preview-content"><div className="section-heading"><h2>{previewImage.name}</h2><button type="button" className="icon-button" aria-label="关闭图片预览" title="关闭图片预览" onClick={() => previewRef.current?.close()}><X size={18} /></button></div><img src={previewImage.preview} alt="报告图片完整预览" /></div></dialog>}
  </div>;
}
