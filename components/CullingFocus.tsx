import React, { useEffect, useRef, useState } from 'react';
import type { CullingDecision, CullingOutputTarget, CullingResult, UploadedFile } from '../types';
import { CULLING_ENGINE_VERSION, getEffectiveDecision } from '../utils/cullingEngine';
import { opticsVerdict, outputScale, reliableOptics, OUTPUT_SHARP, OUTPUT_SOFT } from '../utils/cullingOptics';

/** Decision colours shared by the dock, the queue and the progress bar. */
export const FOCUS_COLORS: Record<CullingDecision, string> = { keep: '#2fd17d', review: '#f5b03c', reject: '#ff7480' };
const KEYS: Record<CullingDecision, string> = { keep: 'K', review: 'R', reject: 'X' };
const DECISIONS: CullingDecision[] = ['keep', 'review', 'reject'];

export type FocusFilter = 'all' | 'review' | 'reject' | 'keep' | 'undecided';

interface CullingFocusProps {
  files: UploadedFile[];
  visibleFiles: UploadedFile[];
  results: Map<string, CullingResult>;
  currentId: string;
  target: CullingOutputTarget;
  filter: FocusFilter;
  onFilterChange: (filter: FocusFilter) => void;
  seriesMembers: UploadedFile[];
  busy: boolean;
  finished: boolean;
  showMap: boolean;
  onToggleMap: () => void;
  showShortcuts: boolean;
  onToggleShortcuts: () => void;
  tr: (key: string) => string;
  onSelect: (id: string) => void;
  onDecide: (id: string, decision: CullingDecision) => void;
  onBack: () => void;
  onInspect: (id: string) => void;
  onCompareSeries: () => void;
  onRestart: () => void;
  onShowGrid: () => void;
  onContinue?: () => void;
  continueLabel: string;
}

const glowRgb = (blur: number) => blur <= OUTPUT_SHARP ? '47,209,125' : blur <= OUTPUT_SOFT ? '245,176,60' : '255,116,128';

/** Format camera EXIF the way a photographer reads it (e.g. 1/1600 s · f/2.8 · ISO 800 · 200 mm). */
export function formatExifStrip(exif: CullingResult['exif']): string | null {
  if (!exif) return null;
  const parts: string[] = [];
  if (exif.exposureTime && exif.exposureTime > 0) {
    parts.push(exif.exposureTime < 0.5 ? `1/${Math.round(1 / exif.exposureTime)} s` : `${Number(exif.exposureTime.toFixed(1))} s`);
  }
  if (exif.aperture) parts.push(`f/${Number(exif.aperture.toFixed(1))}`);
  if (exif.iso) parts.push(`ISO ${Math.round(exif.iso)}`);
  if (exif.focalLength) parts.push(`${Math.round(exif.focalLength)} mm`);
  return parts.length ? parts.join(' · ') : null;
}

/** One sentence that explains the suggestion for the chosen delivery size. */
function explain(result: CullingResult | undefined, target: CullingOutputTarget, tr: (key: string) => string): string {
  if (!result || result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus !== 'done') return tr('cull_focus_unmeasured');
  const name = tr('cull_target_name_' + target);
  let sentence: string;
  if (result.reasons.includes('cull_reason_optics_motion_blur')) {
    sentence = tr('cull_focus_s_motion').replace('{target}', name);
  } else if (result.reasons.includes('cull_reason_optics_subject_blur')) {
    sentence = tr('cull_focus_s_subject_blur').replace('{target}', name);
  } else if (result.reasons.includes('cull_reason_optics_series_blur')) {
    sentence = tr('cull_focus_s_series_blur').replace('{target}', name);
  } else if (result.reasons.includes('cull_reason_severe_exposure')) {
    sentence = tr('cull_focus_s_exposure').replace('{target}', name);
  } else if (reliableOptics(result.metrics.optics)) {
    const kind = opticsVerdict(result.metrics.optics, target).kind;
    sentence = tr({
      'subject-sharp': 'cull_focus_s_sharp',
      'frame-sharp': 'cull_focus_s_frame_sharp',
      'focus-elsewhere': 'cull_focus_s_elsewhere',
      'subject-soft': 'cull_focus_s_soft',
      'frame-soft': 'cull_focus_s_frame_soft',
      'frame-blurred': 'cull_focus_s_blurred',
      unmeasured: 'cull_focus_unmeasured',
    }[kind]).replace('{target}', name);
  } else {
    const reason = result.reasons.find(r => !/_(range|needs_review)$/.test(r));
    sentence = reason ? tr(reason) + '.' : '';
  }
  const extra = result.risks.filter(r =>
    r === 'cull_risk_optics_motion' ||
    r === 'cull_risk_series_alternative' ||
    r === 'cull_risk_duplicate' ||
    r === 'cull_risk_channel_clip' ||
    r === 'cull_risk_highlights' ||
    r === 'cull_risk_shadows'
  );
  return [sentence, ...extra.map(r => tr(r) + '.')].filter(Boolean).join(' ');
}

const CullingFocus: React.FC<CullingFocusProps> = props => {
  const { files, visibleFiles, results, currentId, target, filter, onFilterChange, seriesMembers, busy, finished, showMap, onToggleMap, showShortcuts, onToggleShortcuts, tr } = props;
  const queueRef = useRef<HTMLElement>(null);
  const [filterPopoverOpen] = useState(false);
  void filterPopoverOpen;
  const queueFiles = visibleFiles;
  const index = Math.max(0, queueFiles.findIndex(file => file.id === currentId));
  const file = queueFiles[index];
  const result = file ? results.get(file.id) : undefined;
  const suggestion = result && result.engineVersion === CULLING_ENGINE_VERSION ? result.decision : null;
  const effective = getEffectiveDecision(result);
  const decided = files.filter(f => results.get(f.id)?.manualDecision).length;
  const undecidedCount = files.length - decided;
  const counts = DECISIONS.map(d => files.filter(f => getEffectiveDecision(results.get(f.id)) === d).length);
  const countByDecision: Record<CullingDecision, number> = { keep: counts[0], review: counts[1], reject: counts[2] };
  const optics = result?.engineVersion === CULLING_ENGINE_VERSION && result.analysisStatus === 'done' && reliableOptics(result.metrics.optics) ? result.metrics.optics! : undefined;
  const scale = optics ? outputScale(target, optics.sourceWidth, optics.sourceHeight) : 1;
  const verdict = optics ? opticsVerdict(optics, target) : undefined;
  const sharpLabel = verdict?.sharpUpTo === undefined ? null : verdict.sharpUpTo >= Math.max(optics!.sourceWidth, optics!.sourceHeight)
    ? tr('cull_focus_sharp_full') : tr('cull_focus_sharp_to').replace('{px}', verdict.sharpUpTo.toLocaleString('cs-CZ'));
  const exifLabel = formatExifStrip(result?.exif);
  const seriesIndex = file && seriesMembers.length > 1 ? seriesMembers.findIndex(m => m.id === file.id) + 1 : 0;

  useEffect(() => {
    if (!currentId) return;
    queueRef.current?.querySelector<HTMLElement>(`[data-queue-id="${CSS.escape(currentId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentId]);

  if (finished) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-7 rounded-[22px] border border-hairline bg-gradient-to-b from-ink-900 to-ink-950 p-8 text-center" aria-live="polite">
        <p className="fm-eyebrow">{tr('cull_focus_done_kicker')}</p>
        <h2 className="font-display text-[clamp(30px,3.4vw,46px)] text-ink-50">{tr('cull_focus_done_title')}</h2>
        <div className="flex flex-wrap justify-center gap-3.5">
          {DECISIONS.map((d, i) => (
            <div key={d} className="min-w-[150px] rounded-2xl border border-hairline bg-white/[0.03] px-5 py-4">
              <p className="font-display text-[38px] leading-none" style={{ color: FOCUS_COLORS[d] }}>{counts[i]}</p>
              <p className="mt-2 text-[14px] text-ink-200">{tr('cull_decision_' + d)}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-2.5">
          {props.onContinue && <button className="fm-btn-primary h-12 px-6" onClick={props.onContinue} disabled={busy}>{props.continueLabel}</button>}
          <button className="fm-btn-ghost h-12 px-5" onClick={props.onRestart}>{tr('cull_focus_again')}</button>
          <button className="fm-btn-ghost h-12 px-5" onClick={props.onShowGrid}>{tr('cull_mode_grid')}</button>
        </div>
      </section>
    );
  }

  const filterChips: { value: FocusFilter; label: string; count: number; color?: string }[] = [
    { value: 'all', label: tr('cull_focus_filter_all'), count: files.length },
    { value: 'review', label: tr('cull_decision_review'), count: countByDecision.review, color: FOCUS_COLORS.review },
    { value: 'reject', label: tr('cull_decision_reject'), count: countByDecision.reject, color: FOCUS_COLORS.reject },
    { value: 'keep', label: tr('cull_decision_keep'), count: countByDecision.keep, color: FOCUS_COLORS.keep },
    { value: 'undecided', label: tr('cull_focus_filter_undecided'), count: undecidedCount },
  ];

  return (
    <div className="flex min-h-0 flex-1 gap-4 max-md:flex-col">
      {/* Fotka přes celou plochu, kolem její rozostřená kopie */}
      <section aria-label={file?.file.name ?? tr('cull_title')} className="fm-stage-frame relative min-h-[420px] flex-1 overflow-hidden rounded-[22px] bg-black">
        {!file ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="font-display text-2xl text-ink-100">{tr('cull_focus_empty_filter')}</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <button className="fm-btn-ghost px-5" onClick={() => onFilterChange('all')}>{tr('cull_focus_show_all')}</button>
              {props.onContinue && <button className="fm-btn-primary px-6" onClick={props.onContinue} disabled={busy}>{tr('cull_focus_finish_now')} →</button>}
            </div>
          </div>
        ) : (
          <>
            <img src={file.originalPreviewUrl} alt="" aria-hidden className="fm-backdrop" draggable={false} />
            <div className="absolute inset-x-0 top-0 bottom-[132px] flex items-center justify-center p-6 max-md:bottom-[220px]">
              <div className="relative max-h-full max-w-full">
                <img
                  src={file.originalPreviewUrl}
                  alt={file.file.name}
                  draggable={false}
                  onClick={() => { if (!busy) props.onInspect(file.id); }}
                  title={tr('cull_focus_detail') + ' (Z)'}
                  className="block max-h-[calc(100dvh-330px)] max-w-full cursor-zoom-in rounded-xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] transition-[filter] duration-200"
                  style={{ filter: showMap && optics ? 'brightness(.45) saturate(.5)' : undefined }}
                />
                {showMap && optics && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
                    {Array.from({ length: optics.map.length / 4 }, (_, i) => {
                      const [x, y, blur, subject] = optics.map.slice(i * 4, i * 4 + 4), rgb = glowRgb(blur * scale), a = subject >= 0.5 ? 0.9 : 0.5;
                      return <span key={i} className="absolute aspect-square w-[8%] -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
                        style={{ left: x * 100 + '%', top: y * 100 + '%', background: `radial-gradient(circle, rgba(${rgb},${a}) 0%, rgba(${rgb},${(a * 0.3).toFixed(2)}) 40%, rgba(${rgb},0) 70%)` }} />;
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="absolute left-4 top-4 flex max-w-[58%] flex-wrap items-center gap-2">
              <div className="fm-glass flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-xl px-3.5 py-2 text-[12px]">
                <span className="truncate font-mono text-ink-100">{file.file.name}</span>
                {sharpLabel && <span className="text-ink-300">· {sharpLabel}</span>}
                {exifLabel && <span className="font-mono text-[11px] text-ink-400">· {exifLabel}</span>}
              </div>
              {seriesMembers.length > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={props.onCompareSeries}
                  title={tr('cull_focus_compare_series') + ' (C)'}
                  className="fm-glass inline-flex h-9 items-center gap-1.5 rounded-xl border-fm-blue/40 px-3 text-[12px] font-semibold text-sky-200 transition-colors hover:bg-fm-blue/25 disabled:opacity-40"
                >
                  <span>{tr('cull_series')} {seriesIndex}/{seriesMembers.length}</span>
                  <span className="text-ink-400">·</span>
                  <span>{tr('cull_focus_compare_series')}</span>
                </button>
              )}
            </div>

            <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2">
              {optics && <button className="fm-glass inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold text-ink-50" aria-pressed={showMap} onClick={onToggleMap} title="M">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
                {showMap ? tr('cull_focus_hide_map') : tr('cull_focus_where_sharp')}
              </button>}
              <button className="fm-glass inline-flex h-10 items-center rounded-xl px-3.5 text-[13px] font-semibold text-ink-50" disabled={busy} onClick={() => props.onInspect(file.id)} title="Z">
                {tr('cull_focus_detail')}
              </button>
              <button
                type="button"
                aria-pressed={showShortcuts}
                onClick={onToggleShortcuts}
                aria-label={tr('cull_focus_shortcuts')}
                title={`${tr('cull_focus_shortcuts')} (?)`}
                className="fm-glass inline-flex h-10 w-10 items-center justify-center rounded-xl font-mono text-[13px] font-bold text-ink-200 hover:text-white"
              >
                ?
              </button>
              {props.onContinue && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={props.onContinue}
                  className="fm-btn-primary h-10 rounded-xl px-4 text-[13px]"
                >
                  {tr('cull_focus_finish_now')} →
                </button>
              )}
            </div>

            {showShortcuts && (
              <div className="fm-glass absolute right-4 top-16 z-20 w-72 rounded-2xl p-4 text-[12px] text-ink-200 shadow-2xl" role="region" aria-label={tr('cull_focus_shortcuts_title')}>
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="font-semibold text-ink-50">{tr('cull_focus_shortcuts_title')}</p>
                  <button onClick={onToggleShortcuts} className="text-ink-400 hover:text-white" aria-label="×">×</button>
                </div>
                <dl className="space-y-1.5">
                  {[
                    ['K / R / X', `${tr('cull_decision_keep')} / ${tr('cull_decision_review')} / ${tr('cull_decision_reject')}`],
                    ['← / →', tr('cull_focus_queue')],
                    ['Backspace', tr('cull_focus_back')],
                    ['Z', tr('cull_focus_detail')],
                    ['M', tr('cull_focus_where_sharp')],
                    ['C', tr('cull_focus_compare_series')],
                    ['Ctrl+Z', tr('retouch_undo')],
                  ].map(([k, desc]) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <dt className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">{k}</dt>
                      <dd className="text-right text-ink-300">{desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Rozhodovací panel */}
            <div className="fm-glass absolute bottom-5 left-1/2 flex w-[min(880px,calc(100%-32px))] -translate-x-1/2 items-center gap-5 overflow-hidden rounded-[20px] py-4 pl-6 pr-4 max-md:flex-col max-md:items-stretch">
              <div className="fm-hairline absolute inset-x-0 top-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{result?.manualDecision ? tr('cull_focus_your_choice') : tr('cull_focus_suggests')}</p>
                <p className="mt-0.5 font-display text-[21px] leading-tight" style={{ color: effective ? FOCUS_COLORS[effective] : undefined }}>
                  {effective ? tr('cull_decision_' + effective) : '—'}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-200">{explain(result, target, tr)}</p>
              </div>
              <div role="group" aria-label={tr('cull_focus_choice_group')} className="flex flex-shrink-0 gap-2">
                {DECISIONS.map(d => {
                  const hinted = (effective ?? suggestion) === d;
                  return (
                    <button key={d} disabled={busy || !result} onClick={() => props.onDecide(file.id, d)}
                      aria-pressed={result?.manualDecision === d}
                      className="flex min-h-[58px] min-w-[118px] flex-col items-center justify-center gap-1 rounded-[14px] border border-white/10 px-4 font-display text-[15px] transition-transform hover:-translate-y-0.5 disabled:opacity-40 max-md:min-w-0 max-md:flex-1"
                      style={{ color: FOCUS_COLORS[d], background: hinted ? `color-mix(in srgb, ${FOCUS_COLORS[d]} 12%, transparent)` : 'rgba(255,255,255,.03)',
                        boxShadow: hinted ? `0 0 0 1.5px ${FOCUS_COLORS[d]}, 0 0 28px -8px ${FOCUS_COLORS[d]}` : undefined }}>
                      <span>{tr('cull_decision_' + d)}</span>
                      <span className="flex items-center gap-1 font-sans text-[10.5px] font-medium text-ink-400">
                        <span className="sr-only">{tr('cull_focus_key')} </span>
                        <span className="fm-kbd">{KEYS[d]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button className="fm-icon-btn h-11 w-11 flex-shrink-0 border border-white/10 max-md:hidden" onClick={props.onBack} disabled={index === 0}
                aria-label={tr('cull_focus_back')} title={`${tr('cull_focus_back')} (Backspace)`}>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
              </button>
            </div>
          </>
        )}
      </section>

      {/* Pravý sloupec: filtr fronty + samotná fronta fotek */}
      <div className="flex w-[144px] flex-shrink-0 flex-col gap-2 max-md:w-full">
        <div className="space-y-1.5 rounded-2xl border border-hairline bg-ink-900/70 p-2.5">
          <div>
            <p className="font-display text-[15px] text-ink-50">{decided} <span className="font-sans text-[12px] font-medium text-ink-400">/ {files.length}</span></p>
            <p className="text-[11px] text-ink-400">{tr('cull_focus_decided')}</p>
            <div className="mt-1.5 flex h-[5px] overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
              {DECISIONS.map(d => <span key={d} style={{ width: files.filter(f => results.get(f.id)?.manualDecision === d).length / Math.max(1, files.length) * 100 + '%', background: FOCUS_COLORS[d] }} />)}
            </div>
          </div>
          <div className="flex flex-col gap-1 pt-1 max-md:flex-row max-md:flex-wrap" role="group" aria-label={tr('cull_filter_all')}>
            {filterChips.map(chip => (
              <button
                key={chip.value}
                type="button"
                aria-pressed={filter === chip.value}
                onClick={() => onFilterChange(chip.value)}
                className={`flex items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                  filter === chip.value ? 'bg-white/15 text-white' : 'text-ink-400 hover:bg-white/[0.05] hover:text-ink-100'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {chip.color && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: chip.color }} />}
                  <span className="truncate">{chip.label}</span>
                </span>
                <span className="font-mono text-[10px] opacity-80">{chip.count}</span>
              </button>
            ))}
          </div>
        </div>

        <nav ref={queueRef} aria-label={tr('cull_focus_queue')} className="custom-scrollbar flex flex-1 flex-col gap-2.5 overflow-y-auto p-1 max-md:flex-row max-md:overflow-x-auto">
          {queueFiles.map(f => {
            const r = results.get(f.id), d = getEffectiveDecision(r), current = f.id === currentId;
            return (
              <button key={f.id} data-queue-id={f.id} onClick={() => props.onSelect(f.id)} aria-current={current ? 'true' : undefined}
                aria-label={f.file.name + (d ? ', ' + tr('cull_decision_' + d) : '')}
                className={`relative aspect-[3/2] w-full flex-shrink-0 overflow-hidden rounded-[9px] bg-black transition-transform hover:-translate-x-0.5 max-md:w-[100px] ${current ? 'shadow-[0_0_0_2px_#07080b,0_0_0_4px_#ffffff]' : ''}`}
                style={{ opacity: r?.manualDecision && !current ? 0.5 : 1 }}>
                <img src={f.originalPreviewUrl} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
                {r?.duplicateGroupId && <span className="absolute left-1.5 top-1.5 rounded bg-black/75 px-1 py-0.5 font-mono text-[9px] font-bold text-sky-200">{tr('cull_series')}</span>}
                <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full shadow-[0_0_0_2px_rgba(7,8,11,0.8)]" style={{ background: d ? FOCUS_COLORS[d] : 'rgba(255,255,255,.25)' }} />
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default CullingFocus;
