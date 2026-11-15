import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ApiError } from '../api';
import { cx } from './cx';

interface ErrorNoticeProps {
  error: ApiError;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

/** 结果区 / 档案区的可重试错误条 */
export function ErrorNotice({ error, onRetry, compact, className }: ErrorNoticeProps) {
  return (
    <div className={cx('va-error', compact && 'va-error--compact', className)} role="alert">
      <AlertTriangle size={compact ? 14 : 16} className="va-error__icon" aria-hidden="true" />
      <div className="va-error__body">
        <p className="va-error__message">{error.message}</p>
        {error.code ? <span className="va-error__code">{error.code}</span> : null}
      </div>
      {onRetry ? (
        <button type="button" className="va-button va-button--tiny" onClick={onRetry} data-testid="retry">
          <RefreshCw size={12} aria-hidden="true" />
          重试
        </button>
      ) : null}
    </div>
  );
}
