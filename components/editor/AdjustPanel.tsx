import React from 'react';
import type { ManualEdits } from '../../types';
import { useTranslation } from '../../contexts/LanguageContext';
import Histogram from '../Histogram';
import { PanelSection, Range, Segmented } from './ui';

interface AdjustPanelProps {
  edits: ManualEdits;
  previewUrl: string | null;
  onChange: <K extends keyof ManualEdits>(key: K, value: ManualEdits[K]) => void;
  onAuto: () => void;
  onReset: () => void;
  isAutoRunning: boolean;
}

const RATIOS: { value: string; ratio: number | undefined; label: string }[] = [
  { value: 'orig', ratio: undefined, label: '' },
  { value: '1:1', ratio: 1, label: '1:1' },
  { value: '4:5', ratio: 4 / 5, label: '4:5' },
  { value: '3:2', ratio: 3 / 2, label: '3:2' },
  { value: '16:9', ratio: 16 / 9, label: '16:9' },
];

const AdjustPanel: React.FC<AdjustPanelProps> = ({ edits, previewUrl, onChange, onAuto, onReset, isAutoRunning }) => {
  const { t } = useTranslation();
  const ratioValue = RATIOS.find((r) => r.ratio === edits.aspectRatio)?.value ?? 'orig';

  return (
    <div>
      <div className="px-5 pt-5">
        <Histogram imageUrl={previewUrl} />
        <button onClick={onAuto} disabled={isAutoRunning} className="fm-btn-primary mt-4 w-full">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M4.7 15.3l2.1-2.1M13.2 6.8l2.1-2.1" strokeLinecap="round" />
          </svg>
          {t.adjust_auto}
        </button>
        <p className="mt-2 text-center text-[11px] text-ink-500">{t.adjust_auto_hint}</p>
      </div>

      <PanelSection
        title={t.adjust_light}
        action={
          <button onClick={onReset} className="text-[11px] text-ink-400 hover:text-ink-100">
            {t.manual_reset}
          </button>
        }
      >
        <Range label={t.manual_brightness} value={edits.brightness} onChange={(v) => onChange('brightness', v)} />
        <Range label={t.manual_contrast} value={edits.contrast} onChange={(v) => onChange('contrast', v)} />
        <Range label={t.manual_highlights} value={edits.highlights} onChange={(v) => onChange('highlights', v)} />
        <Range label={t.manual_shadows} value={edits.shadows} onChange={(v) => onChange('shadows', v)} />
      </PanelSection>

      <PanelSection title={t.adjust_color}>
        <Range label={t.manual_saturation} value={edits.saturation} onChange={(v) => onChange('saturation', v)} />
        <Range label={t.manual_vibrance} value={edits.vibrance} onChange={(v) => onChange('vibrance', v)} />
      </PanelSection>

      <PanelSection title={t.adjust_detail}>
        <Range label={t.manual_clarity} value={edits.clarity} min={0} onChange={(v) => onChange('clarity', v)} />
        <Range label={t.manual_sharpness} value={edits.sharpness} min={0} onChange={(v) => onChange('sharpness', v)} />
        <Range label={t.manual_noise} value={edits.noiseReduction} min={0} onChange={(v) => onChange('noiseReduction', v)} />
      </PanelSection>

      <PanelSection title={t.adjust_crop}>
        <Segmented
          size="sm"
          value={ratioValue}
          onChange={(v) => {
            onChange('aspectRatio', RATIOS.find((r) => r.value === v)?.ratio);
            onChange('cropRect', undefined);
          }}
          options={RATIOS.map((r) => ({ value: r.value, label: r.value === 'orig' ? t.export_original : r.label }))}
        />
      </PanelSection>
    </div>
  );
};

export default AdjustPanel;
