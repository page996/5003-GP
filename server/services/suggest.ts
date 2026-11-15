/**
 * 搜索框联想：最多 8 条，顺序「国家 > 别名 > 政策类别 > 签证类型」。
 *
 * 空 q 返回空数组（前端不需要请求）；q 超过 40 字符由 API 层返回 400。
 */
import type { Suggestion } from '../../shared/contracts.ts';
import type { DatabaseDriver } from '../db/driver.ts';
import { loadDictionaries, loadSynonyms, listCountriesForSuggest } from '../db/repository.ts';

const MAX_SUGGESTIONS = 8;

export async function suggest(driver: DatabaseDriver, rawQuery: string): Promise<Suggestion[]> {
  const query = rawQuery.trim();
  if (query === '') return [];
  const lower = query.toLowerCase();

  const [countries, dictionaries, synonyms] = await Promise.all([
    listCountriesForSuggest(driver, query),
    loadDictionaries(driver),
    loadSynonyms(driver),
  ]);

  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (suggestion: Suggestion): void => {
    if (suggestions.length >= MAX_SUGGESTIONS) return;
    // 国家/别名去重：同一 iso2 同一展示文案只保留先到的 country（别名不再重复出现）
    if (suggestion.kind === 'country' || suggestion.kind === 'alias') {
      const iso2 = suggestion.iso2 ?? '';
      const duplicated = suggestions.some(
        existing =>
          (existing.kind === 'country' || existing.kind === 'alias') &&
          (existing.iso2 ?? '') === iso2 &&
          existing.label === suggestion.label,
      );
      if (duplicated) return;
    }
    const key = `${suggestion.kind}:${suggestion.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push(suggestion);
  };

  for (const country of countries) {
    const regionLabel = dictionaries.regionMap.get(country.regionCode)?.nameZh ?? country.regionCode;
    push({
      kind: 'country',
      code: country.iso2,
      label: country.nameZh,
      hint: `${country.nameEn} · ${regionLabel}`,
      iso2: country.iso2,
    });
  }

  for (const synonym of synonyms) {
    if (synonym.kind !== 'COUNTRY') continue;
    if (!synonym.term.toLowerCase().includes(lower)) continue;
    const canonical = synonym.canonical.trim().toUpperCase();
    const iso2 = /^[A-Z]{2}$/.test(canonical) ? canonical : undefined;
    push({
      kind: 'alias',
      code: synonym.canonical,
      label: synonym.term,
      hint: iso2 ? `国家别名 → ${iso2}` : '国家别名',
      ...(iso2 ? { iso2 } : {}),
    });
  }

  for (const category of dictionaries.categories) {
    if (
      category.nameZh.includes(query) ||
      category.nameEn.toLowerCase().includes(lower) ||
      category.code.toLowerCase().includes(lower)
    ) {
      push({
        kind: 'category',
        code: category.code,
        label: category.nameZh,
        hint: `政策类别 · ${dictionaries.groupMap.get(category.group)?.nameZh ?? category.group}`,
      });
    }
  }

  for (const type of dictionaries.types) {
    if (type.nameZh.includes(query) || type.nameEn.toLowerCase().includes(lower) || type.code.toLowerCase().includes(lower)) {
      push({ kind: 'type', code: type.code, label: type.nameZh, hint: `签证类型 · ${type.nameEn}` });
    }
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}
