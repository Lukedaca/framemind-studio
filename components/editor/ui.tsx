import React from 'react';

// Sdílené prvky panelů editoru. Vzhled drží třídy fm-* ve styles.css.

export const PanelSection: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => (
  <section className="border-b border-hairline px-5 py-5 last:border-b-0">
    <div className="mb-4 flex items-center justify-between">
      <h3 className="fm-eyebrow">{title}</h3>
      {action}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
);

interface RangeProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Hodnota po dvojkliku; bez ní 0, u jednostranného posuvníku minimum. */
  defaultValue?: number;
  onChange: (value: number) => void;
}

// Posuvník s nulou uprostřed (−100…100) vybarvuje od středu, jednostranný od kraje.
// Dvojklik na popisek vrací výchozí hodnotu.
export const Range: React.FC<RangeProps> = ({ label, value, min = -100, max = 100, step = 1, unit = '', defaultValue, onChange }) => {
  const origin = min < 0 ? 0 : min;
  const reset = defaultValue ?? origin;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const from = Math.min(pct(origin), pct(value));
  const to = Math.max(pct(origin), pct(value));
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between text-[13px]">
        <span className="cursor-default text-ink-200" onDoubleClick={() => onChange(reset)} title="Dvojklik = výchozí">
          {label}
        </span>
        <span className={`font-mono text-xs tabular-nums ${value === reset ? 'text-ink-500' : 'text-ink-100'}`}>
          {value > 0 && min < 0 ? '+' : ''}
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fm-range"
        style={{ '--from': `${from}%`, '--to': `${to}%` } as React.CSSProperties}
      />
    </label>
  );
};

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={`fm-seg ${size === 'sm' ? 'fm-seg--sm' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={o.value === value ? 'is-active' : ''}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
