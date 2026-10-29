import { hasExplicitLimbLengthDifferenceLink, hasExplicitOrbitalFractureEnophthalmosLink, parseNumber } from './facts.js';
import { normalizeForMatching } from './text-normalization.js';

const normalize = normalizeForMatching;
const reliableCertainties = new Set(['reported', 'observed', 'derived']);
export function quotedPredicateEvidenceValue(predicate, fact, facts = []) {
  if (!Number.isFinite(fact.value)) return null;
  if (predicate.field === 'orbital_enophthalmos_cm') {
    const evidence = normalize(String(fact.evidence || ''));
    const measurements = [...evidence.matchAll(/(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(cm|厘米|mm|毫米)/gu)];
    if (measurements.length !== 1
      || !hasExplicitOrbitalFractureEnophthalmosLink(evidence)
      || /(?:未达|低于|小于|不足|不超过|少于|超过|大于|至少|以上|以下|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除|未见|未发现|否认|排除)/u.test(evidence)) return null;
    const amount = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    const centimetres = /^(?:mm|毫米)$/u.test(measurements[0][2]) ? amount / 10 : amount;
    return Number.isFinite(centimetres) && centimetres === fact.value && centimetres >= 0 ? centimetres : null;
  }
  if (predicate.field === 'limb_length_difference_cm') {
    const evidence = normalize(String(fact.evidence || ''));
    const measurements = [...evidence.matchAll(/(?:双|两)(?:上|下)肢(?:相对)?(?:长度|长短)(?:相差|差值|差距|差异)\s*(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(cm|厘米|mm|毫米)/gu)];
    const allLengthMeasurements = [...evidence.matchAll(/(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:cm|厘米|mm|毫米)/gu)];
    if (measurements.length !== 1 || allLengthMeasurements.length !== 1
      || !hasExplicitLimbLengthDifferenceLink(evidence)
      || /(?:未达|低于|小于|不足|不超过|少于|以下|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除|未见|未发现|否认|排除)/u.test(evidence)) return null;
    const amount = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    const centimetres = /^(?:mm|毫米)$/u.test(measurements[0][2]) ? amount / 10 : amount;
    const lowerBound = /(?:至少|不低于|不小于|大于|超过|以上)/u.test(evidence);
    return Number.isFinite(centimetres) && centimetres === fact.value && centimetres >= 0
      && !(lowerBound && predicate.operator === 'gte' && centimetres < predicate.value) ? centimetres : null;
  }
  if (predicate.field === 'gcs_score') {
    const evidence = normalize(String(fact.evidence || ''));
    const score = /(?:GCS|格拉斯哥昏迷评分)\s*(?:评分|分数)?\s*[:：=]?\s*(1[0-5]|[3-9])\s*分?/iu.exec(evidence);
    return score && Number(score[1]) === fact.value ? fact.value : null;
  }
  const number = '(\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百]+)';
  const unit = predicate.unit === 'cm' ? '(?:cm|厘米)'
    : predicate.unit === 'cm2' ? '(?:cm2|平方厘米)'
    : predicate.unit ? predicate.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const evidence = normalize(String(fact.evidence || ''));
  const facialScarMeasurementCues = {
    facial_scar_width_cm: /面部/u.test(evidence) && /条状瘢痕|条状疤痕/u.test(evidence) && /宽(?:度)?/u.test(evidence),
    aggregate_facial_scar_length_cm: /面部/u.test(evidence) && /条状瘢痕|条状疤痕/u.test(evidence)
      && /(?:累计|总计|合计)[^。；;]{0,12}长度|长度[^。；;]{0,12}(?:累计|总计|合计)/u.test(evidence),
    facial_center_scar_length_cm: /面部中心区/u.test(evidence) && /条状瘢痕|条状疤痕/u.test(evidence)
      && /长度|位于/u.test(evidence),
  };
  if (Object.hasOwn(facialScarMeasurementCues, predicate.field)) {
    const measurements = [...evidence.matchAll(new RegExp(`${number}\\s*${unit}`, 'gu'))];
    const uncertainOrComparative = /(?:未达|低于|小于|不足|不超过|少于|超过|大于|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除|未见|未发现|否认|排除)/u.test(evidence);
    const beforeMeasurement = measurements.length === 1
      ? evidence.slice(Math.max(0, measurements[0].index - 24), measurements[0].index) : '';
    if (measurements.length !== 1 || !facialScarMeasurementCues[predicate.field] || uncertainOrComparative
      || /(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:-|–|—|至|到)\s*$/u.test(beforeMeasurement)) return null;
    const sourceValue = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 ? sourceValue : null;
  }
  if (predicate.field === 'contusion_tbsa_percent') {
    const measurements = [...evidence.matchAll(new RegExp(`${number}\\s*(?:%|％)`, 'gu'))];
    const beforeMeasurement = measurements.length === 1
      ? evidence.slice(Math.max(0, measurements[0].index - 30), measurements[0].index) : '';
    if (measurements.length !== 1 || /擦伤|烧伤|烫伤|瘢痕|疤痕|未达|低于|小于|不足|不超过|少于|超过|大于|至少|以上|以下|约|大约|左右|接近|估计/u.test(evidence)
      || /(?:\d+(?:\.\d+)?)\s*(?:-|–|—|至|到)\s*$/u.test(beforeMeasurement)
      || !/挫伤/u.test(evidence) || !/(?:体表面积|TBSA)/iu.test(evidence)
      || !/挫伤[^，,；;]{0,24}面积[^，,；;]{0,24}(?:体表面积|TBSA)/iu.test(evidence)) return null;
    const sourceValue = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 && sourceValue <= 100
      ? sourceValue : null;
  }
  if (predicate.field === 'facial_skin_abnormality_area_percent') {
    const percentPattern = /(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:%|％)|百分之(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)/gu;
    const measurements = [...evidence.matchAll(percentPattern)];
    if (measurements.length !== 1 || !/(?:面部|脸部|面颊)/u.test(evidence)
      || !/(?:面部|脸部)面积/u.test(evidence)
      || !/(?:色素显著异常|色素异常|色素沉着|片状细小瘢痕|细小瘢痕)/u.test(evidence)
      || /(?:未达|低于|小于|不足|不超过|少于|超过|大于|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除)/u.test(evidence)) return null;
    const token = measurements[0][1] || measurements[0][2];
    const sourceValue = /^\d+(?:\.\d+)?$/u.test(token) ? Number(token) : parseNumber(token);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 && sourceValue <= 100
      ? sourceValue : null;
  }
  if (typeof predicate.field === 'string' && predicate.field.startsWith('burn_tbsa_')) {
    const measurements = [...evidence.matchAll(new RegExp(`${number}\\s*(?:%|％)`, 'gu'))];
    const degrees = [...evidence.matchAll(/(深\s*)?(III|Ⅲ|三|II|Ⅱ|二)\s*(?:度|o|°)(?:以上|及以上)?/giu)];
    const beforeMeasurement = measurements.length === 1
      ? evidence.slice(Math.max(0, measurements[0].index - 30), measurements[0].index) : '';
    if (measurements.length !== 1 || degrees.length !== 1 || !/烧(?:烫)?伤|烫伤/u.test(evidence)
      || !/(?:体表面积|TBSA)/iu.test(evidence) || !/面积/u.test(evidence)
      || /(?:未达|低于|小于|不足|不超过|少于|超过|大于|至少|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除)/u.test(evidence)
      || /(?:\d+(?:\.\d+)?)\s*(?:-|–|—|至|到)\s*$/u.test(beforeMeasurement)) return null;
    const degree = degrees[0];
    const className = normalize(degree[2]).toUpperCase();
    const isThird = className === 'III' || className === '三';
    const isSecond = className === 'II' || className === '二';
    const isDeepSecond = isSecond && Boolean(degree[1]);
    if (predicate.field === 'burn_tbsa_iii_percent' && !isThird
      || predicate.field === 'burn_tbsa_deep_ii_plus_percent' && !isThird && !isDeepSecond
      || predicate.field === 'burn_tbsa_ii_plus_percent' && !isThird && !isSecond) return null;
    const sourceValue = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 && sourceValue <= 100
      ? sourceValue : null;
  }
  if (typeof predicate.field === 'string' && predicate.field.startsWith('burn_area_')) {
    const measurements = [...evidence.matchAll(new RegExp(`${number}\\s*(?:cm\\s*2|平方厘米)`, 'giu'))];
    const uncertainOrComparative = /(?:未达|低于|小于|不足|不超过|少于|超过|大于|至少|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除|未见|未发现|否认|排除|无)/u.test(evidence);
    const beforeMeasurement = measurements.length === 1
      ? evidence.slice(Math.max(0, measurements[0].index - 30), measurements[0].index) : '';
    if (measurements.length !== 1 || uncertainOrComparative || !/烧(?:烫)?伤|烫伤/u.test(evidence)
      || /(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:-|–|—|至|到)\s*$/u.test(beforeMeasurement)) return null;
    const field = predicate.field;
    const siteMatches = field.includes('_face_') ? /面部|脸部|颜面/u.test(evidence)
      && !/颈部|体表|身体/u.test(evidence)
      : field.includes('_neck_') ? /颈部/u.test(evidence) && !/面部|脸部|颜面|体表|身体/u.test(evidence)
        : /体表|身体/u.test(evidence) && !/面部|脸部|颜面|颈部/u.test(evidence);
    const degreeMatches = field.includes('_first_degree_')
      ? /(?:(?<!I)I(?!I)|Ⅰ|一)\s*(?:度|o|°)(?!以上|及以上)/iu.test(evidence)
        && !/浅\s*(?:II|Ⅱ|二)\s*(?:度|o|°)|深\s*(?:II|Ⅱ|二)\s*(?:度|o|°)|(?<!I)I(?=I\s*(?:度|o|°))/iu.test(evidence)
      : /浅\s*(?:II|Ⅱ|二)\s*(?:度|o|°)(?!以上|及以上)/iu.test(evidence)
        && !/深\s*(?:II|Ⅱ|二)\s*(?:度|o|°)|(?:(?<!I)I(?!I)|Ⅰ|一)\s*(?:度|o|°)/iu.test(evidence);
    if (!siteMatches || !degreeMatches) return null;
    const sourceValue = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 ? sourceValue : null;
  }
  if (predicate.field === 'scalp_defect_area_cm2' || predicate.field === 'scalp_avulsion_area_cm2') {
    const measurements = [...evidence.matchAll(new RegExp(`${number}\\s*(?:cm\\s*2|平方厘米)`, 'giu'))];
    const beforeMeasurement = measurements.length === 1
      ? evidence.slice(Math.max(0, measurements[0].index - 30), measurements[0].index) : '';
    const siteMatches = /头皮|头顶部|额顶部|颞顶部|颞枕部|顶枕部|枕顶部|枕部/u.test(evidence);
    const typeMatches = predicate.field === 'scalp_defect_area_cm2'
      ? /缺损/u.test(evidence) : /撕脱(?:伤|创)?/u.test(evidence);
    if (measurements.length !== 1 || !siteMatches || !typeMatches || !/面积/u.test(evidence)
      || /(?:约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除|未达|低于|小于|不足|不超过|少于|超过|大于|至少|未见|未发现|否认|排除|无)/u.test(evidence)
      || /(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:-|–|—|至|到)\s*$/u.test(beforeMeasurement)) return null;
    const sourceValue = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 ? sourceValue : null;
  }
  if (predicate.field === 'fracture_site_count' && fact.certainty === 'derived'
    && fact.source === 'description' && fact.verification === 'quoted'
    && Array.isArray(fact.derivedFrom) && fact.derivedFrom.length > 0) {
    const parents = fact.derivedFrom.map(id => facts.find(candidate => candidate.id === id));
    const ribNumberParents = parents.filter(parent => parent?.field === 'fractured_rib_numbers'
      && parent.source === 'description' && parent.verification === 'quoted'
      && ['reported', 'observed', 'derived'].includes(parent.certainty)
      && Array.isArray(parent.value) && parent.value.length > 0
      && parent.value.every(value => Number.isInteger(value) && value > 0)
      && parent.eventId === fact.eventId);
    const rootCountParents = parents.filter(parent => parent?.field === 'fractured_rib_count'
      && parent.source === 'description' && parent.verification === 'quoted'
      && ['reported', 'observed', 'derived'].includes(parent.certainty)
      && Number.isInteger(parent.value) && parent.value > 0 && parent.eventId === fact.eventId
      && quotedPredicateEvidenceValue({ field: 'fractured_rib_count', unit: '根' }, parent, facts) === parent.value);
    const distinctRibNumbers = new Set(ribNumberParents.flatMap(parent => parent.value));
    const countsBySide = new Map();
    let unspecifiedRootCount = 0;
    for (const parent of rootCountParents) {
      const sideMatch = /(?:左侧|左)(?=第|\d|[零〇一二两三四五六七八九十百])/.test(parent.evidence) ? 'left'
        : /(?:右侧|右)(?=第|\d|[零〇一二两三四五六七八九十百])/.test(parent.evidence) ? 'right' : null;
      if (sideMatch) countsBySide.set(sideMatch, Math.max(countsBySide.get(sideMatch) || 0, parent.value));
      else unspecifiedRootCount = Math.max(unspecifiedRootCount, parent.value);
    }
    const rootCountLowerBound = Math.max([...countsBySide.values()].reduce((sum, value) => sum + value, 0),
      unspecifiedRootCount);
    const lowerBound = Math.max(distinctRibNumbers.size, rootCountLowerBound);
    const upperBound = Math.max(distinctRibNumbers.size * 2, rootCountLowerBound);
    if (fact.eventId && ribNumberParents.length + rootCountParents.length === parents.length
      && lowerBound > 0 && fact.value >= lowerBound && fact.value <= upperBound) return fact.value;
    return null;
  }
  if (['surface_scar_area_cm2', 'aggregate_surface_scar_area_cm2'].includes(predicate.field)) {
    const measurements = [...evidence.matchAll(new RegExp(`${number}\\s*(?:cm2|平方厘米)`, 'gu'))];
    const aggregate = predicate.field === 'aggregate_surface_scar_area_cm2';
    const beforeMeasurement = measurements.length === 1
      ? evidence.slice(Math.max(0, measurements[0].index - 24), measurements[0].index) : '';
    if (measurements.length !== 1 || !/(?:瘢痕|疤痕)/u.test(evidence) || !/面积/u.test(evidence)
      || aggregate && !/(?:累计|总面积|合计)/u.test(evidence)
      || !aggregate && /(?:多块|多处|多个|累计|总面积|合计)/u.test(evidence)
      || /(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:-|–|—|至|到)\s*$/u.test(beforeMeasurement)
      || /(?:未达|低于|小于|不足|不超过|少于|超过|大于|至少|约|大约|左右|接近|估计|可疑|疑似|考虑|可能|待排|不排除)/u.test(evidence)) return null;
    const sourceValue = /^\d/u.test(measurements[0][1]) ? Number(measurements[0][1]) : parseNumber(measurements[0][1]);
    return Number.isFinite(sourceValue) && sourceValue === fact.value && sourceValue >= 0 ? sourceValue : null;
  }
  for (const match of evidence.matchAll(new RegExp(`${number}\\s*${unit}`, 'gu'))) {
    const sourceValue = /^\d+(?:\.\d+)?$/.test(match[1]) ? Number(match[1]) : parseNumber(match[1]);
    if (Number.isFinite(sourceValue) && sourceValue === fact.value) return sourceValue;
  }
  if (predicate.field === 'wound_length_cm'
    && (/(?:创口|伤口|裂口|裂创|裂伤|切口)/u.test(evidence)
      || /(?:瘢痕|疤痕)/u.test(evidence) && /横(?:行|向)|纵(?:行|向)|线状|条状/u.test(evidence))) {
    const dimensions = new RegExp(`${number}\\s*(?:${unit})?\\s*[×xX*]\\s*${number}\\s*${unit}`, 'gu');
    for (const match of evidence.matchAll(dimensions)) {
      const first = /^\d+(?:\.\d+)?$/u.test(match[1]) ? Number(match[1]) : parseNumber(match[1]);
      const second = /^\d+(?:\.\d+)?$/u.test(match[2]) ? Number(match[2]) : parseNumber(match[2]);
      const longAxis = Math.max(first, second);
      const shortAxis = Math.min(first, second);
      if (Number.isFinite(longAxis) && Number.isFinite(shortAxis) && shortAxis > 0
        && longAxis / shortAxis >= 1.5 && longAxis === fact.value) return longAxis;
    }
  }
  return null;
}
