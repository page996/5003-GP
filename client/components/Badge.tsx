import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'mint' | 'gold' | 'sky' | 'rose' | 'violet' | 'demo' | 'hint';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** 传入政策组/类别色时，徽章自动使用该色（文字 + 描边 + 底纹） */
  accent?: string | null;
  /** 可选颜色圆点（资料状态等） */
  dot?: string | null;
  className?: string;
  title?: string;
}

export function Badge({ children, tone = 'neutral', accent, dot, className, title }: BadgeProps) {
  const style = accent ? ({ '--va-badge-accent': accent } as CSSProperties) : undefined;
  return (
    <span
      className={cx('va-badge', `va-badge--${tone}`, accent && 'va-badge--accent', className)}
      style={style}
      title={title}
    >
      {dot ? <span className="va-badge__dot" style={{ background: dot }} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
