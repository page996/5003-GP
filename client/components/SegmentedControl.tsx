import { cx } from './cx';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  size = 'md',
}: SegmentedControlProps<T>) {
  return (
    <div className={cx('va-seg', size === 'sm' && 'va-seg--sm', className)} role="group" aria-label={ariaLabel}>
      {options.map(option => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={cx('va-seg__btn', active && 'is-active')}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={13} strokeWidth={1.8} aria-hidden="true" /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
