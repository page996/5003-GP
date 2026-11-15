/**
 * Visa Atlas v2 · 本地模糊国家匹配
 *
 * 输入即时在 250 国目录中做容错匹配，不依赖网络：
 * - 中文名 / 英文名 / ISO2 / 别名（导入只读的 data/countries.json 补别名）
 * - 忽略大小写与多余空格；子串；英文编辑距离 ≤ 1；中文按字符集合容忍字序
 */
import countryCatalog from '../../../data/countries.json';
import type { MapCountry } from '../../../shared/contracts.ts';

interface CatalogCountry {
  code: string;
  nameZh: string;
  nameEn: string;
  aliases?: string[];
}

const aliasByIso = new Map<string, string[]>();
for (const country of countryCatalog as CatalogCountry[]) {
  aliasByIso.set(country.code.toUpperCase(), country.aliases ?? []);
}

export interface CountrySuggestion {
  iso2: string;
  nameZh: string;
  nameEn: string;
  score: number;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 轻量 Levenshtein；只关心 ≤1，短路返回 2 表示“超过 1” */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const diff = Math.abs(a.length - b.length);
  if (diff > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

function isEnglishish(value: string): boolean {
  return /^[a-z][a-z .'-]*$/i.test(value);
}

function chineseCharSetMatches(query: string, target: string): boolean {
  const chars = Array.from(query).filter(char => /[\u3400-\u9fff]/.test(char));
  if (chars.length < 2) return false;
  return chars.every(char => target.includes(char));
}

function scoreOne(query: string, queryNorm: string, iso2: string, nameZh: string, nameEn: string): number {
  const zh = nameZh.trim();
  const en = nameEn.trim();
  const enNorm = normalize(en);
  const isoNorm = iso2.toLowerCase();
  let score = 0;

  if (zh === query) score = Math.max(score, 1200);
  if (isoNorm === queryNorm) score = Math.max(score, 1150);
  if (enNorm === queryNorm) score = Math.max(score, 1100);

  if (query.length >= 2) {
    if (zh.startsWith(query)) score = Math.max(score, 1020 - Math.min(60, zh.length - query.length));
    else if (zh.includes(query)) score = Math.max(score, 900);
    if (enNorm.startsWith(queryNorm)) score = Math.max(score, 980 - Math.min(60, enNorm.length - queryNorm.length));
    else if (enNorm.includes(queryNorm)) score = Math.max(score, 860);
  }

  if (isEnglishish(query) && queryNorm.length >= 3) {
    if (withinOneEdit(queryNorm, enNorm)) score = Math.max(score, 800);
    const tokens = enNorm.split(/[^a-z]+/).filter(token => token.length >= 2);
    for (const token of tokens) {
      if (token === queryNorm) score = Math.max(score, 900);
      else if (token.startsWith(queryNorm)) score = Math.max(score, 840);
      else if (token.length >= 4 && withinOneEdit(queryNorm, token)) score = Math.max(score, 760);
    }
  }

  for (const alias of aliasByIso.get(iso2) ?? []) {
    const aliasNorm = normalize(alias);
    if (!aliasNorm) continue;
    if (aliasNorm === queryNorm) score = Math.max(score, 1080);
    else if (aliasNorm.startsWith(queryNorm) && queryNorm.length >= 2) score = Math.max(score, 920);
    else if (aliasNorm.includes(queryNorm) && queryNorm.length >= 2) score = Math.max(score, 700);
    else if (isEnglishish(query) && queryNorm.length >= 3 && withinOneEdit(queryNorm, aliasNorm)) {
      score = Math.max(score, 640);
    }
  }

  if (chineseCharSetMatches(query, zh)) score = Math.max(score, 520);
  return score;
}

/** 返回最多 limit 条国家建议，按匹配强度降序 */
export function suggestCountries(countries: MapCountry[], rawQuery: string, limit = 6): CountrySuggestion[] {
  const query = rawQuery.trim();
  if (!query) return [];
  const queryNorm = normalize(query);
  const scored: CountrySuggestion[] = [];

  for (const country of countries) {
    const score = scoreOne(query, queryNorm, country.iso2, country.nameZh, country.nameEn);
    if (score > 0) {
      scored.push({ iso2: country.iso2, nameZh: country.nameZh, nameEn: country.nameEn, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.nameZh.localeCompare(b.nameZh, 'zh-Hans-CN'));
  return scored.slice(0, limit);
}
