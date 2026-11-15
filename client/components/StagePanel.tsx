import { useEffect, useRef } from 'react';
import { Compass, Loader2, RotateCcw } from 'lucide-react';
import { POLICY_GROUPS } from '../../shared/contracts.ts';
import type { DashboardStats, MapCountry, RegionCode, SearchItem } from '../../shared/contracts.ts';
import { WorldMap, type MapColorMode } from '../features/map/WorldMap';
import { ResultCard } from '../features/results/ResultCard';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { cx } from './cx';

export type StageMode = 'map' | 'list';

interface StagePanelProps {
  countries: MapCountry[];
  matched: Set<string> | null;
  matchCount: number;
  selected: string | null;
  hoverRegion: RegionCode | null;
  colorMode: MapColorMode;
  onColorModeChange: (mode: MapColorMode) => void;
  resetSignal: number;
  onResetView: () => void;
  onSelect: (iso2: string) => void;
  onHover: (iso2: string | null) => void;
  stageMode: StageMode;
  onStageModeChange: (mode: StageMode) => void;
  stats: DashboardStats;
  items: SearchItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
  showEmpty: boolean;
  filterKey: string;
}

function StageListSkeleton() {
  return (
    <div className="va-stage-list" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map(index => (
        <div key={index} className="va-result-card va-result-card--skeleton va-result-card--grid">
          <Skeleton width="46%" height={15} />
          <div className="va-skeleton-row">
            <Skeleton width={72} height={16} radius={8} />
            <Skeleton width={54} height={12} />
          </div>
          <Skeleton width="100%" height={11} />
          <Skeleton width="88%" height={11} />
          <Skeleton width="70%" height={11} />
          <Skeleton width="100%" height={3} radius={2} />
        </div>
      ))}
    </div>
  );
}

/** 中央舞台：地图 / 列表切换，承载地图浮层（色带、图例、统计、空态） */
export function StagePanel({
  countries,
  matched,
  matchCount,
  selected,
  hoverRegion,
  colorMode,
  onColorModeChange,
  resetSignal,
  onResetView,
  onSelect,
  onHover,
  stageMode,
  onStageModeChange,
  stats,
  items,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onClearFilters,
  showEmpty,
  filterKey,
}: StagePanelProps) {
  const showSkeleton = stageMode === 'list' && loading && items.length === 0;
  const listScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [filterKey]);

  return (
    <section className="va-stage va-panel" aria-label="世界签证图谱舞台">
      <header className="va-stage__head">
        <div className="va-stage__title">
          <h1>世界签证图谱</h1>
          <span className="va-stage__count">
            <strong>{matchCount}</strong> 个目的地
          </span>
        </div>
        <div className="va-stage__actions">
          <div className="va-stage__seg" role="group" aria-label="视图模式" data-testid="stage-toggle">
            <button
              type="button"
              className={cx('va-stage__seg-btn', stageMode === 'map' && 'is-active')}
              aria-pressed={stageMode === 'map'}
              onClick={() => onStageModeChange('map')}
            >
              地图
            </button>
            <button
              type="button"
              className={cx('va-stage__seg-btn', stageMode === 'list' && 'is-active')}
              aria-pressed={stageMode === 'list'}
              onClick={() => onStageModeChange('list')}
            >
              列表
            </button>
          </div>
        </div>
      </header>

      <div className="va-stage__body">
        {stageMode === 'map' ? (
          <div className="va-map-wrap">
            <WorldMap
              countries={countries}
              matched={matched}
              selected={selected}
              highlightRegion={hoverRegion}
              colorMode={colorMode}
              resetSignal={resetSignal}
              onSelect={onSelect}
              onHover={onHover}
            />

            <div className="va-map-tools">
              <div className="va-map-modes" role="group" aria-label="地图着色方式">
                <button
                  type="button"
                  className={cx('va-map-mode-btn', colorMode === 'category' && 'is-active')}
                  aria-pressed={colorMode === 'category'}
                  onClick={() => onColorModeChange('category')}
                >
                  政策类别
                </button>
                <button
                  type="button"
                  className={cx('va-map-mode-btn', colorMode === 'completeness' && 'is-active')}
                  aria-pressed={colorMode === 'completeness'}
                  onClick={() => onColorModeChange('completeness')}
                >
                  资料完整度
                </button>
              </div>
              <button
                type="button"
                className="va-map-reset"
                onClick={onResetView}
                title="重置地图视图"
                aria-label="重置地图缩放与平移"
              >
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            </div>

            {loading ? (
              <div className="va-map-progress" role="status">
                <Loader2 size={12} className="va-spin" aria-hidden="true" />
                检索中…
              </div>
            ) : null}

            <div className="va-map-legend">
              {colorMode === 'category' ? (
                <>
                  <span className="va-map-legend__title">政策类别</span>
                  <span className="va-map-legend__items">
                    {POLICY_GROUPS.map(group => (
                      <span key={group.code} className="va-map-legend__item" title={group.description}>
                        <span className="va-map-legend__dot" style={{ background: group.color }} aria-hidden="true" />
                        {group.nameZh}
                      </span>
                    ))}
                    <span className="va-map-legend__item" title="本轮未采集到旅游签资料">
                      <span className="va-map-legend__dot" style={{ background: 'rgba(160,190,210,.28)' }} aria-hidden="true" />
                      待采集
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="va-map-legend__title">资料完整度</span>
                  <span className="va-map-legend__scale" aria-hidden="true" />
                  <span className="va-map-legend__range">
                    <span>待采集</span>
                    <span>摘要级</span>
                    <span>完整</span>
                  </span>
                </>
              )}
            </div>

            <div className="va-map-foot">
              <span className="va-map-stat">
                有资料 <strong>{stats.withPolicy}</strong> / {stats.countries} 个目的地
              </span>
              <span className="va-middot" aria-hidden="true">
                ·
              </span>
              <span className="va-map-stat">平均完整度 {Math.round(stats.averageCompleteness)}%</span>
              <span className="va-map-zoom-hint">滚轮缩放 · 拖拽平移 · 点击国家查看档案</span>
            </div>

            {showEmpty ? (
              <div className="va-map-empty">
                <EmptyState
                  icon={Compass}
                  compact
                  title="没有符合条件的目的地"
                  description="试试清空地区或停留期筛选，或换一个关键词重新检索。"
                  action={
                    <button type="button" className="va-button va-button--ghost" onClick={onClearFilters}>
                      清空筛选
                    </button>
                  }
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="va-stage__list-wrap">
            <div className="va-stage-list-head">
              <span className="va-eyebrow">LIST VIEW</span>
              <p>
                列表模式按当前筛选展示结果，点卡片打开国家档案；地图视图仍保留同样的筛选与检索。
              </p>
            </div>
            <div className="va-stage__list-scroll va-scroll" ref={listScrollRef}>
              {showSkeleton ? <StageListSkeleton /> : null}
              {!showSkeleton && items.length > 0 ? (
                <div className="va-stage-grid" role="list" aria-label="目的地图鉴列表">
                  {items.map(item => (
                    <div role="listitem" key={item.key}>
                      <ResultCard item={item} selected={item.iso2 === selected} onSelect={onSelect} variant="grid" />
                    </div>
                  ))}
                </div>
              ) : null}
              {!showSkeleton && items.length === 0 && !loading ? (
                <EmptyState
                  icon={Compass}
                  title={showEmpty ? '没有符合条件的目的地' : '还没有可展示的目的地'}
                  description="清空筛选或输入一个关键词，例如「日本」「免签」。"
                  action={
                    <button type="button" className="va-button va-button--ghost" onClick={onClearFilters}>
                      清空筛选
                    </button>
                  }
                />
              ) : null}
              {items.length > 0 && hasMore ? (
                <div className="va-stage-more">
                  <button
                    type="button"
                    className="va-button va-button--ghost"
                    onClick={onLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? '加载中…' : '加载更多目的地'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
