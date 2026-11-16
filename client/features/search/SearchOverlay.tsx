import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { categoryColor } from '../../../shared/contracts.ts';
import type {
  GraphEntityType,
  GraphEntityRef,
  MapCountry,
  SearchItem,
  SearchResponse,
  StayUnit,
} from '../../../shared/contracts.ts';
import type { ApiError } from '../../api';
import { cx } from '../../components/cx';
import {
  categoryName,
  formatStayI18n,
  policyGroupName,
  regionName,
  useI18n,
  visaTypeName,
  type TranslationKey,
} from '../../i18n.tsx';
import { suggestCountries } from './fuzzy';

export interface PresetDefinition {
  id: string;
  label: string;
  labelEn?: string;
}

const GRAPH_TYPE_LABEL: Record<GraphEntityType, TranslationKey> = {
  COUNTRY: 'graph.country',
  REGION: 'graph.region',
  GROUP: 'graph.group',
  CATEGORY: 'graph.category',
  VISA_TYPE: 'graph.visaType',
};

interface SearchRow {
  rowId: string;
  kind: 'suggestion' | 'result';
  iso2: string;
  nameZh: string;
  nameEn: string;
  categoryCode: string | null;
  categoryLabel: string | null;
  groupCode: string | null;
  stayDays: number | null;
  stayUnit: StayUnit | null;
  stayLabel: string | null;
  isDemo: boolean;
  isMention: boolean;
  priority: boolean;
  statusLabel: string | null;
}

interface SearchOverlayProps {
  countries: MapCountry[];
  /** 固定 8 个术语预置词，仅渲染，筛选映射由 App 负责 */
  presets: PresetDefinition[];
  searchText: string;
  onSearchTextChange: (text: string) => void;
  activePreset: string | null;
  onTogglePreset: (presetId: string) => void;
  /** 点击抽屉里的「其他签证类型」后临时生效的类型筛选 */
  activeType: { code: string; label: string } | null;
  onClearType: () => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchResponse: SearchResponse | null;
  searchLoading: boolean;
  searchError: ApiError | null;
  queryActive: boolean;
  onPickCountry: (iso2: string) => void;
  onHoverCountry: (iso2: string | null) => void;
  onRetrySearch: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

function suggestionRow(country: MapCountry): SearchRow {
  return {
    rowId: `suggestion-${country.iso2}`,
    kind: 'suggestion',
    iso2: country.iso2,
    nameZh: country.nameZh,
    nameEn: country.nameEn,
    categoryCode: country.categoryCode,
    categoryLabel: country.categoryLabel,
    groupCode: country.group,
    stayDays: country.stayDays,
    stayUnit: country.stayUnit,
    stayLabel: country.stayLabel,
    // 国家建议只表达“可能想去哪”，不显示演示数据角标，避免误导
    isDemo: false,
    isMention: false,
    priority: country.priority,
    statusLabel: null,
  };
}

function resultRow(item: SearchItem): SearchRow {
  return {
    rowId: `result-${item.key}`,
    kind: 'result',
    iso2: item.iso2,
    nameZh: item.nameZh,
    nameEn: item.nameEn,
    categoryCode: item.categoryCode,
    categoryLabel: item.categoryLabel,
    groupCode: item.group,
    stayDays: item.stayDays,
    stayUnit: item.stayUnit,
    stayLabel: item.stayLabel,
    isDemo: item.isDemo,
    isMention: item.matchKind === 'MENTION_ONLY',
    priority: item.priority,
    statusLabel: item.statusLabel,
  };
}

/**
 * v2 顶部搜索胶囊 + 预置词 + 下拉（本地模糊国家建议 / 后端命中结果）。
 * 只负责输入与下拉交互，检索状态与预置词映射由 App 编排。
 */
export function SearchOverlay({
  countries,
  presets,
  searchText,
  onSearchTextChange,
  activePreset,
  onTogglePreset,
  activeType,
  onClearType,
  searchOpen,
  onSearchOpenChange,
  searchResponse,
  searchLoading,
  searchError,
  queryActive,
  onPickCountry,
  onHoverCountry,
  onRetrySearch,
  inputRef,
}: SearchOverlayProps) {
  const listId = useId();
  const { lang, t } = useI18n();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const presetText = (preset: PresetDefinition): string =>
    lang === 'en' ? preset.labelEn ?? preset.label : preset.label;

  const graphEntityLabel = (entity: GraphEntityRef): string => {
    if (entity.type === 'COUNTRY') {
      const country = countries.find(item => item.iso2 === entity.code);
      return country ? (lang === 'en' ? country.nameEn : country.nameZh) : entity.label;
    }
    if (entity.type === 'REGION') return regionName(entity.code, lang);
    if (entity.type === 'GROUP') return policyGroupName(entity.code, lang);
    if (entity.type === 'CATEGORY') return categoryName(entity.code, lang);
    return visaTypeName(entity.code, lang);
  };

  const keyword = searchText.trim();
  const localSuggestions = useMemo(
    () => (keyword ? suggestCountries(countries, keyword, 6) : []),
    [countries, keyword],
  );
  const suggestionRows = useMemo(() => localSuggestions.map(item => {
    const country = countries.find(entry => entry.iso2 === item.iso2);
    return country ? suggestionRow(country) : null;
  }).filter((row): row is SearchRow => row !== null), [countries, localSuggestions]);
  const resultRows = useMemo(() => (searchResponse?.items ?? []).slice(0, 8).map(resultRow), [searchResponse]);

  const panelVisible = searchOpen && (Boolean(keyword) || queryActive || searchLoading);
  const showResults = Boolean(searchResponse && searchResponse.items.length > 0);
  const showNoResults = Boolean(searchResponse && searchResponse.total === 0 && !searchLoading);
  const showSuggestions = !showResults && suggestionRows.length > 0;
  const rows = useMemo(
    () => (showSuggestions ? suggestionRows : showResults ? resultRows : []),
    [showSuggestions, suggestionRows, showResults, resultRows],
  );
  const rowsKey = rows.map(row => row.rowId).join('|');

  useEffect(() => {
    setHighlight(-1);
  }, [rowsKey, panelVisible]);

  useEffect(() => {
    if (!panelVisible) onHoverCountry(null);
  }, [panelVisible, onHoverCountry]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) onSearchOpenChange(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onSearchOpenChange]);

  function pick(row: SearchRow) {
    onSearchOpenChange(false);
    setHighlight(-1);
    onHoverCountry(null);
    onPickCountry(row.iso2);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (!panelVisible || rows.length === 0) return;
      event.preventDefault();
      setHighlight(previous => (previous + 1) % rows.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!panelVisible || rows.length === 0) return;
      event.preventDefault();
      setHighlight(previous => (previous <= 0 ? rows.length - 1 : previous - 1));
      return;
    }
    if (event.key === 'Enter') {
      if (panelVisible && rows.length > 0) {
        event.preventDefault();
        pick(rows[highlight >= 0 ? highlight : 0]);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (panelVisible) {
        event.preventDefault();
        event.stopPropagation();
        onSearchOpenChange(false);
        setHighlight(-1);
      }
      return;
    }
    if (event.key === 'Tab') onSearchOpenChange(false);
  }

  function handleClear() {
    onSearchTextChange('');
    onHoverCountry(null);
    inputRef.current?.focus();
    if (!activePreset && !activeType) onSearchOpenChange(false);
  }

  function renderRow(row: SearchRow, index: number) {
    const active = index === highlight;
    const localizedCategory = row.categoryCode
      ? categoryName(row.categoryCode, lang)
      : row.categoryLabel;
    const stayText =
      lang === 'en'
        ? formatStayI18n(row.stayDays, row.stayUnit, 'UNSPECIFIED', null, null, 'en') ?? t('result.stayPending')
        : row.stayLabel ?? t('result.stayPending');
    const nameText = lang === 'en' ? row.nameEn : row.nameZh;
    const subName = lang === 'en' ? row.nameZh : row.nameEn;
    return (
      <button
        key={row.rowId}
        id={`${listId}-row-${index}`}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={-1}
        className={cx('va-search-row', active && 'is-active')}
        data-testid={row.kind === 'suggestion' ? 'suggestion-row' : 'result-row'}
        data-iso2={row.iso2}
        onMouseEnter={() => {
          setHighlight(index);
          onHoverCountry(row.iso2);
        }}
        onMouseLeave={() => onHoverCountry(null)}
        onClick={() => pick(row)}
      >
        <span className="va-search-row__title">
          <span className="va-search-row__zh">{nameText}</span>
          {lang === 'zh' ? <span className="va-search-row__en">{subName}</span> : null}
          <code className="va-search-row__iso">{row.iso2}</code>
        </span>
        <span className="va-search-row__meta">
          {localizedCategory ? (
            <span className="va-search-row__badge">
              <i className="va-search-row__dot" style={{ background: categoryColor(row.categoryCode) }} aria-hidden="true" />
              {localizedCategory}
            </span>
          ) : row.isMention ? (
            <span className="va-search-row__badge is-hint">{t('result.typeClue')}</span>
          ) : null}
          <span className="va-search-row__stay">{stayText}</span>
          {row.isDemo ? <span className="va-search-row__badge is-gold">{lang === 'en' ? 'Demo' : '演示'}</span> : null}
          {row.priority ? <span className="va-search-row__priority">{t('result.priority')}</span> : null}
        </span>
      </button>
    );
  }

  return (
    <div className="va-search" ref={wrapperRef}>
      <div className={cx('va-search__capsule', panelVisible && 'is-open')}>
        <Search size={16} strokeWidth={1.9} className="va-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="va-search__input"
          type="text"
          value={searchText}
          role="combobox"
          aria-expanded={panelVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-row-${highlight}` : undefined}
          aria-label={t('search.aria')}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          data-testid="search-input"
          onChange={event => onSearchTextChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setFocused(true);
            onSearchOpenChange(true);
          }}
          onBlur={() => setFocused(false)}
        />
        {searchLoading ? <Loader2 size={14} className="va-search__spinner va-spin" aria-hidden="true" /> : null}
        {searchText ? (
          <button type="button" className="va-search__clear" onClick={handleClear} aria-label={t('search.clear')}>
            <X size={13} aria-hidden="true" />
          </button>
        ) : focused ? null : (
          <kbd className="va-search__kbd" aria-hidden="true">
            /
          </kbd>
        )}
      </div>

      <div className="va-presets" role="group" aria-label={t('search.routePreset')}>
        {activeType ? (
          <button
            type="button"
            className="va-preset is-active"
            onClick={onClearType}
            aria-pressed="true"
            aria-label={t('search.clearType', { type: visaTypeName(activeType.code, lang) })}
          >
            {visaTypeName(activeType.code, lang)}
            <X size={11} aria-hidden="true" />
          </button>
        ) : null}
        {presets.map(preset => {
          const active = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={cx('va-preset', active && 'is-active')}
              data-testid={`preset-${preset.label}`}
              data-preset={preset.id}
              aria-pressed={active}
              onClick={() => onTogglePreset(preset.id)}
            >
              {presetText(preset)}
            </button>
          );
        })}
      </div>

      {panelVisible ? (
        <div className="va-search__panel" id={listId} role="listbox" aria-label={t('search.panelAria')}>
          {searchError ? (
            <div className="va-search__error" role="alert">
              <p>{searchError.message}</p>
              <button type="button" className="va-search__retry" onClick={onRetrySearch}>
                {t('search.retry')}
              </button>
            </div>
          ) : null}

          {showResults && searchResponse ? (
            <>
              <div className="va-search__section">
                <span>{t('search.hits', { count: searchResponse.total })}</span>
                <span>{t('search.took', { ms: searchResponse.tookMs })}</span>
              </div>
              {searchResponse.graph?.used ? (
                <div className="va-search__graph" data-testid="graph-hint">
                  <span className="va-search__graph-label">{t('search.graph')}</span>
                  {searchResponse.graph.matched
                    .map(entity => `${t(GRAPH_TYPE_LABEL[entity.type])}·${graphEntityLabel(entity)}`)
                    .join(' + ')}
                </div>
              ) : null}
              <div className="va-search__rows">{resultRows.map(renderRow)}</div>
            </>
          ) : null}

          {showSuggestions ? (
            <>
              <div className="va-search__section">
                <span>{t('search.suggestions')}</span>
                <span>{showNoResults ? t('search.noExact') : t('search.localFuzzy')}</span>
              </div>
              <div className="va-search__rows">{suggestionRows.map(renderRow)}</div>
            </>
          ) : null}

          {!showResults && !showSuggestions && searchLoading ? (
            <div className="va-search__empty">
              <Loader2 size={14} className="va-spin" aria-hidden="true" />
              {t('search.searching')}
            </div>
          ) : null}

          {showNoResults && !searchError && suggestionRows.length === 0 ? (
            <div className="va-search__empty-block">
              <p className="va-search__empty-title">
                {keyword ? t('search.noResults', { query: keyword }) : t('search.noResultsAny')}
              </p>
              <p className="va-search__empty-hint">{t('search.noResultsHint')}</p>
              <div className="va-search__empty-presets">
                {presets.slice(0, 3).map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className="va-preset"
                    data-testid={`preset-quick-${preset.label}`}
                    data-preset={preset.id}
                    onClick={() => onTogglePreset(preset.id)}
                  >
                    {presetText(preset)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showResults ? (
            <div className="va-search__foot">
              <span>{t('search.keyboard')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
