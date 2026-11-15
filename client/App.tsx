import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Database, Info, RotateCcw, TriangleAlert, X } from 'lucide-react';
import {
  DEFAULT_SEARCH_QUERY,
  DISCLAIMER,
} from '../shared/contracts.ts';
import type {
  CountryDossier as CountryDossierData,
  DataStatus,
  OverviewResponse,
  PolicyGroup,
  RegionCode,
  SearchItem,
  SearchQuery,
  SearchResponse,
  SearchSort,
} from '../shared/contracts.ts';
import { fetchCountry, fetchOverview, fetchSearch, isAbortError, toApiError, type ApiError } from './api';
import { DataNotesModal } from './components/DataNotesModal';
import { StagePanel, type StageMode } from './components/StagePanel';
import { cx } from './components/cx';
import { CountryDossier } from './features/details/CountryDossier';
import { FilterRail } from './features/filters/FilterRail';
import type { MapColorMode } from './features/map/WorldMap';
import { ResultsPanel } from './features/results/ResultsPanel';
import { GlobalSearch } from './features/search/GlobalSearch';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { parseUrlState, serializeUrlState } from './hooks/useUrlState';

type SidePanel = 'results' | 'dossier';

const MAX_RESTORE_PAGE = 99;

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

function mergeItems(current: SearchItem[], next: SearchItem[]): SearchItem[] {
  if (current.length === 0) return next;
  const seen = new Set(current.map(item => item.key));
  return [...current, ...next.filter(item => !seen.has(item.key))];
}

function countActiveFilters(query: SearchQuery): number {
  let count =
    query.regions.length +
    query.groups.length +
    query.categories.length +
    query.stays.length +
    query.statuses.length;
  if (query.q.trim()) count += 1;
  if (query.type && query.type !== DEFAULT_SEARCH_QUERY.type) count += 1;
  if (query.priorityOnly) count += 1;
  return count;
}

function CompassMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" className="va-brand__mark">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
      <circle cx="16" cy="16" r="8.4" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.26" />
      <path
        d="M16 5.2 18.3 13.7 26.8 16 18.3 18.3 16 26.8 13.7 18.3 5.2 16 13.7 13.7Z"
        fill="currentColor"
        opacity="0.92"
      />
      <circle cx="16" cy="16" r="2.1" fill="var(--va-bg-deep)" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function BootScreen() {
  return (
    <div className="va-boot">
      <div className="va-boot__brand">
        <CompassMark />
        <div>
          <strong>VISA ATLAS</strong>
          <span>世界签证图谱 · CHINA PASSPORT</span>
        </div>
      </div>
      <div className="va-boot__card">
        <span className="va-eyebrow">LOADING ATLAS</span>
        <h1>正在载入世界签证图谱…</h1>
        <p>读取数据集元信息、249 国政策摘要与地图着色数据。</p>
        <span className="va-boot__bar" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}

function FatalError({ error, onRetry }: { error: ApiError | null; onRetry: () => void }) {
  return (
    <div className="va-fatal">
      <div className="va-fatal__card va-panel">
        <span className="va-eyebrow">DATA UNAVAILABLE</span>
        <div className="va-fatal__title">
          <AlertTriangle size={20} aria-hidden="true" />
          <h1>资料服务未能启动</h1>
        </div>
        <p className="va-fatal__message">{error?.message ?? '无法读取数据集，请稍后重试。'}</p>
        {error?.code ? <code className="va-fatal__code">{error.code}</code> : null}
        <button type="button" className="va-button va-button--primary" onClick={onRetry} data-testid="retry">
          <RotateCcw size={14} aria-hidden="true" />
          重新连接
        </button>
        <p className="va-fatal__hint">
          请确认后端 API 已启动：<code>http://127.0.0.1:3001/api/health</code>
        </p>
      </div>
    </div>
  );
}

/** Visa Atlas 页面状态编排：overview / search / suggestions / dossier / URL / 键盘 */
export function App() {
  const [initialState] = useState(() => parseUrlState(window.location.search));

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<ApiError | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewRetry, setOverviewRetry] = useState(0);

  const [searchText, setSearchText] = useState(initialState.query.q);
  const [query, setQuery] = useState<SearchQuery>(initialState.query);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedIso2, setSelectedIso2] = useState<string | null>(initialState.country);
  const [dossier, setDossier] = useState<CountryDossierData | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<ApiError | null>(null);
  const [dossierRetry, setDossierRetry] = useState(0);

  const [panel, setPanel] = useState<SidePanel>(initialState.country ? 'dossier' : 'results');
  const [stageMode, setStageMode] = useState<StageMode>('map');
  const [colorMode, setColorMode] = useState<MapColorMode>('category');
  const [hoverRegion, setHoverRegion] = useState<RegionCode | null>(null);
  const [mapResetSignal, setMapResetSignal] = useState(0);
  const [explanationOpen, setExplanationOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  /** 首屏若 URL 带 page>1，第一轮成功请求会依次补齐前序页面后恢复 */
  const restorePageRef = useRef(Math.min(Math.max(initialState.query.page, 1), MAX_RESTORE_PAGE));

  const debouncedSearchText = useDebouncedValue(searchText, 250);

  /* ---------------- 数据集 overview ---------------- */
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

  /* ---------------- 关键词防抖 → query.q ---------------- */
  useEffect(() => {
    const nextText = debouncedSearchText.trim();
    if (nextText === queryRef.current.q) return;
    setQuery(prev => ({ ...prev, q: nextText, page: 1 }));
  }, [debouncedSearchText]);

  /* ---------------- 检索（筛选 / 关键词 / 排序变化时取消旧请求） ---------------- */
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        q: query.q,
        type: query.type,
        regions: query.regions,
        groups: query.groups,
        categories: query.categories,
        stays: query.stays,
        statuses: query.statuses,
        priorityOnly: query.priorityOnly,
        includeDemo: query.includeDemo,
        sort: query.sort,
      }),
    [query],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    // 首屏恢复 URL 中的深页码；成功后清空，筛选变化一律回到第 1 页
    const restoreTarget = restorePageRef.current;
    setSearchLoading(true);
    setSearchError(null);

    async function run() {
      try {
        const baseQuery = { ...queryRef.current, page: 1 };
        const first = await fetchSearch(baseQuery, controller.signal);
        if (controller.signal.aborted) return;

        let merged = first.items;
        let finalPage = 1;
        const targetPage = Math.min(Math.max(restoreTarget, 1), Math.max(first.pageCount, 1));
        for (let page = 2; page <= targetPage; page += 1) {
          const next = await fetchSearch({ ...queryRef.current, page }, controller.signal);
          if (controller.signal.aborted) return;
          merged = mergeItems(merged, next.items);
          finalPage = page;
        }
        restorePageRef.current = 1;

        setSearchResponse({ ...first, items: merged, page: finalPage });
        setItems(merged);
        setQuery(prev => (prev.page === finalPage ? prev : { ...prev, page: finalPage }));
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        setSearchError(toApiError(error));
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }

    void run();
    return () => controller.abort();
  }, [filterKey, searchRetry]);

  /* ---------------- 国家档案 ---------------- */
  useEffect(() => {
    if (!selectedIso2) {
      setDossier(null);
      setDossierError(null);
      setDossierLoading(false);
      return;
    }
    const controller = new AbortController();
    setDossierLoading(true);
    setDossierError(null);
    fetchCountry(selectedIso2, query.includeDemo, controller.signal)
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
  }, [selectedIso2, query.includeDemo, dossierRetry]);

  /* ---------------- URL 同步（刷新 / 分享可复现当前筛选与选中） ---------------- */
  useEffect(() => {
    const effectiveQuery: SearchQuery = { ...query, page: searchResponse?.page ?? query.page };
    const params = serializeUrlState(effectiveQuery, selectedIso2);
    const next = `${window.location.pathname}${params ? `?${params}` : ''}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, [query, selectedIso2, searchResponse?.page]);

  /* ---------------- 键盘：`/` 聚焦搜索；Esc 关闭弹层 / 清空搜索 ---------------- */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (explanationOpen) return;
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      if (event.key === '/' && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && searchText) {
        event.preventDefault();
        setSearchText('');
        setQuery(prev => (prev.q === '' ? prev : { ...prev, q: '', page: 1 }));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [explanationOpen, searchText]);

  /* ---------------- 事件处理器 ---------------- */
  const patchQuery = useCallback((patch: Partial<SearchQuery>) => {
    setQuery(prev => ({ ...prev, ...patch, page: 1 }));
  }, []);

  const handleSubmit = useCallback(
    (text?: string) => {
      const nextText = (text ?? searchText).trim();
      setSearchText(nextText);
      setQuery(prev => (prev.q === nextText && prev.page === 1 ? prev : { ...prev, q: nextText, page: 1 }));
    },
    [searchText],
  );

  const handleClearFilters = useCallback(() => {
    setSearchText('');
    setQuery(prev => ({ ...DEFAULT_SEARCH_QUERY, includeDemo: prev.includeDemo, pageSize: prev.pageSize }));
  }, []);

  const openCountry = useCallback((iso2: string) => {
    const code = iso2.toUpperCase();
    setSelectedIso2(prev => (prev === code ? prev : code));
    setDossier(prev => (prev && prev.country.iso2 === code ? prev : null));
    setDossierError(null);
    setPanel('dossier');
  }, []);

  const closeDossier = useCallback(() => {
    setPanel('results');
    setSelectedIso2(null);
    setDossier(null);
    setDossierError(null);
  }, []);

  const handleSearchType = useCallback(
    (visaType: string) => {
      setSearchText('');
      setQuery(prev => ({ ...prev, q: '', type: visaType, page: 1 }));
      setPanel('results');
    },
    [],
  );

  const handleLoadMore = useCallback(async () => {
    if (!searchResponse || loadingMore) return;
    const nextPage = searchResponse.page + 1;
    if (nextPage > searchResponse.pageCount) return;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    try {
      const next = await fetchSearch({ ...queryRef.current, page: nextPage }, controller.signal);
      if (controller.signal.aborted) return;
      setItems(prev => mergeItems(prev, next.items));
      setSearchResponse(prev => (prev ? { ...next, items: mergeItems(prev.items, next.items), page: nextPage } : next));
      setQuery(prev => ({ ...prev, page: nextPage }));
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setSearchError(toApiError(error));
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [loadingMore, searchResponse]);

  const handleResetView = useCallback(() => setMapResetSignal(signal => signal + 1), []);

  const handleMapHover = useCallback((_iso2: string | null) => {
    // 地图组件内部负责悬停浮层；保留外部联动入口（如未来与结果列表联动）
  }, []);

  if (!overview) {
    if (overviewLoading) return <BootScreen />;
    return <FatalError error={overviewError} onRetry={() => setOverviewRetry(value => value + 1)} />;
  }

  const activeCount = countActiveFilters(query);
  const hasActiveFilters = activeCount > 0;
  const matched = hasActiveFilters && searchResponse ? new Set(searchResponse.matchedCountries) : null;
  const matchCount = matched ? matched.size : searchResponse ? searchResponse.total : overview.stats.withPolicy;
  const showEmpty = !searchLoading && !searchError && searchResponse !== null && searchResponse.total === 0;
  const dbLabel = `${overview.meta.mode === 'mysql' ? 'MySQL' : 'SQLite'} · ${overview.meta.policyCount} 条政策`;
  const demoCount = overview.stats.demoDetails;

  return (
    <div className="va-app">
      <header className="va-topbar">
        <div className="va-brand" aria-label="Visa Atlas 世界签证图谱">
          <span className="va-brand__symbol">
            <CompassMark />
          </span>
          <span className="va-brand__text">
            <strong>VISA ATLAS</strong>
            <span>世界签证图谱 · CHINA PASSPORT</span>
          </span>
        </div>

        <GlobalSearch
          value={searchText}
          onChange={setSearchText}
          onSubmit={handleSubmit}
          onPickCountry={openCountry}
          onPickCategory={code => patchQuery({ categories: [code] })}
          onPickType={code => patchQuery({ type: code })}
          inputRef={searchInputRef}
        />

        <div className="va-topbar__meta">
          <button
            type="button"
            className="va-text-btn va-topbar__notes"
            onClick={() => setExplanationOpen(true)}
            data-testid="data-notes"
          >
            <Info size={13} aria-hidden="true" />
            数据说明
          </button>
          <button
            type="button"
            className="va-db-status"
            onClick={() => setExplanationOpen(true)}
            aria-label={`数据状态：${dbLabel}，打开数据说明`}
          >
            <span className={cx('va-db-status__dot', overviewError && 'is-error')} aria-hidden="true" />
            <Database size={12} aria-hidden="true" />
            <span>{dbLabel}</span>
          </button>
        </div>
      </header>

      {query.includeDemo ? (
        <div className="va-demo-banner" role="status">
          <TriangleAlert size={13} aria-hidden="true" />
          <span>
            已包含 <strong>{demoCount}</strong> 条演示明细，仅用于展示字段与交互，不可用于申请
          </span>
          <button
            type="button"
            className="va-demo-banner__close"
            onClick={() => patchQuery({ includeDemo: false })}
            aria-label="关闭演示明细"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="va-main">
        <FilterRail
          query={query}
          dictionaries={overview.dictionaries}
          stats={overview.stats}
          facets={searchResponse?.facets ?? null}
          activeCount={activeCount}
          onToggleRegion={region => patchQuery({ regions: toggleInList(query.regions, region) })}
          onHoverRegion={setHoverRegion}
          onToggleGroup={group => patchQuery({ groups: toggleInList<PolicyGroup>(query.groups, group) })}
          onToggleCategory={code => patchQuery({ categories: toggleInList(query.categories, code) })}
          onToggleStay={code => patchQuery({ stays: toggleInList(query.stays, code) })}
          onToggleStatus={status => patchQuery({ statuses: toggleInList<DataStatus>(query.statuses, status) })}
          onTogglePriority={() => patchQuery({ priorityOnly: !query.priorityOnly })}
          onToggleDemo={() => patchQuery({ includeDemo: !query.includeDemo })}
          onTypeChange={type => patchQuery({ type })}
          onClear={handleClearFilters}
        />

        <StagePanel
          countries={overview.mapCountries}
          matched={matched}
          matchCount={matchCount}
          selected={selectedIso2}
          hoverRegion={hoverRegion}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          resetSignal={mapResetSignal}
          onResetView={handleResetView}
          onSelect={openCountry}
          onHover={handleMapHover}
          stageMode={stageMode}
          onStageModeChange={setStageMode}
          stats={overview.stats}
          items={items}
          loading={searchLoading}
          loadingMore={loadingMore}
          hasMore={Boolean(searchResponse && searchResponse.page < searchResponse.pageCount)}
          onLoadMore={() => void handleLoadMore()}
          onClearFilters={handleClearFilters}
          showEmpty={showEmpty}
          filterKey={filterKey}
        />

        <aside className="va-side va-panel" aria-label={panel === 'results' ? '检索结果面板' : '国家档案面板'}>
          {panel === 'results' ? (
            <ResultsPanel
              response={searchResponse}
              items={items}
              loading={searchLoading}
              loadingMore={loadingMore}
              error={searchError}
              selectedIso2={selectedIso2}
              activeCount={activeCount}
              sort={query.sort}
              filterKey={filterKey}
              queryType={query.type}
              keyword={query.q}
              onSelect={openCountry}
              onLoadMore={() => void handleLoadMore()}
              onRetry={() => setSearchRetry(value => value + 1)}
              onClearFilters={handleClearFilters}
              onSortChange={(sort: SearchSort) => patchQuery({ sort })}
            />
          ) : (
            <CountryDossier
              iso2={selectedIso2}
              dossier={dossier}
              loading={dossierLoading}
              error={dossierError}
              includeDemo={query.includeDemo}
              onBack={closeDossier}
              onRetry={() => setDossierRetry(value => value + 1)}
              onSearchType={handleSearchType}
            />
          )}
        </aside>
      </div>

      <footer className="va-footer">
        <span className="va-footer__note" title={DISCLAIMER}>
          {DISCLAIMER}
        </span>
        <span className="va-footer__meta">
          <span className="va-footer__mode">{overview.meta.mode === 'mysql' ? 'MYSQL' : 'SQLITE'}</span>
          <span className="va-middot" aria-hidden="true">
            ·
          </span>
          <span>{overview.meta.datasetVersion}</span>
        </span>
      </footer>

      <DataNotesModal
        open={explanationOpen}
        onClose={() => setExplanationOpen(false)}
        overview={overview}
        includeDemo={query.includeDemo}
      />
    </div>
  );
}
