interface CompletenessRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
}

/** 资料完整度环：分数 0–100，颜色随成熟度变化，中心显示百分比 */
export function CompletenessRing({ value, size = 64, strokeWidth = 4 }: CompletenessRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const tone = clamped >= 80 ? 'good' : clamped >= 55 ? 'fair' : clamped >= 30 ? 'basic' : 'hint';

  return (
    <div
      className={`va-ring va-ring--${tone}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`资料完整度 ${clamped}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="va-ring__track" cx={center} cy={center} r={radius} fill="none" strokeWidth={strokeWidth} />
        <circle
          className="va-ring__value"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="va-ring__num">
        {clamped}
        <small>%</small>
      </span>
    </div>
  );
}
