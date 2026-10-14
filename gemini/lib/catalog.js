import fs from 'node:fs';
import MiniSearch from 'minisearch';

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const tokenize = value => [...segmenter.segment(value.normalize('NFKC'))]
  .filter(part => part.isWordLike).map(part => part.segment.toLowerCase());

export const catalogs = Object.fromEntries(['injury', 'disability'].map(type => {
  const catalog = JSON.parse(fs.readFileSync(new URL(`../data/${type}.json`, import.meta.url), 'utf8'));
  return [type, catalog];
}));

const indexes = Object.fromEntries(Object.entries(catalogs).map(([type, catalog]) => {
  const index = new MiniSearch({ fields: ['text', 'category'], storeFields: ['id'], tokenize });
  index.addAll(catalog.clauses);
  return [type, index];
}));

export function retrieveClauses(type, description, limit = 28) {
  const catalog = catalogs[type];
  const matches = indexes[type].search(description, { combineWith: 'OR', boost: { text: 2 } });
  const ids = new Set(matches.slice(0, limit).map(match => match.id));
  return catalog.clauses.filter(clause => ids.has(clause.id));
}

export function catalogContext(type, clauses) {
  const { standard, principles } = catalogs[type];
  return JSON.stringify({ standard, principles, clauses });
}
