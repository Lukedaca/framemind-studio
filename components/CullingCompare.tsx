import React, { useEffect, useId, useRef, useState } from 'react';
import type { CullingDecision, CullingResult, UploadedFile } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import { CullingSession } from '../services/cullingSession';
import { getEffectiveDecision } from '../utils/cullingEngine';
import { inspectionDisplaySize, inspectionPoint, type CullingInspection, type InspectionPoint } from '../utils/cullingInspection';

interface Props {
  files: UploadedFile[];
  results: Map<string, CullingResult>;
  onDecision: (id: string, decision: CullingDecision) => void;
  onClose: () => void;
}
const CENTER = { x: 0.5, y: 0.5 };
const DECISIONS: CullingDecision[] = ['keep', 'review', 'reject'];
const LETTERS = { keep: 'K', review: 'R', reject: 'X' };

export default function CullingCompare({ files, results, onDecision, onClose }: Props) {
  const { t } = useTranslation();
  const tr = (key: string) => (t as unknown as Record<string, string>)[key] ?? key;
  // Immutable source snapshot for this dialog; manual decisions do not restart decoding.
  const [sources] = useState(() => files.slice(0, 4));
  const [points, setPoints] = useState<Record<string, InspectionPoint>>({});
  const [linked, setLinked] = useState(true);
  const [activeId, setActiveId] = useState(sources[0]?.id);
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [batch, setBatch] = useState<{ points: typeof points; values: Record<string, CullingInspection & { url: string }>; errors: string[] }>(
    { points, values: {}, errors: [] });
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); closeButton.current?.focus();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    let disposed = false;
    let session: CullingSession | undefined;
    const urls: string[] = [];
    setBatch({ points, values: {}, errors: [] });
    // Coalesce held arrow keys; replacing a request terminates the stale worker.
    const timer = setTimeout(async () => {
      try { session = new CullingSession(); }
      catch { if (!disposed) setBatch({ points, values: {}, errors: sources.map(f => f.id) }); return; }
      try {
        for (const file of sources) {
          try {
            const inspection = await session.inspect(file, points[file.id] ?? CENTER);
            if (disposed) return;
            const url = URL.createObjectURL(inspection.image); urls.push(url);
            setBatch(previous => ({ ...previous, values: { ...previous.values, [file.id]: { ...inspection, url } } }));
          } catch {
            if (disposed) return;
            setBatch(previous => ({ ...previous, errors: [...previous.errors, file.id] }));
          }
        }
      } finally { session.close(); }
    }, 80);
    return () => { disposed = true; clearTimeout(timer); session?.close(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [sources, points]);

  const selectPoint = (id: string, point: InspectionPoint) => {
    const bounded = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
    setActiveId(id);
    setPoints(previous => linked ? Object.fromEntries(sources.map(file => [file.id, bounded])) : { ...previous, [id]: bounded });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)) return;
    const decision = ({ k: 'keep', r: 'review', x: 'reject' } as const)[event.key.toLowerCase()];
    if (decision && activeId) { event.preventDefault(); onDecision(activeId, decision); return; }
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const current = batch.points === points ? batch.values[activeId] : undefined;
    if (move && activeId) {
      event.preventDefault();
      const point = points[activeId] ?? CENTER;
      const width = current?.sourceWidth ?? results.get(activeId)?.metrics.native?.sourceWidth ?? 1920;
      const height = current?.sourceHeight ?? results.get(activeId)?.metrics.native?.sourceHeight ?? 1280;
      selectPoint(activeId, { x: point.x + move[0] * 96 / width, y: point.y + move[1] * 96 / height });
    }
  };

  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={onKeyDown} className="fixed inset-0 m-auto w-[96vw] max-w-none h-[94vh] max-h-none p-0 rounded-2xl border border-border-subtle bg-void text-white backdrop:bg-black/80 open:flex open:flex-col">
    <header className="p-4 border-b border-border-subtle flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id={titleId} className="font-bold text-base">{tr('cull_compare_title')}</h2>
        <p className="text-xs text-gray-400 mt-1">{tr('cull_compare_hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={linked} onChange={event => {
          setLinked(event.target.checked);
          if (event.target.checked) setPoints(Object.fromEntries(sources.map(file => [file.id, points[activeId] ?? CENTER])));
        }} className="accent-fm-blue" />{tr('cull_compare_link')}</label>
        {([1, 2] as const).map(value => <button key={value} aria-pressed={zoom === value} onClick={() => setZoom(value)}
          className={`px-3 py-2 rounded-lg border ${zoom === value ? 'border-fm-blue text-fm-blue' : 'border-border-subtle'}`}>{value === 1 ? '1:1' : '2:1'}</button>)}
        <button onClick={() => setPoints({})} className="px-3 py-2 rounded-lg bg-elevated">{tr('cull_compare_center')}</button>
        <button ref={closeButton} onClick={onClose} className="px-4 py-2 rounded-lg bg-white text-black font-bold">{tr('cull_compare_close')}</button>
      </div>
    </header>
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className={`grid gap-4 ${sources.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        {sources.map(file => {
          const data = batch.points === points ? batch.values[file.id] : undefined;
          const error = batch.points === points && batch.errors.includes(file.id);
          const technical = data?.metrics.technical;
          const selected = activeId === file.id;
          const decision = getEffectiveDecision(results.get(file.id));
          const size = data ? inspectionDisplaySize(data.region, dpr, zoom) : undefined;
          return <section key={file.id} data-testid="culling-compare-panel" data-file-id={file.id}
            className={`min-w-0 rounded-xl border overflow-hidden ${selected ? 'border-fm-blue' : 'border-border-subtle'}`}>
            <button onClick={() => setActiveId(file.id)} aria-pressed={selected}
              className="w-full p-3 flex items-center justify-between gap-3 text-left bg-elevated">
              <span className="text-sm font-mono truncate">{file.file.name}</span>
              <span className="text-xs text-gray-400">{decision ? tr('cull_decision_' + decision) : '—'}</span>
            </button>
            <div className="p-3 space-y-3">
              <button className="relative block w-full h-44 bg-black/40 cursor-crosshair" aria-label={tr('cull_compare_region') + ' ' + file.file.name}
                aria-disabled={!data} onClick={event => {
                  if (!data) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const point = inspectionPoint(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height, data.sourceWidth, data.sourceHeight);
                  if (point) selectPoint(file.id, point);
                }}>
                <img src={file.originalPreviewUrl} alt="" className="w-full h-full object-contain" draggable={false} />
                {data && <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${data.sourceWidth} ${data.sourceHeight}`}>
                  <rect {...data.region} fill="none" stroke="#5f9eff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>}
              </button>
              <p className="text-xs text-gray-400">{tr(file.cullingSource === 'embedded-jpeg-preview' ? 'cull_source_raw_preview' : 'cull_source_image')}</p>
              <div className="h-[400px] overflow-auto bg-black/50 rounded-lg grid place-items-center" data-testid="culling-native-crop" aria-busy={!data && !error}>
                {data ? <img src={data.url} alt={tr('cull_compare_crop') + ' ' + file.file.name} draggable={false}
                  style={{ width: size!.width, height: size!.height, maxWidth: 'none', imageRendering: zoom === 2 ? 'pixelated' : 'auto' }} />
                  : <p role={error ? 'alert' : 'status'} className="p-4 text-sm text-gray-400">{tr(error ? 'cull_compare_error' : 'cull_compare_loading')}</p>}
              </div>
              {technical && <div className="flex flex-wrap justify-between gap-2 text-xs font-mono" data-testid="culling-region-metrics">
                <span>{tr('cull_compare_region_detail')}: {technical.laplacianVariance.toFixed(1)}</span>
                <span>{tr('cull_metric_evidence')}: {Math.round(technical.detailConfidence * 100)} / 100</span>
                <span>{data.region.width} × {data.region.height} px · x {data.region.x} / y {data.region.y}</span>
              </div>}
              {technical && technical.detailConfidence < 0.3 && <p className="text-xs text-fm-blue">{tr('cull_risk_low_detail')}</p>}
              <div className="flex gap-2">
                {DECISIONS.map(value => <button key={value} onClick={() => { setActiveId(file.id); onDecision(file.id, value); }}
                  aria-pressed={results.get(file.id)?.manualDecision === value} disabled={!results.has(file.id)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-bold disabled:opacity-40 ${decision === value ? 'border-fm-blue text-white bg-fm-blue/20' : 'border-border-subtle text-gray-400'}`}>
                  {LETTERS[value]} · {tr('cull_decision_' + value)}
                </button>)}
              </div>
            </div>
          </section>;
        })}
      </div>
    </div>
    <footer className="border-t border-border-subtle p-3 text-xs text-gray-400">{tr('cull_compare_footer')}</footer>
  </dialog>;
}
