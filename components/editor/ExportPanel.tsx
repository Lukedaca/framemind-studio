import React, { useState } from 'react';
import type { ManualEdits, WatermarkSettings } from '../../types';
import type { SupportedExportFormat } from '../../utils/fileSave';
import { useTranslation } from '../../contexts/LanguageContext';
import { PanelSection, Range, Segmented } from './ui';

export interface ExportOptions {
  format: SupportedExportFormat;
  quality: number;
  scale: number;
}

interface ExportPanelProps {
  options: ExportOptions;
  onOptionsChange: (options: ExportOptions) => void;
  watermark: ManualEdits['watermark'];
  onWatermarkChange: (watermark: WatermarkSettings) => void;
  fileCount: number;
  canUseNativeSave: boolean;
  onDownload: () => void;
  onSaveAs: () => void;
  onExportAll: () => void;
  busy: boolean;
}

const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false, text: '', opacity: 50, size: 20, position: 'bottom-right', color: '#ffffff',
};

const ExportPanel: React.FC<ExportPanelProps> = (props) => {
  const { t } = useTranslation();
  const { options, onOptionsChange } = props;
  const wm = props.watermark ?? DEFAULT_WATERMARK;
  const [showWm, setShowWm] = useState(wm.enabled);
  const setWm = (patch: Partial<WatermarkSettings>) => props.onWatermarkChange({ ...wm, ...patch });

  return (
    <div>
      <div className="px-5 pb-5 pt-6">
        <h2 className="font-display text-[22px] leading-tight text-ink-50">{t.export_title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{t.export_lead}</p>
      </div>

      <PanelSection title={t.export_format}>
        <Segmented
          value={options.format}
          onChange={(format) => onOptionsChange({ ...options, format })}
          options={[
            { value: 'jpeg', label: 'JPEG' },
            { value: 'png', label: 'PNG' },
          ]}
        />
        {options.format === 'jpeg' && (
          <Range label={t.export_quality} value={options.quality} min={40} max={100} unit=" %" onChange={(quality) => onOptionsChange({ ...options, quality })} />
        )}
        <div>
          <span className="mb-2 block text-[13px] text-ink-200">{t.export_size}</span>
          <Segmented
            size="sm"
            value={options.scale}
            onChange={(scale) => onOptionsChange({ ...options, scale })}
            options={[
              { value: 1, label: '100 %' },
              { value: 0.5, label: '50 %' },
              { value: 0.25, label: '25 %' },
            ]}
          />
        </div>
      </PanelSection>

      <section className="border-b border-hairline px-5 py-5">
        <button onClick={() => setShowWm((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="fm-eyebrow">{t.manual_watermark}</span>
          <span className="text-[11px] text-ink-500">{wm.enabled ? t.export_on : showWm ? '−' : '+'}</span>
        </button>
        {showWm && (
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between text-[13px] text-ink-200">
              {t.manual_activate}
              <input type="checkbox" className="fm-switch" checked={wm.enabled} onChange={(e) => setWm({ enabled: e.target.checked })} />
            </label>
            {wm.enabled && (
              <>
                <input
                  type="text"
                  value={wm.text}
                  onChange={(e) => setWm({ text: e.target.value })}
                  placeholder={t.manual_wm_placeholder}
                  className="fm-input"
                />
                <Segmented
                  size="sm"
                  value={wm.position}
                  onChange={(position) => setWm({ position })}
                  options={[
                    { value: 'bottom-right', label: t.manual_pos_bottom_right },
                    { value: 'bottom-left', label: t.manual_pos_bottom_left },
                    { value: 'center', label: t.manual_pos_center },
                  ]}
                />
                <Range label={t.manual_opacity} value={wm.opacity} min={10} max={100} unit=" %" onChange={(opacity) => setWm({ opacity })} />
              </>
            )}
          </div>
        )}
      </section>

      <div className="space-y-2.5 px-5 py-6">
        <button onClick={props.onDownload} disabled={props.busy} className="fm-btn-primary w-full">
          {t.export_download}
        </button>
        {props.canUseNativeSave && (
          <button onClick={props.onSaveAs} disabled={props.busy} className="fm-btn-ghost w-full">
            {t.export_save_as}
          </button>
        )}
        {props.fileCount > 1 && (
          <button onClick={props.onExportAll} disabled={props.busy} className="fm-btn-ghost w-full">
            {t.export_save_all_as} ({props.fileCount})
          </button>
        )}
        <p className="pt-1 text-[11px] leading-relaxed text-ink-500">{t.export_all_note}</p>
      </div>
    </div>
  );
};

export default ExportPanel;
