import { RefreshCw, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  VISA_CATEGORIES,
  categoryColor as categoryColorOf,
  entryScopeLabel,
  formatIsoDate,
  formatStay,
  policyGroupColor,
  policyGroupLabel,
  visaTypeLabel as visaTypeLabelOf,
} from '../../../shared/contracts.ts';
import type { CountryDossier, MapCountry, PolicyRecord } from '../../../shared/contracts.ts';
import type { ApiError } from '../../api';

interface CountrySheetProps {
  open: boolean;
  iso2: string;
  fallback: MapCountry | null;
  dossier: CountryDossier | null;
  loading: boolean;
  error: ApiError | null;
  onClose: () => void;
  onRetry: () => void;
  onSearchType: (visaType: string) => void;
}

function categoryInfoOf(policy: PolicyRecord) {
  return policy.categoryCode ? VISA_CATEGORIES.find(category => category.code === policy.categoryCode) ?? null : null;
}

function effectiveGroup(policy: PolicyRecord) {
  return policy.group ?? categoryInfoOf(policy)?.group ?? null;
}

function effectiveCategoryLabel(policy: PolicyRecord): string {
  return policy.categoryLabel || categoryInfoOf(policy)?.nameZh || '';
}

function effectiveTypeLabel(policy: PolicyRecord): string {
  return policy.visaTypeLabel || visaTypeLabelOf(policy.visaType);
}

/** 卡片/抽屉的强调色：优先用 16 类细分分类色，比 5 个政策组更丰富，且能区分同组内的不同手续。 */
function accentOf(policy: PolicyRecord): string {
  if (policy.categoryCode) return categoryColorOf(policy.categoryCode);
  const group = effectiveGroup(policy);
  return group ? policyGroupColor(group) : 'var(--va-yellow)';
}

function conclusionFor(policy: PolicyRecord): string {
  const stay = formatStay(policy.stayDays, policy.stayUnit, policy.stayRule, policy.windowDays, policy.windowMaxDays);
  let base: string;
  switch (effectiveGroup(policy)) {
    case 'FREE':
      base = policy.requiresAuthorization ? '中国普通护照可免签入境，但需完成在线登记 / 授权' : '中国普通护照可免签入境';
      break;
    case 'ARRIVAL':
      base = '中国普通护照可在抵达口岸办理落地签';
      break;
    case 'ONLINE':
      base = '中国普通护照需在线申请电子签证 / 电子旅行授权';
      break;
    case 'PREARRANGED':
      base = '中国普通护照须在出发前向使领馆或签证中心递交申请';
      break;
    case 'SPECIAL':
      base = '适用特殊许可 / 属地签证政策，需逐项确认';
      break;
    default:
      base = policy.requiresVisa ? '中国普通护照须提前办理签证' : '中国普通护照可免签入境';
  }
  return stay ? `${base}，${stay}。` : `${base}。`;
}

function LoadingBody({ nameZh, nameEn, iso2, onClose }: { nameZh: string; nameEn: string; iso2: string; onClose: () => void }) {
  return (
    <>
      <div className="va-sheet__head">
        <div>
          <h2 className="va-sheet__title">{nameZh}</h2>
          <p className="va-sheet__en">
            {nameEn} · {iso2}
          </p>
        </div>
        <button type="button" className="va-icon-btn" data-testid="sheet-close" onClick={onClose} aria-label="关闭国家档案">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="va-sheet__body" aria-hidden="true">
        <div className="va-sheet__skeleton-row">
          <span className="va-skeleton" style={{ width: 92, height: 24, borderRadius: 999 }} />
          <span className="va-skeleton" style={{ width: 72, height: 24, borderRadius: 999 }} />
          <span className="va-skeleton" style={{ width: 84, height: 24, borderRadius: 999 }} />
        </div>
        <span className="va-skeleton" style={{ width: 320, height: 16 }} />
        <span className="va-skeleton" style={{ width: '72%', height: 12 }} />
      </div>
    </>
  );
}

/**
 * v2 底部国家签证抽屉（精简版）。
 * 只保留 **可规模化采集** 的字段：政策分类、停留期、入境次数、一句摘要、其他签证类型线索、来源与限制。
 * 费用/材料/审核时间/资格规则不再在界面预留空位——它们是可选扩展，不纳入本轮数据收集尺度。
 */
export function CountrySheet({
  open,
  iso2,
  fallback,
  dossier,
  loading,
  error,
  onClose,
  onRetry,
  onSearchType,
}: CountrySheetProps) {
  if (!open) return null;

  const country = dossier?.country ?? null;
  const nameZh = country?.nameZh ?? fallback?.nameZh ?? iso2;
  const nameEn = country?.nameEn ?? fallback?.nameEn ?? '';
  const mainPolicy = dossier?.tourism ?? dossier?.policies[0] ?? null;
  const mentions = dossier?.mentions ?? [];
  const hasData = Boolean(mainPolicy) || mentions.length > 0;
  const priority = country?.priority ?? fallback?.priority ?? false;
  const categoryText = mainPolicy ? effectiveCategoryLabel(mainPolicy) : fallback?.categoryLabel ?? null;
  const stayText = mainPolicy
    ? formatStay(mainPolicy.stayDays, mainPolicy.stayUnit, mainPolicy.stayRule, mainPolicy.windowDays, mainPolicy.windowMaxDays)
    : fallback?.stayLabel ?? null;
  const summary = mainPolicy?.summary ?? mainPolicy?.conditionsText ?? null;
  const conclusion = mainPolicy
    ? conclusionFor(mainPolicy)
    : '本轮尚未采集到该国的旅游签结构化政策，不代表不需要签证。';
  const groupLabel = mainPolicy ? policyGroupLabel(effectiveGroup(mainPolicy) ?? '') : fallback?.groupLabel ?? '';
  const source = dossier?.source ?? null;
  const routeCode = mainPolicy?.routeCode ?? null;
  const accent = mainPolicy ? accentOf(mainPolicy) : 'var(--va-yellow)';

  return (
    <section
      className="va-sheet"
      role="dialog"
      aria-modal="false"
      aria-label={`${nameZh} 签证档案`}
      data-testid="country-sheet"
      style={{ '--va-sheet-accent': accent } as CSSProperties}
    >
      {loading && !dossier ? (
        <LoadingBody nameZh={nameZh} nameEn={nameEn} iso2={iso2} onClose={onClose} />
      ) : (
        <>
          <div className="va-sheet__head">
            <div className="va-sheet__heading">
              <h2 className="va-sheet__title">{nameZh}</h2>
              <p className="va-sheet__en">
                {nameEn}
                {iso2 ? ` · ${iso2}` : ''}
                {groupLabel ? ` · ${groupLabel}` : ''}
              </p>
            </div>
            <button type="button" className="va-icon-btn" data-testid="sheet-close" onClick={onClose} aria-label="关闭国家档案">
              <X size={15} aria-hidden="true" />
            </button>
          </div>

          {error ? (
            <div className="va-sheet__body">
              <div className="va-sheet__error" role="alert">
                <p>{error.message}</p>
                <button type="button" className="va-sheet__retry" onClick={onRetry}>
                  <RefreshCw size={12} aria-hidden="true" />
                  重试
                </button>
              </div>
            </div>
          ) : !hasData ? (
            <div className="va-sheet__body">
              <div className="va-sheet__empty">
                <p className="va-sheet__empty-title">目录内国家，本轮 249 国采集未包含</p>
                <p className="va-sheet__empty-hint">
                  {nameZh}在 250 国目录中，但本轮 CSV 未提供旅游签政策。这不代表不需要签证；请以官方公告为准。
                </p>
              </div>
            </div>
          ) : (
            <div className="va-sheet__body">
              <div className="va-sheet__meta">
                <span className="va-chip va-chip--accent" style={{ color: accent }}>
                  {categoryText ?? '逐案确认'}
                </span>
                <span className="va-chip">{stayText ?? '停留期待确认'}</span>
                {mainPolicy ? <span className="va-chip">{entryScopeLabel(mainPolicy.entryScope)}</span> : null}
                {priority ? <span className="va-chip va-chip--gold">重点候选</span> : null}
              </div>

              <p className="va-sheet__conclusion">{conclusion}</p>
              {summary ? <p className="va-sheet__excerpt">{summary}</p> : null}

              <div className="va-sheet__footer">
                <div className="va-sheet__types">
                  {mentions.length > 0 ? (
                    <>
                      <span className="va-sheet__types-label">其他常见签证类型</span>
                      {mentions.map(mention => (
                        <button
                          key={`${mention.visaType}-${mention.visaTypeLabel}`}
                          type="button"
                          className="va-chip va-chip--action"
                          onClick={() => onSearchType(mention.visaType)}
                          title={mention.rawText ?? mention.visaTypeLabel}
                        >
                          {mention.visaTypeLabel}
                        </button>
                      ))}
                    </>
                  ) : (
                    <span className="va-sheet__types-label">其他常见签证类型：暂无更多线索</span>
                  )}
                </div>
                <div className="va-sheet__source">
                  <span>
                    来源：{source ? `${source.publisher}《${source.title}》` : '小组整理 CSV'} · {source ? formatIsoDate(source.accessedAt) : '2026-11'}
                  </span>
                  {routeCode ? <code>{routeCode}</code> : null}
                </div>
                <p className="va-sheet__warning">未经使领馆逐条核验；资料仅供课程项目参考，请以官方最新公告为准。</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
