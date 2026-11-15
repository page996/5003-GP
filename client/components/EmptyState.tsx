import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('va-empty', compact && 'va-empty--compact', className)}>
      {Icon ? (
        <span className="va-empty__icon" aria-hidden="true">
          <Icon size={compact ? 18 : 22} strokeWidth={1.6} />
        </span>
      ) : null}
      <h3 className="va-empty__title">{title}</h3>
      {description ? <p className="va-empty__desc">{description}</p> : null}
      {action ? <div className="va-empty__action">{action}</div> : null}
    </div>
  );
}
