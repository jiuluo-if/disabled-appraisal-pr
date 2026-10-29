import { resultSchema } from '../gemini/lib/contracts.js';

const key = type => `appraisal_${type}_history_v2`;
export function readHistory(type, storage) {
  try {
    storage ??= globalThis.localStorage;
    const data = JSON.parse(storage.getItem(key(type)) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(item => typeof item?.id === 'string' && typeof item?.title === 'string'
      && (item.description === undefined || typeof item.description === 'string')
      && (item.injuryDate === undefined || typeof item.injuryDate === 'string')
      && (item.treatmentStatus === undefined || ['unknown', 'ongoing', 'stable'].includes(item.treatmentStatus))
      && resultSchema.safeParse(item.result).success && item.result.assessmentType === type).slice(0, 50);
  } catch { return []; }
}

export function saveHistory(type, item, storage) {
  try { storage ??= globalThis.localStorage; } catch { throw new Error('本机存储不可用，记录未保存。'); }
  const storedResult = { ...item.result };
  delete storedResult.factAudit;
  delete storedResult.analysisSnapshot;
  const storedItem = { ...item, result: storedResult };
  const records = [storedItem, ...readHistory(type, storage).filter(record => record.id !== item.id)].slice(0, 50);
  try { storage.setItem(key(type), JSON.stringify(records)); } catch { throw new Error('本机存储空间不足或不可用，记录未保存。'); }
  return records;
}

export function clearHistory(type, storage) {
  try {
    storage ??= globalThis.localStorage;
    storage.removeItem(key(type));
    storage.removeItem(type === 'injury' ? 'injury_history' : 'disability_history');
  } catch { throw new Error('无法清除本机记录，请检查浏览器存储设置。'); }
}

export function hasLegacyHistory(type, storage) {
  try { storage ??= globalThis.localStorage; return Boolean(storage.getItem(type === 'injury' ? 'injury_history' : 'disability_history')); } catch { return false; }
}
