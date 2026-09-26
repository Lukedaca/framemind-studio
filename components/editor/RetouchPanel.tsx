import React, { useState } from 'react';
import { useTranslation } from '../../contexts/LanguageContext';
import { INPAINT_MODELS } from '../../utils/inpaintModels';
import { SEGMENT_TOTAL_BYTES } from '../../utils/segmentModel';
import type { InpaintChoice } from '../../services/localInpaint';
import RetouchPrompt from './RetouchPrompt';
import { PanelSection, Range, Segmented } from './ui';

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'downloading'; loaded: number; total: number }
  | { state: 'preparing' }
  | { state: 'ready'; backend: string }
  | { state: 'error'; message: string };

export type LassoStatus =
  | { state: 'idle' }
  | { state: 'downloading'; loaded: number; total: number }
  | { state: 'reading' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

interface LassoProps {
  status: LassoStatus;
  busy: boolean;
  objectCount: number;
  /** Zvolená velikost posledního objektu (index do seřazených kandidátů). */
  level: number | null;
  levelCount: number;
  onLevelChange: (level: number) => void;
  onRemove: () => void;
  onClear: () => void;
}

interface RetouchPanelProps {
  tool: 'brush' | 'lasso';
  onToolChange: (tool: 'brush' | 'lasso') => void;
  lasso: LassoProps;
  model: InpaintChoice;
  onModelChange: (model: InpaintChoice) => void;
  modelStatus: ModelStatus;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (value: number) => void;
  strength: number;
  onStrengthChange: (value: number) => void;
  isProcessing: boolean;
  lastRunMs: number | null;
  canUndo: boolean;
  onUndo: () => void;
  // Volitelná úprava textem přes Gemini (vlastní API klíč).
  onPromptSubmit: (prompt: string, batch: boolean) => void;
  promptHistory: string[];
  fileCount: number;
  batchProgress: { current: number; total: number } | null;
}

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

const LassoControls: React.FC<LassoProps & { strength: number; onStrengthChange: (v: number) => void }> = (props) => {
  const { t } = useTranslation();
  const { status } = props;
  const levelLabels = [t.lasso_level_part, t.lasso_level_object, t.lasso_level_whole];
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-ink-300">{t.lasso_hint}</p>
      {status.state === 'downloading' && (
        <div>
          <div className="mb-1.5 flex justify-between text-[11px] text-ink-300">
            <span>{t.lasso_downloading}</span>
            <span className="font-mono tabular-nums">{Math.round((status.loaded / Math.max(1, status.total)) * 100)} %</span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-ink-700">
            <div className="fm-progress h-full rounded-full" style={{ width: `${Math.round((status.loaded / Math.max(1, status.total)) * 100)}%` }} />
          </div>
        </div>
      )}
      {(status.state === 'reading' || props.busy) && (
        <p className="flex items-center gap-2 text-[11px] text-ink-300">
          <span className="fm-spinner" />
          {status.state === 'reading' ? t.lasso_reading : t.lasso_finding}
        </p>
      )}
      {status.state === 'error' && <p className="text-[11px] leading-relaxed text-fm-red">{status.message}</p>}
      {status.state === 'idle' && (
        <p className="text-[11px] text-ink-500">{t.lasso_first_download.replace('{size}', mb(SEGMENT_TOTAL_BYTES))}</p>
      )}

      {props.objectCount > 0 && props.level !== null && props.levelCount > 1 && (
        <div className="space-y-2">
          <p className="text-[12px] text-ink-200">{t.lasso_level}</p>
          <Segmented
            value={String(props.level)}
            onChange={(v) => props.onLevelChange(Number(v))}
            options={Array.from({ length: props.levelCount }, (_, i) => ({
              value: String(i),
              label: levelLabels[Math.round((i * (levelLabels.length - 1)) / Math.max(1, props.levelCount - 1))],
            }))}
          />
        </div>
      )}

      <Range label={t.retouch_strength} value={props.strength} min={10} max={100} unit=" %" defaultValue={100} onChange={props.onStrengthChange} />

      <div className="flex gap-2">
        <button onClick={props.onRemove} disabled={props.objectCount === 0 || props.busy} className="fm-btn-primary flex-1">
          {t.lasso_remove}
        </button>
        <button onClick={props.onClear} disabled={props.objectCount === 0} className="fm-btn-ghost">
          {t.lasso_clear}
        </button>
      </div>
    </div>
  );
};

const RetouchPanel: React.FC<RetouchPanelProps> = (props) => {
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);
  const { modelStatus } = props;

  const status = (() => {
    switch (modelStatus.state) {
      case 'downloading': {
        const pct = Math.round((modelStatus.loaded / Math.max(1, modelStatus.total)) * 100);
        return (
          <div>
            <div className="mb-1.5 flex justify-between text-[11px] text-ink-300">
              <span>{t.retouch_downloading}</span>
              <span className="font-mono tabular-nums">{pct} %</span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-ink-700">
              <div className="fm-progress h-full rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      }
      case 'preparing':
        return (
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-300">
              <span className="fm-spinner" />
              <span>{t.retouch_preparing}</span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-ink-700">
              <div className="fm-progress-indeterminate h-full w-1/3 rounded-full" />
            </div>
          </div>
        );
      case 'ready':
        return (
          <p className="flex items-center gap-2 text-[11px] text-ink-300">
            <span className="h-1.5 w-1.5 rounded-full bg-fm-green shadow-[0_0_8px_rgba(31,192,107,0.8)]" />
            {t.retouch_ready} · {modelStatus.backend === 'webgpu' ? 'GPU' : 'CPU'}
            {props.lastRunMs !== null && <span className="ml-auto font-mono text-ink-500">{(props.lastRunMs / 1000).toFixed(1)} s</span>}
          </p>
        );
      case 'error':
        return <p className="text-[11px] leading-relaxed text-fm-red">{modelStatus.message}</p>;
      default:
        return (
          <p className="text-[11px] text-ink-500">
            {/* V režimu Automaticky se na první větší ploše stahuje detailní model. */}
            {t.retouch_first_download.replace('{size}', mb(INPAINT_MODELS[props.model === 'auto' ? 'quality' : props.model].bytes))}
          </p>
        );
    }
  })();

  return (
    <div>
      <div className="px-5 pb-5 pt-6">
        <h2 className="font-display text-[20px] leading-tight text-ink-50">{t.retouch_title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{t.retouch_lead}</p>
      </div>

      <PanelSection title={t.retouch_tool}>
        <Segmented
          value={props.tool}
          onChange={props.onToolChange}
          options={[
            { value: 'brush', label: t.retouch_tool_brush },
            { value: 'lasso', label: t.retouch_tool_lasso },
          ]}
        />
        {props.tool === 'lasso' && <LassoControls {...props.lasso} strength={props.strength} onStrengthChange={props.onStrengthChange} />}
      </PanelSection>

      {props.tool === 'brush' && (
      <PanelSection title={t.retouch_brush}>
        <Range label={t.retouch_brush_size} value={props.brushSize} min={8} max={240} unit=" px" onChange={props.onBrushSizeChange} />
        <Range label={t.retouch_brush_hardness} value={props.brushHardness} min={0} max={100} unit=" %" defaultValue={85} onChange={props.onBrushHardnessChange} />
        <Range label={t.retouch_strength} value={props.strength} min={10} max={100} unit=" %" defaultValue={100} onChange={props.onStrengthChange} />
        <p className="text-[11px] text-ink-500">{t.retouch_shortcuts}</p>
      </PanelSection>
      )}

      <PanelSection title={t.retouch_quality}>
        <Segmented
          value={props.model}
          onChange={props.onModelChange}
          options={[
            { value: 'auto', label: t.retouch_model_auto, hint: t.retouch_model_auto_hint },
            { value: 'fast', label: t.retouch_model_fast, hint: `${INPAINT_MODELS.fast.name} · ${mb(INPAINT_MODELS.fast.bytes)}` },
            { value: 'quality', label: t.retouch_model_quality, hint: `${INPAINT_MODELS.quality.name} · ${mb(INPAINT_MODELS.quality.bytes)}` },
          ]}
        />
        <p className="text-[11px] leading-relaxed text-ink-400">
          {props.model === 'auto' ? t.retouch_model_auto_desc : props.model === 'fast' ? t.retouch_model_fast_desc : t.retouch_model_quality_desc}
        </p>
        {status}
      </PanelSection>

      <PanelSection title={t.retouch_history}>
        <button onClick={props.onUndo} disabled={!props.canUndo || props.isProcessing} className="fm-btn-ghost w-full">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M7.5 5 3.5 9l4 4M4 9h7.5a5 5 0 0 1 0 10H9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.retouch_undo}
        </button>
        <p className="text-[11px] leading-relaxed text-ink-500">{t.retouch_privacy}</p>
      </PanelSection>

      <section className="px-5 py-5">
        <button onClick={() => setShowPrompt((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="fm-eyebrow">{t.retouch_text_title}</span>
          <span className="text-[11px] text-ink-500">{showPrompt ? '−' : '+'}</span>
        </button>
        {showPrompt && (
          <div className="mt-4 space-y-3">
            <p className="text-[11px] leading-relaxed text-ink-400">{t.retouch_text_desc}</p>
            <RetouchPrompt
              onSubmit={props.onPromptSubmit}
              isProcessing={props.isProcessing}
              lastPrompts={props.promptHistory}
              fileCount={props.fileCount}
              batchProgress={props.batchProgress}
            />
          </div>
        )}
      </section>
    </div>
  );
};

export default RetouchPanel;
