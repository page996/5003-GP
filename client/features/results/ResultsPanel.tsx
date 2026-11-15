import { useEffect, useRef } from 'react';
import { ChevronDown, Compass, SlidersHorizontal } from 'lucide-react';
import { SEARCH_SORTS } from '../../../shared/contracts.ts';
import type { SearchItem, SearchResponse, SearchSort } from '../../../shared/contracts.ts';
import type { ApiError } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../components/cx';
import { ResultCard } from './ResultCard';

interface ResultsPanelProps {
  response: SearchResponse | null;
  items: SearchItem[];
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  selectedIso2: string | null;
  activeCount: number;
  sort: SearchSort;
  filterKey: string;
  queryType: string;
  keyword: string;
  onSelect: (iso2: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onSortChange: (sort: SearchSort) => void;
}

function ResultsSkeleton() {
  return (
    <div className="va-result-list" aria-hidden="true">
      {[0, 1, 2, 3].map(index => (
        <div key={index} className="va-result-card va-result-card--skeleton">
          <Skeleton width="52%" height={14} />
          <div className="va-skeleton-row">
            <Skeleton width={72} height={16} radius={8} />
            <Skeleton width={54} height={12} />
            <Skeleton width={64} height={12} />
          </div>
          <Skeleton width="100%" height={11} />
          <Skeleton width="82%" height={11} />
          <Skeleton width="100%" height={3} radius={2} />
        </div>
      ))}
    </div>
  );
}

/** 右栏结果列表：独立滚动、加载更多、空态/错误态 */
export function ResultsPanel({
  response,
  items,
  loading,
  loadingMore,
  error,
  selectedIso2,
  activeCount,
  sort,
  filterKey,
  queryType,
  keyword,
  onSelect,
  onLoadMore,
  onRetry,
  onClearFilters,
  onSortChange,
}: ResultsPanelProps) {
  const showSkeleton = loading && items.length === 0;
  const showInitialError = Boolean(error) && items.length === 0 && !loading;
  const showEmpty = !loading && !error && items.length === 0;
  const pageCount = response?.pageCount ?? 0;
  const currentPage = response?.page ?? 1;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 筛选 / 关键词变化时回到结果顶部；加载更多时保持当前位置
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filterKey]);

  return (
    <>
      <header className="va-side__head">
        <div className="va-side__heading">
          <span className="va-eyebrow">SEARCH</span>
          <div className="va-side__title-row">
            <h2>检索结果</h2>
            <span className="va-result-total">
              <strong data-testid="result-total">{response ? response.total : '—'}</strong>
              <small>条结果</small>
            </span>
          </div>
        </div>
        <div className="va-sort-wrap">
          <SlidersHorizontal size={12} className="va-sort__icon" aria-hidden="true" />
          <select
            className="va-sort"
            value={sort}
            onChange={event => onSortChange(event.target.value as SearchSort)}
            aria-label="结果排序方式"
          >
            {SEARCH_SORTS.map(sort => (
              <option key={sort.code} value={sort.code}>
                {sort.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="va-sort__arrow" aria-hidden="true" />
        </div>
      </header>

      <div className="va-side__scroll va-scroll" ref={scrollRef}>
        {response ? (
          <div className="va-results-meta">
            <span>用时 {response.tookMs} ms</span>
            <span className="va-middot" aria-hidden="true">
              ·
            </span>
            <span>{response.mode === 'mysql' ? 'MySQL' : 'SQLite'}</span>
            <span className="va-middot" aria-hidden="true">
              ·
            </span>
            <span>
              已显示 {items.length} / {response.total}
            </span>
          </div>
        ) : null}

        {loading && items.length > 0 ? <div className="va-results-loading">正在更新结果…</div> : null}

        {error && items.length > 0 ? (
          <ErrorNotice error={error} onRetry={onRetry} compact className="va-results-error" />
        ) : null}

        {showSkeleton ? <ResultsSkeleton /> : null}

        {showInitialError && error ? <ErrorNotice error={error} onRetry={onRetry} className="va-results-error" /> : null}

        {showEmpty ? (
          <EmptyState
            icon={Compass}
            title={activeCount > 0 ? '没有符合条件的目的地' : '还没有检索结果'}
            description={
              <>
                {activeCount > 0
                  ? '试试清空地区、政策组或停留期筛选；也可以换一个关键词，例如「日本」「免签」。'
                  : '输入关键词或选择左侧筛选条件，开始探索世界签证图谱。'}
                {queryType === 'TOURISM' && keyword.trim() ? (
                  <span className="va-empty__guide">
                    若想查询商务、留学、工作等类型，请在左侧「签证用途」切换，或点击搜索联想中的「商务访问」等类型。
                  </span>
                ) : null}
              </>
            }
            action={
              activeCount > 0 ? (
                <button type="button" className="va-button va-button--ghost" onClick={onClearFilters}>
                  清空全部筛选
                </button>
              ) : null
            }
          />
        ) : null}

        {items.length > 0 ? (
          <div className="va-result-list" role="list" aria-label="检索结果列表">
            {items.map(item => (
              <div role="listitem" key={item.key}>
                <ResultCard item={item} selected={item.iso2 === selectedIso2} onSelect={onSelect} />
              </div>
            ))}
          </div>
        ) : null}

        {items.length > 0 && response ? (
          <div className="va-load-more">
            {currentPage < pageCount ? (
              <button
                type="button"
                className={cx('va-button', 'va-button--ghost', 'va-load-more__btn')}
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中…' : `加载更多（${currentPage} / ${pageCount} 页）`}
              </button>
            ) : (
              <p className="va-load-more__end">已显示全部 {response.total} 条结果</p>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
