import type { CSSProperties } from 'react';
import { policyGroupColor } from '../../../shared/contracts.ts';
import type { SearchItem } from '../../../shared/contracts.ts';
import { Badge } from '../../components/Badge';
import { cx } from '../../components/cx';

export type ResultCardVariant = 'list' | 'grid';

interface ResultCardProps {
  item: SearchItem;
  selected: boolean;
  onSelect: (iso2: string) => void;
  variant?: ResultCardVariant;
}

function completenessTone(score: number): string {
  if (score >= 55) return 'var(--va-mint)';
  if (score >= 30) return 'var(--va-gold)';
  if (score > 0) return 'var(--va-sky)';
  return 'var(--va-text-3)';
}

function accentOf(item: SearchItem): string {
  if (item.group) return policyGroupColor(item.group);
  if (item.matchKind === 'MENTION_ONLY') return 'var(--va-gold)';
  return 'var(--va-sky)';
}

/** 结果卡：地图/列表/右侧结果共用；返回按钮语义保证键盘可达 */
export function ResultCard({ item, selected, onSelect, variant = 'list' }: ResultCardProps) {
  const accent = accentOf(item);
  const mention = item.matchKind === 'MENTION_ONLY';
  const summary = mention
    ? item.mentionText
      ? `来源仅标注「${item.mentionText}」等类型，结构化明细待采集`
      : '来源仅标注该签证类型，结构化明细待采集'
    : item.summary ?? '暂无摘要，点开查看国家档案';
  const progress = Math.max(0, Math.min(100, item.completeness));

  return (
    <button
      type="button"
      className={cx(
        'va-result-card',
        `va-result-card--${variant}`,
        selected && 'is-selected',
        item.isDemo && 'is-demo',
        mention && 'is-mention',
      )}
      style={{ '--va-accent': accent, '--va-progress': completenessTone(item.completeness) } as CSSProperties}
      onClick={() => onSelect(item.iso2)}
      data-testid="result-card"
      data-iso2={item.iso2}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${item.nameZh} ${item.visaTypeLabel} ${item.stayLabel ?? '停留期待确认'}，${item.statusLabel}`}
    >
      <span className="va-result-card__bar" aria-hidden="true" />
      <span className="va-result-card__head">
        <span className="va-result-card__name">{item.nameZh}</span>
        <span className="va-result-card__en">{item.nameEn}</span>
        <code className="va-iso">{item.iso2}</code>
      </span>
      <span className="va-result-card__meta">
        {item.categoryLabel ? (
          <Badge accent={accent} tone="neutral">
            {item.categoryLabel}
          </Badge>
        ) : (
          <Badge tone="gold">类型线索</Badge>
        )}
        <span className="va-result-card__type">{item.visaTypeLabel}</span>
        <span className="va-middot" aria-hidden="true">
          ·
        </span>
        <span className="va-result-card__stay">{item.stayLabel ?? '停留期待确认'}</span>
        <span className="va-result-card__flags">
          {item.priority ? <Badge tone="gold">重点</Badge> : null}
          {item.isDemo ? <Badge tone="demo">演示</Badge> : null}
        </span>
      </span>
      <span className="va-result-card__summary">{summary}</span>
      <span className="va-result-card__foot">
        <span className="va-progress" title={`资料完整度 ${Math.round(progress)}%`}>
          <span className="va-progress__fill" style={{ width: `${progress}%` }} />
        </span>
        <span className="va-result-card__status">{item.statusLabel}</span>
      </span>
    </button>
  );
}
