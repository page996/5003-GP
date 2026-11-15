import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { DATA_STATUS_META, POLICY_GROUPS, REGIONS } from '../../../shared/contracts.ts';
import type {
  DashboardStats,
  DataStatus,
  FacetBucket,
  OverviewResponse,
  PolicyGroup,
  RegionCode,
  SearchFacets,
  SearchQuery,
} from '../../../shared/contracts.ts';
import { Badge } from '../../components/Badge';
import { Toggle } from '../../components/Toggle';
import { cx } from '../../components/cx';

const STATUS_ORDER: DataStatus[] = ['DETAILED', 'PARTIAL', 'SUMMARY_ONLY', 'MENTION_ONLY'];

const STATUS_DOT: Record<DataStatus, string> = {
  DETAILED: 'var(--va-mint)',
  PARTIAL: 'var(--va-gold)',
  SUMMARY_ONLY: 'var(--va-sky)',
  MENTION_ONLY: 'var(--va-violet)',
  DEMO: 'var(--va-gold)',
};

interface FilterRailProps {
  query: SearchQuery;
  dictionaries: OverviewResponse['dictionaries'];
  stats: DashboardStats;
  facets: SearchFacets | null;
  activeCount: number;
  onToggleRegion: (region: RegionCode) => void;
  onHoverRegion: (region: RegionCode | null) => void;
  onToggleGroup: (group: PolicyGroup) => void;
  onToggleCategory: (code: string) => void;
  onToggleStay: (code: string) => void;
  onToggleStatus: (status: DataStatus) => void;
  onTogglePriority: () => void;
  onToggleDemo: () => void;
  onTypeChange: (type: string) => void;
  onClear: () => void;
}

function facetCount(buckets: FacetBucket[] | null | undefined, code: string): number | null {
  if (!buckets) return null;
  return buckets.find(bucket => bucket.code === code)?.count ?? 0;
}

export function FilterRail({
  query,
  dictionaries,
  stats,
  facets,
  activeCount,
  onToggleRegion,
  onHoverRegion,
  onToggleGroup,
  onToggleCategory,
  onToggleStay,
  onToggleStatus,
  onTogglePriority,
  onToggleDemo,
  onTypeChange,
  onClear,
}: FilterRailProps) {
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const regions = [...(dictionaries.regions.length ? dictionaries.regions : REGIONS)].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const groups = dictionaries.groups.length ? dictionaries.groups : POLICY_GROUPS;
  const categories = dictionaries.categories;
  const stayBuckets = dictionaries.stayBuckets;
  const types = dictionaries.types;

  const categoryGroupCounts = categories.reduce<Record<string, number>>((acc, category) => {
    acc[category.group] = (acc[category.group] ?? 0) + 1;
    return acc;
  }, {});

  function regionCount(code: RegionCode): number | null {
    if (facets) return facetCount(facets.regions, code);
    return stats.byRegion.find(entry => entry.code === code)?.countries ?? null;
  }

  const typeIsTourism = query.type === 'TOURISM';

  return (
    <aside className="va-rail va-panel" aria-label="筛选条件">
      <div className="va-rail__head">
        <div className="va-rail__heading">
          <span className="va-eyebrow">FILTERS</span>
          <h2>筛选</h2>
        </div>
        <div className="va-rail__head-actions">
          {activeCount > 0 ? <span className="va-rail__active">{activeCount} 项</span> : null}
          <button type="button" className="va-text-btn" onClick={onClear} disabled={activeCount === 0} data-testid="reset-filters">
            <RotateCcw size={12} aria-hidden="true" />
            清空
          </button>
        </div>
      </div>

      <div className="va-rail__scroll va-scroll">
        <section className="va-facet va-facet--switches" aria-label="数据范围开关">
          <Toggle
            checked={query.priorityOnly}
            onChange={onTogglePriority}
            label="重点候选"
            hint={`${stats.priorityTargets} 个重点目的地`}
          />
          <Toggle
            checked={query.includeDemo}
            onChange={onToggleDemo}
            testId="demo-toggle"
            label={
              <span className="va-switch__label-row">
                含演示明细
                <Badge tone="demo">演示</Badge>
              </span>
            }
            hint={`${stats.demoDetails} 条虚构样本 · 默认关闭`}
          />
          {query.includeDemo ? (
            <p className="va-rail__note va-rail__note--gold">演示明细仅用于展示字段与交互，不可用于申请。</p>
          ) : null}
        </section>

        <section className="va-facet" aria-labelledby="va-facet-region">
          <div className="va-facet__head">
            <h3 id="va-facet-region">地区</h3>
            {query.regions.length ? <span className="va-facet__picked">已选 {query.regions.length}</span> : null}
          </div>
          <div className="va-region-grid">
            {regions.map(region => {
              const active = query.regions.includes(region.code);
              const count = regionCount(region.code);
              return (
                <button
                  key={region.code}
                  type="button"
                  className={cx('va-region-chip', active && 'is-active')}
                  aria-pressed={active}
                  title={`${region.nameZh} · ${region.nameEn}`}
                  onClick={() => onToggleRegion(region.code)}
                  onMouseEnter={() => onHoverRegion(region.code)}
                  onFocus={() => onHoverRegion(region.code)}
                  onMouseLeave={() => onHoverRegion(null)}
                  onBlur={() => onHoverRegion(null)}
                >
                  <span className="va-region-chip__name">{region.nameZh}</span>
                  <span className="va-region-chip__count">{count === null ? '–' : count}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="va-facet" aria-labelledby="va-facet-group">
          <div className="va-facet__head">
            <h3 id="va-facet-group">政策组</h3>
            {query.groups.length ? <span className="va-facet__picked">已选 {query.groups.length}</span> : null}
          </div>
          <div className="va-group-list">
            {groups.map(group => {
              const active = query.groups.includes(group.code);
              const count = facetCount(facets?.groups, group.code);
              return (
                <button
                  key={group.code}
                  type="button"
                  className={cx('va-group-row', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => onToggleGroup(group.code)}
                  style={{ '--va-group-color': group.color } as CSSProperties}
                  title={group.description}
                >
                  <span className="va-group-row__dot" aria-hidden="true" />
                  <span className="va-group-row__name">{group.nameZh}</span>
                  <span className="va-group-row__count">{count === null ? '–' : count}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="va-facet" aria-labelledby="va-facet-category">
          <button
            type="button"
            className={cx('va-facet__head', 'va-facet__head--button')}
            aria-expanded={categoriesOpen}
            aria-controls="va-category-panel"
            onClick={() => setCategoriesOpen(open => !open)}
          >
            <h3 id="va-facet-category">签证类别</h3>
            <span className="va-facet__meta">
              {query.categories.length ? <span className="va-facet__picked">已选 {query.categories.length}</span> : null}
              <ChevronDown size={13} className={cx('va-chevron', categoriesOpen && 'is-open')} aria-hidden="true" />
            </span>
          </button>
          {categoriesOpen ? (
            <div id="va-category-panel" className="va-category-panel">
              {groups.map(group => {
                const list = categories.filter(category => category.group === group.code);
                if (!list.length) return null;
                return (
                  <div key={group.code} className="va-category-block">
                    <div className="va-category-block__head" style={{ color: group.color }}>
                      <span className="va-category-block__dot" aria-hidden="true" />
                      {group.nameZh}
                      <span className="va-category-block__n">{categoryGroupCounts[group.code] ?? list.length}</span>
                    </div>
                    <div className="va-chip-wrap">
                      {list.map(category => {
                        const active = query.categories.includes(category.code);
                        const count = facetCount(facets?.categories, category.code);
                        return (
                          <button
                            key={category.code}
                            type="button"
                            className={cx('va-chip', 'va-chip--xs', active && 'is-active')}
                            aria-pressed={active}
                            onClick={() => onToggleCategory(category.code)}
                            style={active ? ({ '--va-chip-accent': category.color } as CSSProperties) : undefined}
                            title={category.nameEn}
                          >
                            {category.nameZh}
                            {count !== null ? <span className="va-chip__count">{count}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className="va-facet" aria-labelledby="va-facet-type">
          <div className="va-facet__head">
            <h3 id="va-facet-type">签证用途</h3>
          </div>
          <div className="va-select-wrap">
            <select
              id="va-type-select"
              className="va-select"
              value={query.type}
              onChange={event => onTypeChange(event.target.value)}
              aria-label="签证用途"
            >
              {types.map(type => (
                <option key={type.code} value={type.code}>
                  {type.nameZh}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="va-select__arrow" aria-hidden="true" />
          </div>
          {!typeIsTourism ? (
            <p className="va-rail__note">当前真实数据仅有旅游签结构化资料，其他用途多为「仅类型线索」，明细待采集。</p>
          ) : null}
        </section>

        <section className="va-facet" aria-labelledby="va-facet-stay">
          <div className="va-facet__head">
            <h3 id="va-facet-stay">停留期</h3>
            {query.stays.length ? <span className="va-facet__picked">已选 {query.stays.length}</span> : null}
          </div>
          <div className="va-chip-wrap">
            {stayBuckets.map(bucket => {
              const active = query.stays.includes(bucket.code);
              const count = facetCount(facets?.stays, bucket.code);
              return (
                <button
                  key={bucket.code}
                  type="button"
                  className={cx('va-chip', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => onToggleStay(bucket.code)}
                >
                  {bucket.label}
                  {count !== null ? <span className="va-chip__count">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="va-facet" aria-labelledby="va-facet-status">
          <div className="va-facet__head">
            <h3 id="va-facet-status">资料状态</h3>
            {query.statuses.length ? <span className="va-facet__picked">已选 {query.statuses.length}</span> : null}
          </div>
          <div className="va-chip-wrap">
            {STATUS_ORDER.map(status => {
              const active = query.statuses.includes(status);
              const count = facetCount(facets?.statuses, status);
              return (
                <button
                  key={status}
                  type="button"
                  className={cx('va-chip', 'va-chip--dot', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => onToggleStatus(status)}
                  title={DATA_STATUS_META[status].description}
                >
                  <span className="va-status-dot" style={{ background: STATUS_DOT[status] }} aria-hidden="true" />
                  {DATA_STATUS_META[status].label}
                  {count !== null ? <span className="va-chip__count">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <footer className="va-rail__source">
          <p>
            数据来自小组整理的 <strong>{stats.countries}</strong> 国 CSV
          </p>
          <p>非官方 · 不可用于申请</p>
        </footer>
      </div>
    </aside>
  );
}
