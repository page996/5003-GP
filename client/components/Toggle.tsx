import type { ReactNode } from 'react';
import { cx } from './cx';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, hint, className, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('va-switch', checked && 'is-on', className)}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="va-switch__text">
        <span className="va-switch__label">{label}</span>
        {hint ? <span className="va-switch__hint">{hint}</span> : null}
      </span>
      <span className="va-switch__track" aria-hidden="true">
        <span className="va-switch__knob" />
      </span>
    </button>
  );
}
