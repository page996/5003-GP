import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  POLICY_GROUPS,
  REGIONS,
  VISA_CATEGORIES,
  VISA_TYPES,
  formatStay,
} from '../shared/contracts.ts';
import type { EntryScope, PolicyGroup, StayRule, StayUnit } from '../shared/contracts.ts';

export type Lang = 'zh' | 'en';

const DICTIONARY = {
  zh: {
    'app.title': 'Visa Atlas · 世界签证图谱',
    'brand.subtitle': '中国普通护照 · 世界签证图谱',
    'lang.switch': '切换到 English',
    'lang.label': 'EN',
    'notes.eyebrow': 'ABOUT THIS ATLAS',
    'notes.title': '数据说明',
    'notes.close': '关闭数据说明',
    'notes.dataset': '数据集',
    'notes.datasetText': '版本 {version} · {countries} 个国家与地区 · {policies} 条旅游签政策 · 平均完整度 {completeness}%。',
    'notes.source': '来源',
    'notes.sourceText': '小组整理的公开信息 CSV（单一来源，{countries} 国目录）；未附逐国官方链接，未经使领馆逐条核验。',
    'notes.maturity': '资料成熟度',
    'notes.maturityText': '真实资料为摘要级：有政策分类与一句官方口径摘要，费用、材料、审核时间尚未采集，界面不预留这些空位。',
    'notes.demo': '另有 {count} 条虚构演示样本，仅保留在后端作为回归夹具，不进入界面。',
    'notes.disclaimer': '免责声明',
    'notes.disclaimerText': '本项目的签证信息来自公开资料整理，未经使领馆逐条确认，不构成签证、法律或出行建议。请以中国领事服务网与目的地使领馆最新公告为准。',
    'globe.loading': '正在载入地球…',
    'globe.errorTitle': '地球加载失败',
    'globe.errorHint': '请检查本地几何数据后重试',
    'globe.retry': '重新加载',
    'globe.controls': '地球缩放控制',
    'globe.zoomIn': '放大',
    'globe.zoomOut': '缩小',
    'globe.reset': '重置地球',
    'globe.aria': '世界签证地球：拖拽拨动地球，滚轮缩放，点击国家查看签证档案',
    'app.booting': '正在准备地图数据',
    'app.loadFailed': '无法读取数据集，请稍后重试。',
    'app.retry': '重试',
    'app.hints': '拖拽旋转 · 滚轮缩放 · 点击国家',
    'app.destinations': '{countries} 个目的地 · 数据更新 {date}',
    'app.legendTitle': '地图色 = 旅游签政策',
    'hover.categoryPending': '类别待确认',
    'hover.notCollected': '待采集',
    'hover.stayPending': '停留期待确认',
    'hover.open': '点击查看档案 →',
    'search.placeholder': '搜索国家、签证类型或关键词',
    'search.aria': '搜索国家、签证类型或关键词',
    'search.clear': '清空搜索',
    'search.graph': '知识图谱',
    'search.hits': '命中 {count} 个目的地',
    'search.took': '用时 {ms} ms',
    'search.suggestions': '国家建议',
    'search.localFuzzy': '本地模糊匹配',
    'search.noExact': '没有精确匹配，已列出相近国家',
    'search.noResults': '没有找到「{query}」',
    'search.keyboard': '↑↓ 选择  Enter 打开档案  Esc 关闭',
    'search.retry': '重试',
    'search.searching': '正在检索…',
    'search.noResultsAny': '没有符合条件的目的地',
    'search.noResultsHint': '已为你列出相近国家，可直接点击打开档案；也可以试试这些预置词：',
    'search.panelAria': '搜索建议与结果',
    'search.clearType': '取消{type}类型筛选',
    'search.routePreset': '搜索预置词',
    'sheet.close': '关闭国家档案',
    'sheet.retry': '重试',
    'sheet.emptyTitle': '目录内国家，本轮 249 国采集未包含',
    'sheet.emptyHint': '{name}在 250 国目录中，但本轮 CSV 未提供旅游签政策。这不代表不需要签证；请以官方公告为准。',
    'sheet.caseByCase': '逐案确认',
    'sheet.stayPending': '停留期待确认',
    'sheet.priority': '重点候选',
    'sheet.types': '其他常见签证类型',
    'sheet.noTypes': '其他常见签证类型：暂无更多线索',
    'sheet.source': '来源：',
    'sheet.localCsv': '小组整理 CSV',
    'sheet.warning': '未经使领馆逐条核验；资料仅供课程项目参考，请以官方最新公告为准。',
    'sheet.noPolicy': '本轮尚未采集到该国的旅游签结构化政策，不代表不需要签证。',
    'graph.country': '国家',
    'graph.region': '地区',
    'graph.group': '政策组',
    'graph.category': '签证类别',
    'graph.visaType': '签证类型',
    'result.typeClue': '类型线索',
    'result.priority': '重点',
    'result.stayPending': '停留期待确认',
    'result.categoryPending': '类别待确认',
  },
  en: {
    'app.title': 'Visa Atlas · World Visa Atlas',
    'brand.subtitle': 'Chinese Ordinary Passport · World Visa Atlas',
    'lang.switch': '切换到中文',
    'lang.label': '中文',
    'notes.eyebrow': 'ABOUT THIS ATLAS',
    'notes.title': 'Data notes',
    'notes.close': 'Close data notes',
    'notes.dataset': 'Dataset',
    'notes.datasetText': 'Version {version} · {countries} countries and regions · {policies} tourism-visa policies · average completeness {completeness}%.',
    'notes.source': 'Source',
    'notes.sourceText': 'A single group-compiled public-information CSV ({countries} country catalog); no per-country official links, not individually verified by embassies or consulates.',
    'notes.maturity': 'Data maturity',
    'notes.maturityText': 'Real data is summary-level: policy category and a one-line official-style summary. Fees, documents and processing times have not been collected and the UI intentionally leaves no empty placeholders for them.',
    'notes.demo': '{count} fictional demo records remain in the backend only as regression fixtures and are not shown in the UI.',
    'notes.disclaimer': 'Disclaimer',
    'notes.disclaimerText': 'Visa information is compiled from public sources and has not been individually confirmed by embassies or consulates. It is not visa, legal or travel advice. Always check the latest official announcements from the Chinese consular service and destination embassies.',
    'globe.loading': 'Loading globe…',
    'globe.errorTitle': 'Globe failed to load',
    'globe.errorHint': 'Check the local geometry data and retry',
    'globe.retry': 'Reload',
    'globe.controls': 'Globe zoom controls',
    'globe.zoomIn': 'Zoom in',
    'globe.zoomOut': 'Zoom out',
    'globe.reset': 'Reset globe',
    'globe.aria': 'World visa globe: drag to rotate, scroll to zoom, click a country to open its visa dossier',
    'app.booting': 'Preparing map data',
    'app.loadFailed': 'Unable to load the dataset. Please try again.',
    'app.retry': 'Retry',
    'app.hints': 'Drag to rotate · Scroll to zoom · Click a country',
    'app.destinations': '{countries} destinations · Data updated {date}',
    'app.legendTitle': 'Map color = tourism visa policy',
    'hover.categoryPending': 'Category pending',
    'hover.notCollected': 'Not collected',
    'hover.stayPending': 'Stay pending',
    'hover.open': 'Open dossier →',
    'search.placeholder': 'Search countries, visa types or keywords',
    'search.aria': 'Search countries, visa types or keywords',
    'search.clear': 'Clear search',
    'search.graph': 'Knowledge graph',
    'search.hits': '{count} destinations matched',
    'search.took': '{ms} ms',
    'search.suggestions': 'Country suggestions',
    'search.localFuzzy': 'Local fuzzy match',
    'search.noExact': 'No exact match; showing similar countries',
    'search.noResults': 'No results for “{query}”',
    'search.keyboard': '↑↓ select  Enter open  Esc close',
    'search.retry': 'Retry',
    'search.searching': 'Searching…',
    'search.noResultsAny': 'No matching destinations',
    'search.noResultsHint': 'Similar countries are listed above; try these presets:',
    'search.panelAria': 'Search suggestions and results',
    'search.clearType': 'Clear {type} type filter',
    'search.routePreset': 'Search presets',
    'sheet.close': 'Close country dossier',
    'sheet.retry': 'Retry',
    'sheet.emptyTitle': 'In the catalog, but not part of this 249-country collection',
    'sheet.emptyHint': '{name} is in the 250-country catalog, but this CSV did not provide a tourism-visa policy. This does not mean no visa is required; check official announcements.',
    'sheet.caseByCase': 'Case-by-case',
    'sheet.stayPending': 'Stay pending',
    'sheet.priority': 'Priority',
    'sheet.types': 'Other common visa types',
    'sheet.noTypes': 'Other common visa types: no further clues',
    'sheet.source': 'Source: ',
    'sheet.localCsv': 'group-compiled CSV',
    'sheet.warning': 'Not individually verified by embassies or consulates; for course reference only. Always check the latest official announcements.',
    'sheet.noPolicy': 'No structured tourism-visa policy was collected for this country in this round; this does not mean no visa is required.',
    'graph.country': 'Country',
    'graph.region': 'Region',
    'graph.group': 'Policy group',
    'graph.category': 'Visa category',
    'graph.visaType': 'Visa type',
    'result.typeClue': 'Type clue',
    'result.priority': 'Priority',
    'result.stayPending': 'Stay pending',
    'result.categoryPending': 'Category pending',
  },
} as const;

export type TranslationKey = keyof (typeof DICTIONARY)['zh'];

const LANGUAGE_STORAGE_KEY = 'visaatlas-lang';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const interpolate = (template: string, values?: Record<string, string | number>): string =>
  values
    ? template.replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
      )
    : template;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'zh';
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh';
  });

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }, []);

  const toggleLang = useCallback(() => setLang(lang === 'zh' ? 'en' : 'zh'), [lang, setLang]);

  useEffect(() => {
    document.title = interpolate(DICTIONARY[lang]['app.title']);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      toggleLang,
      t: (key, values) => interpolate(DICTIONARY[lang][key], values),
    }),
    [lang, setLang, toggleLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside LanguageProvider');
  return value;
}

/* ------------------------------------------------------------------ */
/* 数据字典 / 停留期 / 枚举的中英文格式化                               */
/* ------------------------------------------------------------------ */

export const policyGroupName = (code: PolicyGroup | string | null | undefined, lang: Lang): string => {
  if (!code) return lang === 'en' ? 'Unknown' : '未知';
  const group = POLICY_GROUPS.find(item => item.code === code);
  return group ? (lang === 'en' ? group.nameEn : group.nameZh) : String(code);
};

export const categoryName = (code: string | null | undefined, lang: Lang): string => {
  if (!code) return lang === 'en' ? 'Category pending' : '类别待确认';
  const category = VISA_CATEGORIES.find(item => item.code === code);
  return category ? (lang === 'en' ? category.nameEn : category.nameZh) : code;
};

export const regionName = (code: string | null | undefined, lang: Lang): string => {
  const region = REGIONS.find(item => item.code === code);
  return region ? (lang === 'en' ? region.nameEn : region.nameZh) : code ?? '';
};

export const visaTypeName = (code: string | null | undefined, lang: Lang): string => {
  const type = VISA_TYPES.find(item => item.code === code);
  return type ? (lang === 'en' ? type.nameEn : type.nameZh) : code ?? '';
};

export const countryName = (zh: string, en: string | null | undefined, lang: Lang): string =>
  lang === 'en' ? en || zh : zh;

export const entryScopeName = (scope: EntryScope | null | undefined, lang: Lang): string => {
  if (scope === 'SINGLE') return lang === 'en' ? 'Single entry' : '单次入境';
  if (scope === 'MULTIPLE') return lang === 'en' ? 'Multiple entries' : '多次入境';
  return lang === 'en' ? 'Entries pending' : '入境次数待确认';
};

/** 停留期的英文版本；中文仍复用 contracts 的 formatStay，保证与后端一致 */
export function formatStayI18n(
  days: number | null,
  unit: StayUnit | null,
  rule: StayRule = 'UNSPECIFIED',
  windowDays: number | null = null,
  windowMaxDays: number | null = null,
  lang: Lang = 'zh',
): string | null {
  if (lang === 'zh') return formatStay(days, unit, rule, windowDays, windowMaxDays);
  if (days === null) return null;
  const unitWord = unit === 'MONTH' ? (days === 1 ? 'month' : 'months') : unit === 'YEAR' ? (days === 1 ? 'year' : 'years') : days === 1 ? 'day' : 'days';
  if (unit === 'MONTH' || unit === 'YEAR') return `Up to ${days} ${unitWord} per entry`;
  if (rule === 'ROLLING_WINDOW' && windowDays !== null && windowMaxDays !== null) {
    return `Up to ${windowMaxDays} days in any ${windowDays}-day window`;
  }
  if (rule === 'ROLLING_WINDOW' && windowDays !== null) {
    return `Up to ${days} days in any ${windowDays}-day window`;
  }
  if (windowDays !== null && windowMaxDays !== null) {
    return `Up to ${days} days per entry; ${windowMaxDays} days in any ${windowDays}-day window`;
  }
  return `Up to ${days} ${unitWord} per entry`;
}

export const entryScopeLabelFor = entryScopeName;
