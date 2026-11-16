import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Languages, RefreshCw } from 'lucide-react';
import { DEFAULT_SEARCH_QUERY, POLICY_GROUPS, VISA_TYPES, categoryColor } from '../shared/contracts.ts';
import type {
  CountryDossier,
  MapCountry,
  OverviewResponse,
  SearchQuery,
  SearchResponse,
} from '../shared/contracts.ts';
import { fetchCountry, fetchOverview, fetchSearch, isAbortError, toApiError, type ApiError } from './api';
import { DataNotes } from './components/DataNotes';
import { CountrySheet } from './features/details/CountrySheet';
import { GlobeMap, type GlobeFocusRequest } from './features/map/GlobeMap';
import { SearchOverlay, type PresetDefinition } from './features/search/SearchOverlay';
import { suggestCountries } from './features/search/fuzzy';
import {
  categoryName,
  countryName,
  formatStayI18n,
  policyGroupName,
  useI18n,
} from './i18n.tsx';

type PresetId = 'free' | 'arrival' | 'online' | 'schengen' | 'business' | 'japan' | 'usa' | 'europe';

interface Preset extends PresetDefinition {
  id: PresetId;
  /** 交给后端图谱解析的规范查询词，始终用中文 canonical label */
  query: string;
}

const PRESETS: Preset[] = [
  { id: 'free', label: '免签', labelEn: 'Visa-free', query: '免签' },
  { id: 'arrival', label: '落地签', labelEn: 'Visa on arrival', query: '落地签' },
  { id: 'online', label: '电子签', labelEn: 'E-visa', query: '电子签' },
  { id: 'schengen', label: '申根', labelEn: 'Schengen', query: '申根' },
  { id: 'business', label: '商务签', labelEn: 'Business', query: '商务签' },
  { id: 'japan', label: '日本', labelEn: 'Japan', query: '日本' },
  { id: 'usa', label: '美国', labelEn: 'USA', query: '美国' },
  { id: 'europe', label: '欧洲', labelEn: 'Europe', query: '欧洲' },
];

function buildSearchQuery(text: string, preset: PresetId | null, activeType: string | null): SearchQuery {
  const query: SearchQuery = { ...DEFAULT_SEARCH_QUERY, q: text.trim(), page: 1, pageSize: 24 };
  if (preset) {
    // 预置词统一交给后端知识图谱解析：国家→国家节点、欧洲→地区节点、
    // 免签/落地签/电子签→政策组、申根→签证类别、商务签→签证类型。
    query.q = PRESETS.find(item => item.id === preset)?.query ?? '';
  }
  if (activeType) query.type = activeType;
  return query;
}

function isQueryActive(query: SearchQuery): boolean {
  return Boolean(
    query.q.trim() ||
      query.regions.length ||
      query.groups.length ||
      query.categories.length ||
      query.stays.length ||
      query.statuses.length ||
      query.priorityOnly ||
      query.type !== DEFAULT_SEARCH_QUERY.type,
  );
}

function englishCategoryLabel(country: MapCountry): string {
  if (country.categoryCode) return categoryName(country.categoryCode, 'en');
  if (country.group) return policyGroupName(country.group, 'en');
  return 'Category pending';
}

/** Visa Atlas v2 · 全屏地球 + 顶部搜索胶囊 + 底部国家抽屉 */
export function App() {
  const { lang, toggleLang, t } = useI18n();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<ApiError | null>(null);
  const [overviewRetry, setOverviewRetry] = useState(0);

  const [searchText, setSearchText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);
  const [activeType, setActiveType] = useState<{ code: string; label: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);

  const [hoverIso2, setHoverIso2] = useState<string | null>(null);
  /** 悬浮卡内容单独延迟更新：鼠标快速穿过多个国家去点卡片时，卡片仍保持原国家，避免点错 */
  const [hoverCardIso2, setHoverCardIso2] = useState<string | null>(null);
  const hoverCardRef = useRef(false);
  const hoverClearTimerRef = useRef<number | null>(null);
  const hoverDwellTimerRef = useRef<number | null>(null);

  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);
  const [dossier, setDossier] = useState<CountryDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<ApiError | null>(null);
  const [dossierRetry, setDossierRetry] = useState(0);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<GlobeFocusRequest | null>(null);
  const focusNonceRef = useRef(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  /** 自动飞行去重：同一次搜索只飞一次，避免重试/重渲染时反复拉镜头 */
  const autoFocusKeyRef = useRef('');

  /* ---------------- 数据集 ---------------- */
  useEffect(() => {
    const controller = new AbortController();
    setOverviewLoading(true);
    setOverviewError(null);
    fetchOverview(controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setOverview(data);
        setOverviewLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setOverviewError(toApiError(error));
        setOverviewLoading(false);
      });
    return () => controller.abort();
  }, [overviewRetry]);

  /* ---------------- 300ms 防抖文本 → 检索 query ---------------- */
  useEffect(() => {
    if (!searchText.trim()) {
      setDebouncedText('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedText(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const query = useMemo(
    () => buildSearchQuery(debouncedText, activePreset, activeType?.code ?? null),
    [debouncedText, activePreset, activeType],
  );
  const queryActive = useMemo(() => isQueryActive(query), [query]);

  // 清空搜索/筛选后允许下一次同样的查询再次自动飞行
  useEffect(() => {
    if (!queryActive) autoFocusKeyRef.current = '';
  }, [queryActive]);

  /* ---------------- 检索（取消旧请求） ---------------- */
  useEffect(() => {
    if (!queryActive) {
      setSearchResponse(null);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(null);
    fetchSearch(query, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setSearchResponse(data);
        setSearchLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setSearchError(toApiError(error));
        setSearchLoading(false);
      });
    return () => controller.abort();
  }, [query, queryActive, searchRetry]);

  const matched = useMemo<Set<string> | null>(
    () => (queryActive && searchResponse ? new Set(searchResponse.matchedCountries) : null),
    [queryActive, searchResponse],
  );

  /**
   * 搜索到“明确指向某个国家”时把地球自动飞过去：
   * - 预置词 日本/美国 → 对应国家；
   * - 输入文本命中完整国家名/ISO（如「日本」「Japan」「US」）或强模糊建议（如「Japn」）；
   * - 命中结果 ≤ 3 个时飞向第一个结果。
   * 其余情况（免签/欧洲等宽筛选）保持全球视角，只做未命中变暗。
   */
  useEffect(() => {
    if (!overview || !queryActive || !searchResponse || sheetOpen) return;
    const key = `${activePreset ?? ''}|${debouncedText}|${activeType?.code ?? ''}`;
    if (autoFocusKeyRef.current === key) return;
    let target: string | null = null;
    if (activePreset === 'japan') target = 'JP';
    else if (activePreset === 'usa') target = 'US';
    if (!target && debouncedText) {
      const exact = overview.mapCountries.find(
        country =>
          country.nameZh === debouncedText ||
          country.nameEn.toLowerCase() === debouncedText.toLowerCase() ||
          country.iso2 === debouncedText.toUpperCase(),
      );
      if (exact) target = exact.iso2;
      if (!target) {
        const suggestion = suggestCountries(overview.mapCountries, debouncedText, 1)[0];
        if (suggestion && suggestion.score >= 900) target = suggestion.iso2;
      }
    }
    if (!target && searchResponse.total > 0 && searchResponse.total <= 3) {
      target = searchResponse.items[0]?.iso2 ?? null;
    }
    if (!target) return;
    autoFocusKeyRef.current = key;
    // 搜索明确指向某国时，把该国作为“搜索焦点”高亮黄色（不打开抽屉，用户可继续点击）
    setSelectedIso2(target);
    focusNonceRef.current += 1;
    setFocusRequest({ iso2: target, nonce: focusNonceRef.current });
  }, [overview, queryActive, searchResponse, sheetOpen, activePreset, activeType, debouncedText]);

  /* ---------------- 国家档案 ---------------- */
  useEffect(() => {
    if (!sheetOpen || !selectedIso2) {
      setDossier(null);
      setDossierLoading(false);
      setDossierError(null);
      return;
    }
    const controller = new AbortController();
    setDossierLoading(true);
    setDossierError(null);
    fetchCountry(selectedIso2, false, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setDossier(data);
        setDossierLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setDossierError(toApiError(error));
        setDossierLoading(false);
      });
    return () => controller.abort();
  }, [sheetOpen, selectedIso2, dossierRetry]);

  /* ---------------- 交互 ---------------- */
  const clearHoverTimer = useCallback(() => {
    if (hoverClearTimerRef.current !== null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    if (hoverDwellTimerRef.current !== null) {
      window.clearTimeout(hoverDwellTimerRef.current);
      hoverDwellTimerRef.current = null;
    }
  }, []);

  const handleHoverCountry = useCallback((iso2: string | null) => {
    if (iso2) {
      clearHoverTimer();
      setHoverIso2(iso2);
      // 卡片内容只在同一国家驻留 260ms 后更新；快速划过不改变已有卡片
      hoverDwellTimerRef.current = window.setTimeout(() => {
        hoverDwellTimerRef.current = null;
        if (!hoverCardRef.current) setHoverCardIso2(iso2);
      }, 260);
      return;
    }
    setHoverIso2(null);
    if (hoverCardRef.current) return;
    // 从国家移向底部悬浮卡时留出足够时间（穿过海洋/多国也不应让卡片消失）
    clearHoverTimer();
    hoverClearTimerRef.current = window.setTimeout(() => {
      hoverClearTimerRef.current = null;
      if (!hoverCardRef.current) setHoverCardIso2(null);
    }, 2500);
  }, [clearHoverTimer]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSelectedIso2(null);
    setDossier(null);
    setDossierError(null);
  }, []);

  const openCountry = useCallback((rawIso2: string) => {
    const iso2 = rawIso2.toUpperCase();
    clearHoverTimer();
    hoverCardRef.current = false;
    setHoverIso2(null);
    setHoverCardIso2(null);
    setSelectedIso2(iso2);
    setDossier(previous => (previous && previous.country.iso2 === iso2 ? previous : null));
    setDossierError(null);
    focusNonceRef.current += 1;
    setFocusRequest({ iso2, nonce: focusNonceRef.current });
    setSheetOpen(true);
    setSearchOpen(false);
  }, [clearHoverTimer]);

  const handleSearchTextChange = useCallback(
    (text: string) => {
      // 开始一次新搜索时清除上一次选中国家，避免地图停留在旧焦点、
      // 新命中被 focus 静默态覆盖。
      if (text.trim() && (sheetOpen || selectedIso2)) closeSheet();
      setSearchText(text);
      setActivePreset(null);
      setActiveType(null);
      setSearchOpen(true);
      if (!text.trim()) setDebouncedText('');
    },
    [closeSheet, selectedIso2, sheetOpen],
  );

  const handleTogglePreset = useCallback(
    (presetId: string) => {
      closeSheet();
      setActivePreset(previous => (previous === (presetId as PresetId) ? null : (presetId as PresetId)));
      setActiveType(null);
      setSearchText('');
      setDebouncedText('');
      setSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    },
    [closeSheet],
  );

  const handleSearchType = useCallback(
    (visaType: string) => {
      const label = VISA_TYPES.find(type => type.code === visaType)?.nameZh ?? visaType;
      setActiveType({ code: visaType, label });
      setActivePreset(null);
      setSearchText('');
      setDebouncedText('');
      setSearchOpen(true);
      closeSheet();
    },
    [closeSheet],
  );

  const handleBackgroundClick = useCallback(() => {
    setSearchOpen(false);
    if (sheetOpen || selectedIso2) closeSheet();
  }, [sheetOpen, selectedIso2, closeSheet]);

  const handleResetView = useCallback(() => {
    setResetSignal(signal => signal + 1);
    setHoverIso2(null);
  }, []);

  /* ---------------- 键盘：/ 聚焦；Esc 分层关闭 ---------------- */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (notesOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setNotesOpen(false);
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key !== 'Escape') return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (sheetOpen) {
        closeSheet();
        return;
      }
      if (selectedIso2) setSelectedIso2(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notesOpen, searchOpen, sheetOpen, selectedIso2, closeSheet]);

  /* ---------------- 首屏：载入 / 失败 ---------------- */
  if (!overview) {
    return (
      <div className="va-boot">
        {overviewLoading ? (
          <div className="va-boot__loading">
            <span className="va-brand__dot" aria-hidden="true" />
            <p>{t('globe.loading')}</p>
          </div>
        ) : (
          <div className="va-boot__card">
            <span className="va-boot__eyebrow">DATA UNAVAILABLE</span>
            <h1>{lang === 'en' ? 'Dataset service is unavailable' : '资料服务未能启动'}</h1>
            <p>{overviewError?.message ?? t('app.loadFailed')}</p>
            <button
              type="button"
              className="va-text-button"
              data-testid="retry"
              onClick={() => setOverviewRetry(value => value + 1)}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t('app.retry')}
            </button>
          </div>
        )}
      </div>
    );
  }

  const hoverCountry = hoverCardIso2
    ? overview.mapCountries.find(country => country.iso2 === hoverCardIso2) ?? null
    : null;
  const selectedCountry = selectedIso2
    ? overview.mapCountries.find(country => country.iso2 === selectedIso2) ?? null
    : null;
  const dataUpdated = overview.meta.generatedAt ? overview.meta.generatedAt.slice(0, 7) : '—';

  return (
    <div className={selectedIso2 ? 'va-app is-focused' : 'va-app'}>
      <div className="va-globe-layer">
        <GlobeMap
          countries={overview.mapCountries}
          matched={matched}
          selected={selectedIso2}
          hoverIso2={hoverIso2}
          focusRequest={focusRequest}
          resetSignal={resetSignal}
          onSelect={openCountry}
          onHover={handleHoverCountry}
          onBackgroundClick={handleBackgroundClick}
        />
      </div>

      {/* 装饰性轨道/角标：纯 CSS，pointer-events:none，不参与命中测试 */}
      <div className="va-deco" aria-hidden="true">
        <span className="va-deco__orbit va-deco__orbit--outer" />
        <span className="va-deco__orbit va-deco__orbit--inner" />
        <span className="va-deco__corner va-deco__corner--tl" />
        <span className="va-deco__corner va-deco__corner--tr" />
        <span className="va-deco__corner va-deco__corner--bl" />
        <span className="va-deco__corner va-deco__corner--br" />
        <span className="va-deco__spark va-deco__spark--teal" />
        <span className="va-deco__spark va-deco__spark--green" />
        <span className="va-deco__spark va-deco__spark--coral" />
      </div>

      <header className="va-topbar">
        <button
          type="button"
          className="va-brand"
          onClick={handleResetView}
          aria-label={lang === 'en' ? 'Reset globe view' : '重置地球视角'}
        >
          <span className="va-brand__dot" aria-hidden="true" />
          <span className="va-brand__text">
            <strong>VISA ATLAS</strong>
            <small>{t('brand.subtitle')}</small>
          </span>
        </button>
        <div className="va-topbar__actions">
          <button
            type="button"
            className="va-lang"
            data-testid="lang-toggle"
            onClick={toggleLang}
            aria-label={t('lang.switch')}
            title={t('lang.switch')}
          >
            <Languages size={13} strokeWidth={1.8} aria-hidden="true" />
            <span>{t('lang.label')}</span>
          </button>
          <button
            type="button"
            className="va-info"
            data-testid="data-notes"
            onClick={() => setNotesOpen(true)}
            aria-label={lang === 'en' ? 'Open data notes' : '打开数据说明'}
          >
            <Info size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      <SearchOverlay
        countries={overview.mapCountries}
        presets={PRESETS}
        searchText={searchText}
        onSearchTextChange={handleSearchTextChange}
        activePreset={activePreset}
        onTogglePreset={handleTogglePreset}
        activeType={activeType}
        onClearType={() => setActiveType(null)}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
        searchResponse={searchResponse}
        searchLoading={searchLoading}
        searchError={searchError}
        queryActive={queryActive}
        onPickCountry={openCountry}
        onHoverCountry={handleHoverCountry}
        onRetrySearch={() => setSearchRetry(value => value + 1)}
        inputRef={searchInputRef}
      />

      <div className="va-legend" data-testid="policy-legend" aria-label={lang === 'en' ? 'Map legend: tourism visa policy groups' : '地图颜色图例：旅游签政策组'}>
        <span className="va-legend__title">{t('app.legendTitle')}</span>
        {POLICY_GROUPS.map(group => {
          const stats = overview.stats.byGroup.find(item => item.code === group.code);
          return (
            <span
              className="va-legend__item"
              key={group.code}
              title={`${lang === 'en' ? group.nameEn : group.description}${stats ? ` · ${stats.count}` : ''}`}
            >
              <i style={{ background: group.color }} aria-hidden="true" />
              {group.code === 'ONLINE'
                ? lang === 'en'
                  ? 'E-visa'
                  : '电子签'
                : group.code === 'SPECIAL'
                  ? lang === 'en'
                    ? 'Special'
                    : '特殊/属地'
                  : policyGroupName(group.code, lang)}
            </span>
          );
        })}
      </div>

      <div className="va-hints" aria-hidden="true">
        <span>{t('app.hints')}</span>
        <span>{t('app.destinations', { countries: overview.stats.countries, date: dataUpdated })}</span>
      </div>

      {hoverCountry && !sheetOpen ? (
        <button
          type="button"
          className="va-hover-card"
          data-testid="hover-card"
          data-iso2={hoverCountry.iso2}
          onMouseEnter={() => {
            clearHoverTimer();
            hoverCardRef.current = true;
            setHoverIso2(hoverCountry.iso2);
          }}
          onMouseLeave={() => {
            hoverCardRef.current = false;
            setHoverIso2(null);
            setHoverCardIso2(null);
          }}
          onClick={() => openCountry(hoverCountry.iso2)}
        >
          <span className="va-hover-card__name">
            {countryName(hoverCountry.nameZh, hoverCountry.nameEn, lang)}
            {lang === 'zh' ? <em>{hoverCountry.nameEn}</em> : null}
            <code>{hoverCountry.iso2}</code>
          </span>
          <span className="va-hover-card__meta">
            <i
              className="va-hover-card__dot"
              style={{ background: categoryColor(hoverCountry.categoryCode) }}
              aria-hidden="true"
            />
            {lang === 'en'
              ? englishCategoryLabel(hoverCountry)
              : hoverCountry.categoryLabel ?? (hoverCountry.hasData ? '类别待确认' : '待采集')}
            <span aria-hidden="true">·</span>
            {lang === 'en'
              ? formatStayI18n(hoverCountry.stayDays, hoverCountry.stayUnit, 'UNSPECIFIED', null, null, 'en') ?? t('hover.stayPending')
              : hoverCountry.stayLabel ?? t('hover.stayPending')}
          </span>
          <span className="va-hover-card__cta">{t('hover.open')}</span>
        </button>
      ) : null}

      <CountrySheet
        open={sheetOpen}
        iso2={selectedIso2 ?? ''}
        fallback={selectedCountry}
        dossier={dossier}
        loading={dossierLoading}
        error={dossierError}
        onClose={closeSheet}
        onRetry={() => setDossierRetry(value => value + 1)}
        onSearchType={handleSearchType}
      />

      <DataNotes open={notesOpen} onClose={() => setNotesOpen(false)} overview={overview} />
    </div>
  );
}
