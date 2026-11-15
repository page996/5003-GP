import type { CSSProperties } from 'react';
import { cx } from './cx';

interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

export function Skeleton({ className, width, height = 12, radius = 6, style }: SkeletonProps) {
  return (
    <span
      className={cx('va-skeleton', className)}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}
