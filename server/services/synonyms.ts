/**
 * 检索关键词的同义词扩展。
 *
 * 数据来源是 search_synonyms 表（ETL 从 data/source/synonyms.json 合并），
 * 约定 canonical 可能是一个 ISO2（国家）、类型代码、类别代码或中文关键词：
 * - 国家别名：term=英国 → canonical=GB；
 * - 签证类型：term=商签 → canonical=BUSINESS；
 * - 政策类别：term=双向免签 → canonical=MUTUAL_FREE；
 * - 关键词：term=visa free → canonical=免签。
 *
 * 因此扩展算法是双向的：token 命中 term 时加入 canonical 与其同组词；
 * token 命中 canonical 时加入组内全部 term。表为空时退化为纯分词。
 */
import type { SynonymRowData } from '../db/repository.ts';

export interface TokenGroup {
  alternatives: string[];
}

export interface SynonymIndex {
  byTerm: ReadonlyMap<string, { canonical: string; weight: number }>;
  termsByCanonical: ReadonlyMap<string, { term: string; weight: number }[]>;
  /** 含空格的词条（如 visa free）在分词前先做整句替换 */
  multiWordTerms: readonly { term: string; canonical: string }[];
}

export interface ExpandedQuery {
  /** 实际参与匹配的分词 */
  tokens: string[];
  /** 每个 token 的候选写法（token 本身 + 同义词） */
  tokenGroups: TokenGroup[];
  /** 同义词整句替换后的查询串，便于调试/日志 */
  rewritten: string;
}

const MAX_TOKENS = 24;
const MAX_ALTERNATIVES = 8;

export function buildSynonymIndex(rows: readonly SynonymRowData[]): SynonymIndex {
  const byTerm = new Map<string, { canonical: string; weight: number }>();
  const termsByCanonical = new Map<string, { term: string; weight: number }[]>();
  const multiWordTerms: { term: string; canonical: string }[] = [];

  for (const row of rows) {
    const term = row.term.trim();
    const canonical = row.canonical.trim();
    if (!term || !canonical) continue;
    const lowerTerm = term.toLowerCase();
    const lowerCanonical = canonical.toLowerCase();

    byTerm.set(lowerTerm, { canonical, weight: row.weight });
    const group = termsByCanonical.get(lowerCanonical) ?? [];
    group.push({ term, weight: row.weight });
    termsByCanonical.set(lowerCanonical, group);
    if (/\s/.test(term)) multiWordTerms.push({ term, canonical });
  }

  multiWordTerms.sort((a, b) => b.term.length - a.term.length);
  return { byTerm, termsByCanonical, multiWordTerms };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把含空格的长词条替换成 canonical，让 "visa free" 这类输入回到单 token */
function rewriteMultiWordTerms(raw: string, index: SynonymIndex): string {
  let text = raw.trim();
  for (const entry of index.multiWordTerms) {
    if (!text.toLowerCase().includes(entry.term.toLowerCase())) continue;
    text = text.replace(new RegExp(escapeRegExp(entry.term), 'gi'), entry.canonical);
  }
  return text;
}

function addAlternative(target: { value: string; weight: number }[], seen: Set<string>, value: string, weight: number): void {
  const key = value.toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push({ value, weight });
}

export function expandQuery(raw: string, index: SynonymIndex): ExpandedQuery {
  const rewritten = rewriteMultiWordTerms(raw, index);
  const tokens = rewritten
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .slice(0, MAX_TOKENS);

  const tokenGroups: TokenGroup[] = tokens.map(token => {
    const lower = token.toLowerCase();
    const collected: { value: string; weight: number }[] = [];
    const seen = new Set<string>();
    addAlternative(collected, seen, token, Number.POSITIVE_INFINITY);

    const direct = index.byTerm.get(lower);
    if (direct) {
      addAlternative(collected, seen, direct.canonical, direct.weight);
      for (const sibling of index.termsByCanonical.get(direct.canonical.toLowerCase()) ?? []) {
        addAlternative(collected, seen, sibling.term, sibling.weight);
      }
    }

    // token 本身是某个 canonical（如 GB / BUSINESS / 免签）时，反向加入组内所有写法
    const reverse = index.termsByCanonical.get(lower);
    if (reverse) {
      for (const sibling of reverse) addAlternative(collected, seen, sibling.term, sibling.weight);
    }

    return {
      alternatives: collected
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_ALTERNATIVES)
        .map(item => item.value),
    };
  });

  return { tokens, tokenGroups, rewritten };
}
