import React, { useEffect, useRef, useState } from 'react';
import type { CullingDecision, CullingOutputTarget, CullingResult, UploadedFile } from '../types';
import { CULLING_ENGINE_VERSION, getEffectiveDecision } from '../utils/cullingEngine';
import { opticsVerdict, outputScale, reliableOptics, OUTPUT_SHARP, OUTPUT_SOFT } from '../utils/cullingOptics';

/** Decision colours shared by the dock, the queue and the progress bar. */
export const FOCUS_COLORS: Record<CullingDecision, string> = { keep: '#2fd17d', review: '#f5b03c', reject: '#ff7480' };
const KEYS: Record<CullingDecision, string> = { keep: 'K', review: 'R', reject: 'X' };
const DECISIONS: CullingDecision[] = ['keep', 'review', 'reject'];

interface CullingFocusProps {
  files: UploadedFile[];
  results: Map<string, CullingResult>;
  currentId: string;
  target: CullingOutputTarget;
  busy: boolean;
  finished: boolean;
  tr: (key: string) => string;
  onSelect: (id: string) => void;
  onDecide: (id: string, decision: CullingDecision) => void;
  onBack: () => void;
  onInspect: (id: string) => void;
  onRestart: () => void;
  onShowGrid: () => void;
  onContinue?: () => void;
  continueLabel: string;
}

const glowRgb = (blur: number) => blur <= OUTPUT_SHARP ? '47,209,125' : blur <= OUTPUT_SOFT ? '245,176,60' : '255,116,128';

/** One sentence that explains the suggestion for the chosen delivery size. */
function explain(result: CullingResult | undefined, target: CullingOutputTarget, tr: (key: string) => string): string {
  if (!result || result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus !== 'done') return tr('cull_focus_unmeasured');
  const name = tr('cull_target_name_' + target);
  let sentence: string;
  if (reliableOptics(result.metrics.optics)) {
    const kind = opticsVerdict(result.metrics.optics, target).kind;
    sentence = tr({ 'subject-sharp': 'cull_focus_s_sharp', 'frame-sharp': 'cull_focus_s_frame_sharp', 'focus-elsewhere': 'cull_focus_s_elsewhere',
      'subject-soft': 'cull_focus_s_soft', 'frame-soft': 'cull_focus_s_frame_soft', 'frame-blurred': 'cull_focus_s_blurred', unmeasured: 'cull_focus_unmeasured' }[kind]).replace('{target}', name);
  } else {
    const reason = result.reasons.find(r => !/_(range|needs_review)$/.test(r));
    sentence = reason ? tr(reason) + '.' : '';
  }
  const extra = result.risks.filter(r => r === 'cull_risk_series_alternative' || r === 'cull_risk_duplicate' || r === 'cull_risk_channel_clip' || r === 'cull_risk_highlights' || r === 'cull_risk_shadows');
  return [sentence, ...extra.map(r => tr(r) + '.')].filter(Boolean).join(' ');
}

const CullingFocus: React.FC<CullingFocusProps> = props => {
  const { files, results, currentId, target, busy, finished, tr } = props;
  const [showMap, setShowMap] = useState(false);
  const queueRef = useRef<HTMLElement>(null);
  const index = Math.max(0, files.findIndex(file => file.id === currentId));
  const file = files[index];
  const result = results.get(file.id);
  const suggestion = result && result.engineVersion === CULLING_ENGINE_VERSION ? result.decision : null;
  const effective = getEffectiveDecision(result);
  const decided = files.filter(f => results.get(f.id)?.manualDecision).length;
  const counts = DECISIONS.map(d => files.filter(f => getEffectiveDecision(results.get(f.id)) === d).length);
  const optics = result?.engineVersion === CULLING_ENGINE_VERSION && result.analysisStatus === 'done' && reliableOptics(result.metrics.optics) ? result.metrics.optics! : undefined;
  const scale = optics ? outputScale(target, optics.sourceWidth, optics.sourceHeight) : 1;
  const verdict = optics ? opticsVerdict(optics, target) : undefined;
  const sharpLabel = verdict?.sharpUpTo === undefined ? null : verdict.sharpUpTo >= Math.max(optics!.sourceWidth, optics!.sourceHeight)
    ? tr('cull_focus_sharp_full') : tr('cull_focus_sharp_to').replace('{px}', verdict.sharpUpTo.toLocaleString('cs-CZ'));

  useEffect(() => {
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

  return (
    <div className="flex min-h-0 flex-1 gap-4 max-md:flex-col">
      {/* Fotka přes celou plochu, kolem její rozostřená kopie */}
      <section aria-label={file.file.name} className="relative min-h-[420px] flex-1 overflow-hidden rounded-[22px] bg-black">
        <img src={file.originalPreviewUrl} alt="" aria-hidden className="fm-backdrop" draggable={false} />
        <div className="absolute inset-x-0 top-0 bottom-[132px] flex items-center justify-center p-6 max-md:bottom-[220px]">
          <div className="relative max-h-full max-w-full">
            <img src={file.originalPreviewUrl} alt={file.file.name} draggable={false}
              className="block max-h-[calc(100dvh-330px)] max-w-full rounded-xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] transition-[filter] duration-200"
              style={{ filter: showMap && optics ? 'brightness(.45) saturate(.5)' : undefined }} />
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

        <span className="fm-glass absolute left-4 top-4 max-w-[60%] truncate rounded-xl px-3 py-2 text-[12px] text-ink-200">
          {file.file.name}{sharpLabel ? ' · ' + sharpLabel : ''}
        </span>
        <div className="absolute right-4 top-4 flex gap-2">
          {optics && <button className="fm-glass inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold text-ink-50" aria-pressed={showMap} onClick={() => setShowMap(value => !value)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
            {showMap ? tr('cull_focus_hide_map') : tr('cull_focus_where_sharp')}
          </button>}
          <button className="fm-glass inline-flex h-10 items-center rounded-xl px-3.5 text-[13px] font-semibold text-ink-50" disabled={busy} onClick={() => props.onInspect(file.id)}>
            {tr('cull_focus_detail')}
          </button>
        </div>

        {/* Rozhodovací panel */}
        <div className="fm-glass absolute bottom-5 left-1/2 flex w-[min(880px,calc(100%-32px))] -translate-x-1/2 items-center gap-5 rounded-[22px] py-4 pl-6 pr-4 max-md:flex-col max-md:items-stretch">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-ink-400">{result?.manualDecision ? tr('cull_focus_your_choice') : tr('cull_focus_suggests')}</p>
            <p className="font-display text-[21px] leading-tight" style={{ color: effective ? FOCUS_COLORS[effective] : undefined }}>
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
                  className="flex min-h-[58px] min-w-[118px] flex-col items-center justify-center rounded-[15px] border border-white/10 px-4 font-display text-[15px] transition-transform hover:-translate-y-0.5 disabled:opacity-40 max-md:min-w-0 max-md:flex-1"
                  style={{ color: FOCUS_COLORS[d], background: hinted ? `color-mix(in srgb, ${FOCUS_COLORS[d]} 12%, transparent)` : 'rgba(255,255,255,.03)',
                    boxShadow: hinted ? `0 0 0 2px ${FOCUS_COLORS[d]}, 0 0 34px -6px ${FOCUS_COLORS[d]}` : undefined }}>
                  {tr('cull_decision_' + d)}
                  <span className="font-sans text-[11px] font-medium text-ink-400">{tr('cull_focus_key')} {KEYS[d]}</span>
                </button>
              );
            })}
          </div>
          <button className="fm-icon-btn h-11 w-11 flex-shrink-0 border border-white/10 max-md:hidden" onClick={props.onBack} disabled={index === 0}
            aria-label={tr('cull_focus_back')} title={tr('cull_focus_back')}>
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </button>
        </div>
      </section>

      {/* Fronta */}
      <nav ref={queueRef} aria-label={tr('cull_focus_queue')} className="custom-scrollbar flex w-[116px] flex-shrink-0 flex-col gap-2.5 overflow-y-auto p-1 max-md:w-full max-md:flex-row max-md:overflow-x-auto">
        <div className="w-[100px] flex-shrink-0">
          <p className="font-display text-[15px] text-ink-50">{decided} <span className="font-sans text-[13px] font-medium text-ink-400">/ {files.length}</span></p>
          <p className="text-[11px] text-ink-400">{tr('cull_focus_decided')}</p>
          <div className="mt-1.5 flex h-[5px] overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
            {DECISIONS.map(d => <span key={d} style={{ width: files.filter(f => results.get(f.id)?.manualDecision === d).length / files.length * 100 + '%', background: FOCUS_COLORS[d] }} />)}
          </div>
        </div>
        {files.map(f => {
          const r = results.get(f.id), d = getEffectiveDecision(r), current = f.id === currentId;
          return (
            <button key={f.id} data-queue-id={f.id} onClick={() => props.onSelect(f.id)} aria-current={current ? 'true' : undefined}
              aria-label={f.file.name + (d ? ', ' + tr('cull_decision_' + d) : '')}
              className={`relative aspect-[3/2] w-[100px] flex-shrink-0 overflow-hidden rounded-[9px] bg-black transition-transform hover:-translate-x-0.5 ${current ? 'shadow-[0_0_0_2px_#07080b,0_0_0_4px_#ffffff]' : ''}`}
              style={{ opacity: r?.manualDecision && !current ? 0.5 : 1 }}>
              <img src={f.originalPreviewUrl} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
              <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full shadow-[0_0_0_2px_rgba(7,8,11,0.8)]" style={{ background: d ? FOCUS_COLORS[d] : 'rgba(255,255,255,.25)' }} />
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default CullingFocus;
