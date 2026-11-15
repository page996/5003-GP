import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  DATA_STATUS_META,
  VISA_CATEGORIES,
  categoryLabel as categoryLabelOf,
  entryScopeLabel,
  formatIsoDate,
  formatStay,
  policyGroupColor,
  policyGroupLabel,
  visaTypeLabel as visaTypeLabelOf,
} from '../../../shared/contracts.ts';
import type {
  CountryDossier,
  MapCountry,
  PolicyFee,
  PolicyRecord,
  PolicyTiming,
} from '../../../shared/contracts.ts';
import type { ApiError } from '../../api';
import { cx } from '../../components/cx';

interface CountrySheetProps {
  open: boolean;
  iso2: string;
  fallback: MapCountry | null;
  dossier: CountryDossier | null;
  loading: boolean;
  error: ApiError | null;
  expanded: boolean;
  onClose: () => void;
  onToggleExpanded: () => void;
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
  return policy.categoryLabel || categoryLabelOf(policy.categoryCode);
}

function effectiveTypeLabel(policy: PolicyRecord): string {
  return policy.visaTypeLabel || visaTypeLabelOf(policy.visaType);
}

function effectiveGroupLabel(policy: PolicyRecord): string {
  const group = effectiveGroup(policy);
  return policy.groupLabel || (group ? policyGroupLabel(group) : '');
}

function accentOf(policy: PolicyRecord): string {
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

function feeLine(fee: PolicyFee): string {
  const amount = [fee.amountMin, fee.amountMax && fee.amountMax !== fee.amountMin ? fee.amountMax : null]
    .filter(Boolean)
    .join(' – ');
  const currency = fee.currency ? ` ${fee.currency}` : '';
  return [fee.label, amount ? `${amount}${currency}` : null].filter(Boolean).join(' · ');
}

function timingLine(timing: PolicyTiming): string {
  const dayType = timing.dayType === 'WORKING_DAY' ? '工作日' : timing.dayType === 'CALENDAR_DAY' ? '自然日' : '';
  const range =
    timing.minDays !== null || timing.maxDays !== null
      ? `${timing.minDays ?? '?'}–${timing.maxDays ?? '?'} ${dayType}`.trim()
      : null;
  return [timing.label, range].filter(Boolean).join(' · ');
}

function LoadingBody({
  nameZh,
  nameEn,
  iso2,
  onClose,
}: {
  nameZh: string;
  nameEn: string;
  iso2: string;
  onClose: () => void;
}) {
  return (
    <>
      <div className="va-sheet__head">
        <div>
          <h2 className="va-sheet__title">{nameZh}</h2>
          <p className="va-sheet__en">
            {nameEn} · {iso2}
          </p>
        </div>
        <button
          type="button"
          className="va-icon-btn"
          data-testid="sheet-close"
          onClick={onClose}
          aria-label="关闭国家档案"
        >
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
        <span className="va-skeleton" style={{ width: '54%', height: 12 }} />
      </div>
    </>
  );
}

/** v2 底部国家抽屉：收起摘要 / 展开完整档案 */
export function CountrySheet({
  open,
  iso2,
  fallback,
  dossier,
  loading,
  error,
  expanded,
  onClose,
  onToggleExpanded,
  onRetry,
  onSearchType,
}: CountrySheetProps) {
  if (!open) return null;

  const country = dossier?.country ?? null;
  const nameZh = country?.nameZh ?? fallback?.nameZh ?? iso2;
  const nameEn = country?.nameEn ?? fallback?.nameEn ?? '';
  const mainPolicy = dossier?.tourism ?? dossier?.policies[0] ?? null;
  const mentions = dossier?.mentions ?? [];
  const demoPolicies = dossier?.demoPolicies ?? [];
  const hasData = Boolean(mainPolicy) || mentions.length > 0 || demoPolicies.length > 0;
  const priority = country?.priority ?? fallback?.priority ?? false;
  const completeness = mainPolicy?.completeness ?? dossier?.stats.maxCompleteness ?? fallback?.completeness ?? 0;
  const categoryText = mainPolicy ? effectiveCategoryLabel(mainPolicy) : fallback?.categoryLabel ?? null;
  const stayText = mainPolicy
    ? formatStay(mainPolicy.stayDays, mainPolicy.stayUnit, mainPolicy.stayRule, mainPolicy.windowDays, mainPolicy.windowMaxDays)
    : fallback?.stayLabel ?? null;
  const summary = mainPolicy?.summary ?? mainPolicy?.conditionsText ?? null;
  const conclusion = mainPolicy
    ? conclusionFor(mainPolicy)
    : '本轮尚未采集到该国的旅游签结构化政策，不代表不需要签证。';
  const groupLabel = mainPolicy ? effectiveGroupLabel(mainPolicy) : fallback?.groupLabel ?? '';
  const statusLabel = mainPolicy ? DATA_STATUS_META[mainPolicy.dataStatus]?.label ?? mainPolicy.dataStatus : '待采集';
  const source = dossier?.source ?? null;
  const routeCode = mainPolicy?.routeCode ?? null;
  const feeLines = mainPolicy?.fees.map(feeLine) ?? [];
  const documentLines = mainPolicy?.documents.map(document => `${document.name}${document.required ? '（必需）' : ''}`) ?? [];
  const timingLines = mainPolicy?.timings.map(timingLine) ?? [];

  return (
    <section
      className={cx('va-sheet', expanded && 'is-expanded')}
      role="dialog"
      aria-modal="false"
      aria-label={`${nameZh} 签证档案`}
      data-testid="country-sheet"
      style={{ '--va-sheet-accent': mainPolicy ? accentOf(mainPolicy) : 'var(--va-yellow)' } as CSSProperties}
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
            <button
              type="button"
              className="va-icon-btn"
              data-testid="sheet-close"
              onClick={onClose}
              aria-label="关闭国家档案"
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
                <span className="va-chip va-chip--accent">{categoryText ?? '逐案确认'}</span>
                <span className="va-chip">{stayText ?? '停留期待确认'}</span>
                {mainPolicy ? <span className="va-chip">{entryScopeLabel(mainPolicy.entryScope)}</span> : null}
                {priority ? <span className="va-chip va-chip--gold">重点候选</span> : null}
                <span className="va-chip">完整度 {Math.round(completeness)}%</span>
              </div>

              <p className="va-sheet__conclusion">{conclusion}</p>
              {summary ? <p className="va-sheet__excerpt">{summary}</p> : null}

              {expanded ? (
                <div className="va-sheet__details va-scroll">
                  <div className="va-sheet__details-section">
                    <h3>
                      资料成熟度 <span>{statusLabel}</span>
                    </h3>
                    <div className="va-pending-grid">
                      <div className={cx('va-pending', feeLines.length === 0 && 'is-empty')}>
                        <span className="va-pending__label">费用</span>
                        {feeLines.length ? (
                          <ul>
                            {feeLines.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="va-pending__empty">待采集</span>
                        )}
                      </div>
                      <div className={cx('va-pending', documentLines.length === 0 && 'is-empty')}>
                        <span className="va-pending__label">材料</span>
                        {documentLines.length ? (
                          <ul>
                            {documentLines.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="va-pending__empty">待采集</span>
                        )}
                      </div>
                      <div className={cx('va-pending', timingLines.length === 0 && 'is-empty')}>
                        <span className="va-pending__label">审核时间</span>
                        {timingLines.length ? (
                          <ul>
                            {timingLines.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="va-pending__empty">待采集</span>
                        )}
                      </div>
                    </div>
                    <p className="va-sheet__note">本轮真实资料为摘要级：费用、材料、审核时间尚未采集，界面不编造数值。</p>
                  </div>

                  {demoPolicies.length > 0 ? (
                    <div className="va-sheet__details-section va-demo-block">
                      <h3>
                        演示样本 <span className="va-demo-block__count">{demoPolicies.length} 条</span>
                      </h3>
                      <p className="va-demo-block__hint">以下为虚构演示明细，仅用于展示字段与交互，不可用于申请。</p>
                      {demoPolicies.map(policy => (
                        <article key={policy.routeCode} className="va-demo-policy">
                          <div className="va-demo-policy__head">
                            <span className="va-demo-policy__tag">演示</span>
                            <span>{effectiveTypeLabel(policy)}</span>
                            <span className="va-demo-policy__group">{effectiveCategoryLabel(policy)}</span>
                            <code>{policy.routeCode}</code>
                          </div>
                          <div className="va-demo-policy__grid">
                            <div>
                              <span className="va-demo-policy__label">材料</span>
                              {policy.documents.length ? (
                                <ul>
                                  {policy.documents.map(document => (
                                    <li key={document.code}>
                                      {document.name}
                                      {document.required ? <em>必需</em> : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="va-pending__empty">演示未提供</span>
                              )}
                            </div>
                            <div>
                              <span className="va-demo-policy__label">费用</span>
                              {policy.fees.length ? (
                                <ul>
                                  {policy.fees.map(fee => (
                                    <li key={fee.code}>{feeLine(fee)}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="va-pending__empty">演示未提供</span>
                              )}
                            </div>
                            <div>
                              <span className="va-demo-policy__label">审核时间</span>
                              {policy.timings.length ? (
                                <ul>
                                  {policy.timings.map(timing => (
                                    <li key={timing.code}>{timingLine(timing)}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="va-pending__empty">演示未提供</span>
                              )}
                            </div>
                          </div>
                          {policy.rules.length > 0 ? (
                            <div className="va-demo-policy__rules">
                              <span className="va-demo-policy__label">资格规则</span>
                              <ul>
                                {policy.rules.map(rule => (
                                  <li key={rule.code}>
                                    {rule.description}
                                    <code>
                                      {rule.fieldName} {rule.operatorName} {rule.expectedValue}
                                    </code>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}

                  <div className="va-sheet__details-section">
                    <h3>来源与限制</h3>
                    {source ? (
                      <dl className="va-source-list">
                        <div>
                          <dt>来源</dt>
                          <dd>{source.title}</dd>
                        </div>
                        <div>
                          <dt>发布方</dt>
                          <dd>{source.publisher}</dd>
                        </div>
                        <div>
                          <dt>访问日期</dt>
                          <dd>{formatIsoDate(source.accessedAt)}</dd>
                        </div>
                        {source.url ? (
                          <div>
                            <dt>链接</dt>
                            <dd>
                              <a href={source.url} target="_blank" rel="noreferrer noopener">
                                查看原始来源
                              </a>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : (
                      <p className="va-sheet__note">该国家的来源记录待补充。</p>
                    )}
                    <p className="va-sheet__warning">未经使领馆逐条核验；资料仅供课程项目参考，请以官方最新公告为准。</p>
                    {routeCode ? (
                      <div className="va-route">
                        <span>路线编号</span>
                        <code>{routeCode}</code>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {error || !hasData ? null : (
            <div className="va-sheet__foot">
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
              <button
                type="button"
                className="va-sheet__expand"
                data-testid="sheet-expand"
                onClick={onToggleExpanded}
                aria-expanded={expanded}
              >
                {expanded ? (
                  <>
                    收起档案 <ArrowUp size={13} aria-hidden="true" />
                  </>
                ) : (
                  <>
                    展开完整档案 <ArrowDown size={13} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
