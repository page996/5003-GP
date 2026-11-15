import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ClipboardCopy,
  Clock3,
  Compass,
  FileText,
  Landmark,
  MapPin,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import {
  DATA_STATUS_META,
  VISA_CATEGORIES,
  categoryLabel as categoryLabelOf,
  formatIsoDate,
  formatStay,
  policyGroupColor,
  policyGroupLabel,
  visaTypeLabel as visaTypeLabelOf,
} from '../../../shared/contracts.ts';
import type { CountryDossier, PolicyFee, PolicyRecord, PolicyTiming } from '../../../shared/contracts.ts';
import type { ApiError } from '../../api';
import { Badge } from '../../components/Badge';
import { CompletenessRing } from '../../components/CompletenessRing';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../components/cx';

interface CountryDossierProps {
  iso2: string | null;
  dossier: CountryDossier | null;
  loading: boolean;
  error: ApiError | null;
  includeDemo: boolean;
  onBack: () => void;
  onRetry: () => void;
  onSearchType: (visaType: string) => void;
}

function categoryInfoOf(policy: PolicyRecord) {
  return policy.categoryCode ? VISA_CATEGORIES.find(category => category.code === policy.categoryCode) ?? null : null;
}

/** 后端已提供标签，但保留按代码回退，避免个别字段缺失时出现空徽章 */
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
  return group ? policyGroupColor(group) : 'var(--va-text-3)';
}

function conclusionFor(policy: PolicyRecord): string {
  switch (effectiveGroup(policy)) {
    case 'FREE':
      return policy.requiresAuthorization
        ? '中国普通护照可免签入境，但需完成指定在线登记 / 授权'
        : '中国普通护照可免签入境';
    case 'ARRIVAL':
      return '中国普通护照可在抵达口岸办理落地签';
    case 'ONLINE':
      return '中国普通护照需在线申请电子签证 / 电子旅行授权';
    case 'PREARRANGED':
      return '中国普通护照须在出发前向使领馆或签证中心递交申请';
    case 'SPECIAL':
      return '适用特殊许可 / 属地签证政策，需逐项确认';
    default:
      return policy.requiresVisa
        ? '中国普通护照须提前办理签证，具体类别待确认'
        : '中国普通护照可免签入境，具体条件待确认';
  }
}

function stayHeadline(policy: PolicyRecord): { value: string; unit: string } {
  if (policy.stayDays === null) return { value: '待确认', unit: '' };
  const unit = policy.stayUnit === 'MONTH' ? '个月' : policy.stayUnit === 'YEAR' ? '年' : '天';
  return { value: String(policy.stayDays), unit };
}

function feeLine(fee: PolicyFee): string {
  const amount = [fee.amountMin, fee.amountMax && fee.amountMax !== fee.amountMin ? fee.amountMax : null]
    .filter(Boolean)
    .join(' – ');
  const currency = fee.currency ? ` ${fee.currency}` : '';
  return [fee.label, amount ? `${amount}${currency}` : null, fee.basis].filter(Boolean).join(' · ');
}

function timingLine(timing: PolicyTiming): string {
  const dayType = timing.dayType === 'WORKING_DAY' ? '工作日' : timing.dayType === 'CALENDAR_DAY' ? '自然日' : '';
  const range =
    timing.minDays !== null || timing.maxDays !== null
      ? `${timing.minDays ?? '?'}–${timing.maxDays ?? '?'} ${dayType}`.trim()
      : null;
  return [timing.label, range, timing.note].filter(Boolean).join(' · ');
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 回退到 execCommand
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function DossierSkeleton() {
  return (
    <div className="va-dossier-skeleton" aria-hidden="true">
      <Skeleton width="46%" height={26} />
      <Skeleton width="30%" height={12} />
      <div className="va-dossier-skeleton__meta">
        <Skeleton width={56} height={18} radius={9} />
        <Skeleton width={72} height={18} radius={9} />
      </div>
      <div className="va-dossier-skeleton__card">
        <Skeleton width={96} height={18} radius={9} />
        <Skeleton width="86%" height={17} />
        <Skeleton width="70%" height={12} />
        <div className="va-dossier-skeleton__stats">
          <Skeleton width={64} height={34} />
          <Skeleton width={100} height={34} />
        </div>
        <Skeleton width="100%" height={46} radius={10} />
      </div>
      <Skeleton width={120} height={13} />
      <div className="va-dossier-skeleton__grid">
        <Skeleton width="100%" height={72} radius={10} />
        <Skeleton width="100%" height={72} radius={10} />
        <Skeleton width="100%" height={72} radius={10} />
      </div>
    </div>
  );
}

/** 国家档案：主政策 / 停留期 / 完整度 / 待采集 / 类型线索 / 演示明细 / 来源 */
export function CountryDossier({
  iso2,
  dossier,
  loading,
  error,
  includeDemo,
  onBack,
  onRetry,
  onSearchType,
}: CountryDossierProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [iso2]);

  const country = dossier?.country ?? null;
  const mainPolicy = dossier?.tourism ?? dossier?.policies[0] ?? null;
  const otherPolicies = dossier?.policies.filter(policy => policy.routeCode !== mainPolicy?.routeCode) ?? [];
  const mentions = dossier?.mentions ?? [];
  const demoPolicies = includeDemo ? dossier?.demoPolicies ?? [] : [];
  const hasAnyData = Boolean(mainPolicy) || mentions.length > 0 || demoPolicies.length > 0;
  const routeCode = mainPolicy?.routeCode ?? null;
  const completeness = mainPolicy ? mainPolicy.completeness : dossier?.stats.maxCompleteness ?? 0;
  const stay = mainPolicy ? stayHeadline(mainPolicy) : null;
  const stayText = mainPolicy
    ? formatStay(
        mainPolicy.stayDays,
        mainPolicy.stayUnit,
        mainPolicy.stayRule,
        mainPolicy.windowDays,
        mainPolicy.windowMaxDays,
      )
    : null;
  const feeLines = mainPolicy?.fees.map(feeLine) ?? [];
  const documentLines =
    mainPolicy?.documents.map(document => `${document.name}${document.required ? '（必需）' : ''}`) ?? [];
  const timingLines = mainPolicy?.timings.map(timingLine) ?? [];

  async function handleCopyRoute() {
    if (!routeCode) return;
    const ok = await copyText(routeCode);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="va-dossier" data-testid="dossier">
      <header className="va-side__head va-side__head--dossier">
        <button type="button" className="va-back-btn" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          返回结果
        </button>
        <div className="va-side__heading">
          <span className="va-eyebrow">DOSSIER</span>
          <div className="va-side__title-row">
            <h2>国家档案</h2>
            {iso2 ? <code className="va-iso va-iso--lg">{iso2}</code> : null}
          </div>
        </div>
      </header>

      <div className="va-side__scroll va-scroll">
        {loading && !dossier ? <DossierSkeleton /> : null}

        {error && !dossier ? <ErrorNotice error={error} onRetry={onRetry} className="va-dossier-error" /> : null}

        {error && dossier ? <ErrorNotice error={error} onRetry={onRetry} compact className="va-dossier-error" /> : null}

        {!loading && !error && !dossier ? (
          <EmptyState
            icon={Compass}
            title="还没有打开国家档案"
            description="在左侧地图或结果列表中选择一个目的地，这里会显示政策结论、停留期、资料完整度与来源。"
            action={
              <button type="button" className="va-button va-button--ghost" onClick={onBack}>
                返回结果
              </button>
            }
          />
        ) : null}

        {dossier && country ? (
          <>
            <div className="va-dossier-country">
              <div className="va-dossier-country__name">
                <h3>{country.nameZh}</h3>
                <p>{country.nameEn}</p>
              </div>
              <div className="va-dossier-country__meta">
                <Badge tone="sky">
                  <MapPin size={11} aria-hidden="true" />
                  {dossier.stats.regionLabel || country.regionLabel}
                </Badge>
                {country.priority ? <Badge tone="gold">重点候选</Badge> : null}
                {includeDemo && dossier.stats.demoCount > 0 ? <Badge tone="demo">演示明细 {dossier.stats.demoCount}</Badge> : null}
              </div>
            </div>

            {hasAnyData ? (
              <>
                {mainPolicy ? (
              <section
                className="va-policy"
                aria-label="旅游签主政策"
                style={{ '--va-accent': accentOf(mainPolicy) } as CSSProperties}
              >
                <div className="va-policy__flags">
                  <Badge accent={accentOf(mainPolicy)} tone="mint">
                    {effectiveCategoryLabel(mainPolicy)}
                  </Badge>
                  <span className="va-policy__group">{effectiveGroupLabel(mainPolicy)}</span>
                  <span className="va-policy__type">{effectiveTypeLabel(mainPolicy)}</span>
                  {mainPolicy.isDemo ? <Badge tone="demo">演示</Badge> : null}
                </div>
                <p className="va-policy__conclusion">{conclusionFor(mainPolicy)}</p>
                {mainPolicy.title ? <p className="va-policy__title">{mainPolicy.title}</p> : null}
                {mainPolicy.summary ? <p className="va-policy__summary">{mainPolicy.summary}</p> : null}

                <div className="va-policy__facts">
                  <div className="va-policy__stay">
                    <span className="va-policy__stay-label">单次停留</span>
                    <span className="va-policy__stay-value">
                      <strong>{stay?.value}</strong>
                      {stay?.unit ? <small>{stay.unit}</small> : null}
                    </span>
                    {stayText ? <span className="va-policy__stay-rule">{stayText}</span> : null}
                  </div>
                  <dl className="va-policy__details">
                    <div>
                      <dt>入境次数</dt>
                      <dd>
                        {mainPolicy.entryScope === 'SINGLE'
                          ? '单次入境'
                          : mainPolicy.entryScope === 'MULTIPLE'
                            ? '多次入境'
                            : '待确认'}
                      </dd>
                    </div>
                    <div>
                      <dt>办理渠道</dt>
                      <dd>{mainPolicy.applicationChannel ?? '待采集'}</dd>
                    </div>
                    {mainPolicy.validityNote ? (
                      <div>
                        <dt>有效期说明</dt>
                        <dd>{mainPolicy.validityNote}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>

                {mainPolicy.conditionsText ? (
                  <blockquote className="va-quote">
                    <span className="va-quote__label">条件原文</span>
                    {mainPolicy.conditionsText}
                  </blockquote>
                ) : null}
              </section>
            ) : (
              <section className="va-policy va-policy--empty" aria-label="旅游签主政策">
                <p className="va-policy__conclusion">本轮尚未采集到该国的旅游签结构化政策。</p>
                <p className="va-policy__summary">
                  这表示资料待补充，不代表该国不需要签证。可参考下方的类型线索或返回结果更换目的地。
                </p>
              </section>
            )}

            <section className="va-dossier-section" aria-label="资料成熟度">
              <div className="va-dossier-section__head">
                <h3>资料成熟度</h3>
                <span className="va-eyebrow">COMPLETENESS</span>
              </div>
              <div className="va-completeness">
                <CompletenessRing value={completeness} />
                <div className="va-completeness__text">
                  <strong>
                    {mainPolicy ? DATA_STATUS_META[mainPolicy.dataStatus]?.label ?? mainPolicy.dataStatus : '待采集'}
                  </strong>
                  <p>
                    {mainPolicy
                      ? DATA_STATUS_META[mainPolicy.dataStatus]?.description ?? '资料状态待确认。'
                      : '尚未采集到可评估的结构化资料。'}
                  </p>
                  {dossier.stats.policyCount > 0 ? (
                    <span className="va-completeness__count">共 {dossier.stats.policyCount} 条真实政策记录</span>
                  ) : null}
                </div>
              </div>
              <div className="va-pending-grid">
                <div className={cx('va-pending', feeLines.length === 0 && 'is-empty')}>
                  <span className="va-pending__label">
                    <Wallet size={12} aria-hidden="true" />
                    费用
                  </span>
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
                  <span className="va-pending__label">
                    <FileText size={12} aria-hidden="true" />
                    材料
                  </span>
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
                  <span className="va-pending__label">
                    <Clock3 size={12} aria-hidden="true" />
                    审核时间
                  </span>
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
            </section>

            {mentions.length > 0 ? (
              <section className="va-dossier-section" aria-label="其他常见签证类型">
                <div className="va-dossier-section__head">
                  <h3>其他常见签证类型</h3>
                  <span className="va-eyebrow">TYPE HINTS</span>
                </div>
                <p className="va-dossier-hint">来源仅标注类型，结构化明细尚未采集。点击可切换为该用途检索。</p>
                <div className="va-chip-wrap">
                  {mentions.map(mention => (
                    <button
                      key={`${mention.visaType}-${mention.visaTypeLabel}`}
                      type="button"
                      className="va-chip va-chip--action"
                      onClick={() => onSearchType(mention.visaType)}
                      title={mention.rawText ?? mention.visaTypeLabel}
                    >
                      {mention.visaTypeLabel}
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {otherPolicies.length > 0 ? (
              <section className="va-dossier-section" aria-label="其他用途政策">
                <div className="va-dossier-section__head">
                  <h3>其他用途政策</h3>
                  <span className="va-eyebrow">OTHER POLICIES</span>
                </div>
                <ul className="va-policy-list">
                  {otherPolicies.map(policy => (
                    <li key={policy.routeCode}>
                      <span className="va-policy-list__type">{effectiveTypeLabel(policy)}</span>
                      <span className="va-policy-list__cat">{effectiveCategoryLabel(policy)}</span>
                      <span className="va-policy-list__stay">
                        {formatStay(policy.stayDays, policy.stayUnit, policy.stayRule, policy.windowDays, policy.windowMaxDays) ??
                          '停留期待确认'}
                      </span>
                      {policy.isDemo ? <Badge tone="demo">演示</Badge> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {demoPolicies.length > 0 ? (
              <section className="va-demo-block" aria-label="演示明细">
                <header className="va-demo-block__head">
                  <div>
                    <span className="va-demo-block__eyebrow">
                      <Badge tone="demo">演示</Badge>
                      演示明细样本
                    </span>
                    <p>仅用于展示字段与交互，内容为虚构，不可用于申请。</p>
                  </div>
                  <span className="va-demo-block__count">{demoPolicies.length} 条</span>
                </header>
                {demoPolicies.map(policy => (
                  <article key={policy.routeCode} className="va-demo-policy">
                    <div className="va-demo-policy__head">
                      <Badge tone="demo">演示</Badge>
                      <span className="va-demo-policy__type">{effectiveTypeLabel(policy)}</span>
                      <span className="va-demo-policy__category">{effectiveCategoryLabel(policy)}</span>
                      <code>{policy.routeCode}</code>
                    </div>
                    {policy.title ? <p className="va-demo-policy__title">{policy.title}</p> : null}
                    <div className="va-demo-policy__grid">
                      <div>
                        <span className="va-demo-policy__label">材料</span>
                        {policy.documents.length ? (
                          <ul>
                            {policy.documents.map(document => (
                              <li key={document.code}>
                                {document.name}
                                {document.required ? <span className="va-demo-policy__req">必需</span> : null}
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
                    {policy.conditionsText ? (
                      <p className="va-demo-policy__rule">
                        <span>资格规则</span>
                        {policy.conditionsText}
                      </p>
                    ) : null}
                    {policy.rules.length > 0 ? (
                      <div className="va-demo-policy__rules">
                        <span className="va-demo-policy__label">资格规则（演示）</span>
                        <ul>
                          {policy.rules.map(rule => (
                            <li key={rule.code}>
                              <span className="va-demo-rule__desc">{rule.description}</span>
                              <code className="va-demo-rule__expr">
                                {rule.fieldName} {rule.operatorName} {rule.expectedValue}
                              </code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}

            <section className="va-dossier-section" aria-label="来源与限制">
              <div className="va-dossier-section__head">
                <h3>来源与限制</h3>
                <span className="va-eyebrow">SOURCES</span>
              </div>
              {dossier.source ? (
                <dl className="va-source-list">
                  <div>
                    <dt>来源标题</dt>
                    <dd>{dossier.source.title}</dd>
                  </div>
                  <div>
                    <dt>发布方</dt>
                    <dd>{dossier.source.publisher}</dd>
                  </div>
                  <div>
                    <dt>访问日期</dt>
                    <dd>{formatIsoDate(dossier.source.accessedAt)}</dd>
                  </div>
                  {dossier.source.url ? (
                    <div>
                      <dt>链接</dt>
                      <dd>
                        <a
                          className="va-source-link"
                          href={dossier.source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <Landmark size={11} aria-hidden="true" />
                          查看原始来源
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="va-dossier-hint">该国家的来源记录待补充；本页结论仅来自小组整理的摘要级资料。</p>
              )}
              <p className="va-warning">
                <ShieldAlert size={13} aria-hidden="true" />
                未经使领馆逐条核验，资料仅供课程项目参考，请以官方最新公告为准。
              </p>
              {routeCode ? (
                <div className="va-route">
                  <span className="va-route__label">路线编号</span>
                  <code className="va-route__code">{routeCode}</code>
                  <button
                    type="button"
                    className="va-button va-button--tiny va-route__copy"
                    onClick={() => void handleCopyRoute()}
                  >
                    {copied ? <Check size={12} aria-hidden="true" /> : <ClipboardCopy size={12} aria-hidden="true" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              ) : null}
            </section>

              </>
            ) : (
              <EmptyState
                icon={Compass}
                title="尚未纳入本轮采集"
                description={`${country.nameZh}在 250 国目录中，但本轮 249 国 CSV 未提供旅游签政策；这不代表不需要签证。`}
                action={
                  <button type="button" className="va-button va-button--ghost" onClick={onBack}>
                    返回结果
                  </button>
                }
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
