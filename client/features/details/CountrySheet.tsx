import { RefreshCw, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  VISA_CATEGORIES,
  categoryColor as categoryColorOf,
  formatIsoDate,
  policyGroupColor,
} from '../../../shared/contracts.ts';
import type { CountryDossier, MapCountry, PolicyRecord } from '../../../shared/contracts.ts';
import type { ApiError } from '../../api';
import {
  categoryName,
  entryScopeName,
  formatStayI18n,
  policyGroupName,
  useI18n,
  visaTypeName,
  type Lang,
} from '../../i18n.tsx';

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

function effectiveCategoryLabel(policy: PolicyRecord, lang: Lang): string {
  if (lang === 'en') return categoryName(policy.categoryCode, 'en');
  return policy.categoryLabel || categoryName(policy.categoryCode, 'zh');
}

/** 卡片/抽屉的强调色：政策组语义色 */
function accentOf(policy: PolicyRecord): string {
  if (policy.categoryCode) return categoryColorOf(policy.categoryCode);
  const group = effectiveGroup(policy);
  return group ? policyGroupColor(group) : 'var(--va-yellow)';
}

function conclusionFor(policy: PolicyRecord, lang: Lang): string {
  const stay = formatStayI18n(
    policy.stayDays,
    policy.stayUnit,
    policy.stayRule,
    policy.windowDays,
    policy.windowMaxDays,
    lang,
  );
  if (lang === 'en') {
    let base: string;
    switch (effectiveGroup(policy)) {
      case 'FREE':
        base = policy.requiresAuthorization
          ? 'Chinese ordinary passport holders may enter visa-free after completing online registration/authorisation'
          : 'Chinese ordinary passport holders may enter visa-free';
        break;
      case 'ARRIVAL':
        base = 'Chinese ordinary passport holders may obtain a visa on arrival';
        break;
      case 'ONLINE':
        base = 'Chinese ordinary passport holders must apply online for an e-visa or electronic travel authorisation';
        break;
      case 'PREARRANGED':
        base = 'Chinese ordinary passport holders must apply at an embassy, consulate or visa centre before departure';
        break;
      case 'SPECIAL':
        base = 'A special permit or territory-visa policy applies; case-by-case confirmation is required';
        break;
      default:
        base = policy.requiresVisa
          ? 'Chinese ordinary passport holders must obtain a visa in advance'
          : 'Chinese ordinary passport holders may enter visa-free';
    }
    return stay ? `${base}; ${stay}.` : `${base}.`;
  }
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

function LoadingBody({
  title,
  subtitle,
  onClose,
  closeLabel,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <>
      <div className="va-sheet__head">
        <div>
          <h2 className="va-sheet__title">{title}</h2>
          <p className="va-sheet__en">{subtitle}</p>
        </div>
        <button type="button" className="va-icon-btn" data-testid="sheet-close" onClick={onClose} aria-label={closeLabel}>
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
  const { lang, t } = useI18n();
  if (!open) return null;

  const country = dossier?.country ?? null;
  const nameZh = country?.nameZh ?? fallback?.nameZh ?? iso2;
  const nameEn = country?.nameEn ?? fallback?.nameEn ?? '';
  const title = lang === 'en' ? nameEn || nameZh : nameZh;
  const subtitle = lang === 'en' ? '' : nameEn;
  const mainPolicy = dossier?.tourism ?? dossier?.policies[0] ?? null;
  const mentions = dossier?.mentions ?? [];
  const hasData = Boolean(mainPolicy) || mentions.length > 0;
  const priority = country?.priority ?? fallback?.priority ?? false;
  const categoryText = mainPolicy
    ? effectiveCategoryLabel(mainPolicy, lang)
    : lang === 'en'
      ? categoryName(fallback?.categoryCode ?? null, 'en')
      : fallback?.categoryLabel ?? null;
  const stayText = mainPolicy
    ? formatStayI18n(
        mainPolicy.stayDays,
        mainPolicy.stayUnit,
        mainPolicy.stayRule,
        mainPolicy.windowDays,
        mainPolicy.windowMaxDays,
        lang,
      )
    : lang === 'en'
      ? formatStayI18n(fallback?.stayDays ?? null, fallback?.stayUnit ?? null, 'UNSPECIFIED', null, null, 'en')
      : fallback?.stayLabel ?? null;
  const summary = mainPolicy?.summary ?? mainPolicy?.conditionsText ?? null;
  const conclusion = mainPolicy ? conclusionFor(mainPolicy, lang) : t('sheet.noPolicy');
  const groupLabel = mainPolicy
    ? policyGroupName(effectiveGroup(mainPolicy) ?? '', lang)
    : lang === 'en'
      ? policyGroupName(fallback?.group ?? null, 'en')
      : fallback?.groupLabel ?? '';
  const source = dossier?.source ?? null;
  const routeCode = mainPolicy?.routeCode ?? null;
  const accent = mainPolicy ? accentOf(mainPolicy) : 'var(--va-yellow)';

  return (
    <section
      className="va-sheet"
      role="dialog"
      aria-modal="false"
      aria-label={lang === 'en' ? `${title} visa dossier` : `${title} 签证档案`}
      data-testid="country-sheet"
      style={{ '--va-sheet-accent': accent } as CSSProperties}
    >
      {loading && !dossier ? (
        <LoadingBody
          title={title}
          subtitle={`${subtitle}${subtitle ? ' · ' : ''}${iso2}`}
          onClose={onClose}
          closeLabel={t('sheet.close')}
        />
      ) : (
        <>
          <div className="va-sheet__head">
            <div className="va-sheet__heading">
              <h2 className="va-sheet__title">{title}</h2>
              <p className="va-sheet__en">
                {subtitle}
                {subtitle ? ' · ' : ''}
                {iso2}
                {groupLabel ? ` · ${groupLabel}` : ''}
              </p>
            </div>
            <button
              type="button"
              className="va-icon-btn"
              data-testid="sheet-close"
              onClick={onClose}
              aria-label={t('sheet.close')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>

          {error ? (
            <div className="va-sheet__body">
              <div className="va-sheet__error" role="alert">
                <p>{error.message}</p>
                <button type="button" className="va-sheet__retry" onClick={onRetry}>
                  <RefreshCw size={12} aria-hidden="true" />
                  {t('sheet.retry')}
                </button>
              </div>
            </div>
          ) : !hasData ? (
            <div className="va-sheet__body">
              <div className="va-sheet__empty">
                <p className="va-sheet__empty-title">{t('sheet.emptyTitle')}</p>
                <p className="va-sheet__empty-hint">{t('sheet.emptyHint', { name: title })}</p>
              </div>
            </div>
          ) : (
            <div className="va-sheet__body">
              <div className="va-sheet__meta">
                <span className="va-chip va-chip--accent" style={{ color: accent }}>
                  {categoryText ?? t('sheet.caseByCase')}
                </span>
                <span className="va-chip">{stayText ?? t('sheet.stayPending')}</span>
                {mainPolicy ? <span className="va-chip">{entryScopeName(mainPolicy.entryScope, lang)}</span> : null}
                {priority ? <span className="va-chip va-chip--gold">{t('sheet.priority')}</span> : null}
              </div>

              <p className="va-sheet__conclusion">{conclusion}</p>
              {summary && lang === 'zh' ? <p className="va-sheet__excerpt">{summary}</p> : null}

              <div className="va-sheet__footer">
                <div className="va-sheet__types">
                  {mentions.length > 0 ? (
                    <>
                      <span className="va-sheet__types-label">{t('sheet.types')}</span>
                      {mentions.map(mention => (
                        <button
                          key={`${mention.visaType}-${mention.visaTypeLabel}`}
                          type="button"
                          className="va-chip va-chip--action"
                          onClick={() => onSearchType(mention.visaType)}
                          title={visaTypeName(mention.visaType, lang) || mention.visaTypeLabel}
                        >
                          {visaTypeName(mention.visaType, lang) || mention.visaTypeLabel}
                        </button>
                      ))}
                    </>
                  ) : (
                    <span className="va-sheet__types-label">{t('sheet.noTypes')}</span>
                  )}
                </div>
                <div className="va-sheet__source">
                  <span>
                    {t('sheet.source')}
                    {source
                      ? lang === 'en'
                        ? t('sheet.localCsv')
                        : `${source.publisher}《${source.title}》`
                      : t('sheet.localCsv')}{' '}
                    · {source ? formatIsoDate(source.accessedAt) : '2026-11'}
                  </span>
                  {routeCode ? <code>{routeCode}</code> : null}
                </div>
                <p className="va-sheet__warning">{t('sheet.warning')}</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
