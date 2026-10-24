import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CullingDecision, CullingResult, UploadedFile } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import { cullingInput } from '../services/cullingSession';
import { getEffectiveDecision } from '../utils/cullingEngine';
import { inspectionPoint } from '../utils/cullingInspection';

interface Props {
  files: UploadedFile[];
  results: Map<string, CullingResult>;
  onDecision: (id: string, decision: CullingDecision) => void;
  onClose: () => void;
  onFocusRegion?: (id: string, region: CullingResult['focusRegion'] | null) => void;
  busy?: boolean;
}
type Point = { x: number; y: number };
type Size = { width: number; height: number };
const DECISIONS: CullingDecision[] = ['keep', 'review', 'reject'];
const LETTERS = { keep: 'K', review: 'R', reject: 'X' };
const ZOOM_STEPS = [0.125, 0.25, 0.5, 1, 2, 4];

export default function CullingCompare({ files, results, onDecision, onClose, onFocusRegion, busy = false }: Props) {
  const { t } = useTranslation();
  const tr = (key: string) => (t as unknown as Record<string, string>)[key] ?? key;
  const [sources] = useState(() => files.slice(0, 4));
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [activeId, setActiveId] = useState(sources[0]?.id);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [focusMode, setFocusMode] = useState(false);
  const [focusSize, setFocusSize] = useState(256);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const areas = useRef(new Map<string, HTMLDivElement>());
  const centers = useRef(new Map<string, Point>());
  const drag = useRef<{ id: string; x: number; y: number; left: number; top: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal(); closeButton.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    // Display the actual imported bytes. No canvas, resizing, JPEG conversion or worker crop.
    const next = Object.fromEntries(sources.map(file => [file.id, URL.createObjectURL(cullingInput(file).file)]));
    setUrls(next);
    return () => Object.values(next).forEach(url => URL.revokeObjectURL(url));
  }, [sources]);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const changeZoom = (value: number | 'fit', focusId?: string, point?: Point) => {
    for (const [id, area] of areas.current) {
      centers.current.set(id, id === focusId && point ? point : zoom === 'fit' ? { x: 0.5, y: 0.5 } : {
        x: (area.scrollLeft + area.clientWidth / 2) / area.scrollWidth,
        y: (area.scrollTop + area.clientHeight / 2) / area.scrollHeight,
      });
    }
    if (focusId) setActiveId(focusId);
    setZoom(value);
  };
  useLayoutEffect(() => {
    for (const [id, point] of centers.current) {
      const area = areas.current.get(id);
      if (area) area.scrollTo(area.scrollWidth * point.x - area.clientWidth / 2, area.scrollHeight * point.y - area.clientHeight / 2);
    }
    centers.current.clear();
  }, [zoom, dpr]);

  const imagePoint = (id: string, clientX: number, clientY: number): Point | undefined => {
    const area = areas.current.get(id), size = sizes[id];
    if (!area || !size) return;
    if (zoom === 'fit') {
      const bounds = area.getBoundingClientRect();
      return inspectionPoint(clientX - bounds.left, clientY - bounds.top, area.clientWidth, area.clientHeight, size.width, size.height) ?? undefined;
    }
    const bounds = area.querySelector('img')?.getBoundingClientRect();
    if (bounds) return { x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)) };
  };
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const [id, area] of areas.current) {
      const wheel = (event: WheelEvent) => {
        const size = sizes[id];
        if (!size || !event.deltaY) return;
        event.preventDefault();
        const current = zoom === 'fit' ? Math.min(area.clientWidth / size.width, area.clientHeight / size.height) * dpr : zoom;
        const next = event.deltaY < 0 ? ZOOM_STEPS.find(value => value > current + 0.001) ?? 4 :
          [...ZOOM_STEPS].reverse().find(value => value < current - 0.001) ?? 0.125;
        changeZoom(next, id, imagePoint(id, event.clientX, event.clientY));
      };
      area.addEventListener('wheel', wheel, { passive: false });
      cleanups.push(() => area.removeEventListener('wheel', wheel));
    }
    return () => cleanups.forEach(cleanup => cleanup());
  }, [zoom, sizes, dpr]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)) return;
    const decision = ({ k: 'keep', r: 'review', x: 'reject' } as const)[event.key.toLowerCase()];
    if (decision && activeId) { event.preventDefault(); onDecision(activeId, decision); return; }
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const area = areas.current.get(activeId);
    if (move && area) { event.preventDefault(); area.scrollBy(move[0] * area.clientWidth / 4, move[1] * area.clientHeight / 4); }
    if (event.key === '0') { event.preventDefault(); changeZoom('fit'); }
    if (event.key === '1') { event.preventDefault(); changeZoom(1); }
  };

  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={onKeyDown} className="fixed inset-0 m-0 w-screen max-w-none h-[100dvh] max-h-none p-0 border-0 bg-void text-white backdrop:bg-black/90 open:flex open:flex-col">
    <header className="p-3 border-b border-border-subtle flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 id={titleId} className="font-bold text-base">{tr('cull_compare_title')}</h2>
        <p className="text-xs text-gray-400 mt-1">{tr('cull_compare_hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button aria-pressed={zoom === 'fit'} onClick={() => changeZoom('fit')}
          className={`px-3 py-2 rounded-lg border ${zoom === 'fit' ? 'border-fm-blue text-fm-blue' : 'border-border-subtle'}`}>{tr('cull_compare_fit')}</button>
        {[1, 2, 4].map(value => <button key={value} aria-pressed={zoom === value} onClick={() => changeZoom(value)}
          className={`px-3 py-2 rounded-lg border ${zoom === value ? 'border-fm-blue text-fm-blue' : 'border-border-subtle'}`}>{value * 100}%</button>)}
        {typeof zoom === 'number' && zoom < 1 && <span className="px-2 font-mono">{zoom * 100}%</span>}
        <button ref={closeButton} onClick={onClose} className="px-4 py-2 rounded-lg bg-white text-black font-bold">{tr('cull_compare_close')}</button>
        {onFocusRegion && <button disabled={busy} aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)} className={`px-3 py-2 rounded-lg border ${focusMode ? 'border-fm-green text-fm-green' : 'border-border-subtle'}`}>{tr('cull_focus_select')}</button>}
        {focusMode && [128, 256, 384].map(value => <button key={value} disabled={busy} aria-pressed={focusSize === value} onClick={() => setFocusSize(value)} className="px-2 py-1 border border-border-subtle rounded">{value} px</button>)}
        {onFocusRegion && results.get(activeId)?.focusRegion && <button disabled={busy} onClick={() => onFocusRegion(activeId, null)} className="px-3 py-2 border border-border-subtle rounded-lg">{tr('cull_focus_clear')}</button>}
      </div>
    </header>
    <div className={`flex-1 min-h-0 grid gap-2 p-2 ${sources.length > 1 ? 'grid-cols-1 md:grid-cols-2 auto-rows-fr overflow-auto' : 'grid-cols-1'}`}>
      {sources.map(file => {
        const size = sizes[file.id], selected = activeId === file.id, error = errors.includes(file.id);
        const focus = results.get(file.id)?.focusRegion;
        const decision = getEffectiveDecision(results.get(file.id));
        const pixels = size && zoom !== 'fit' ? { width: size.width * zoom / dpr, height: size.height * zoom / dpr } : undefined;
        return <section key={file.id} data-testid="culling-compare-panel" data-file-id={file.id}
          className={`min-w-0 min-h-0 flex flex-col border overflow-hidden ${selected ? 'border-fm-blue' : 'border-border-subtle'} ${sources.length > 1 ? 'min-h-[260px] md:min-h-0' : ''}`}>
          <button onClick={() => setActiveId(file.id)} aria-pressed={selected}
            className="w-full p-2 flex items-center justify-between gap-3 text-left bg-elevated">
            <span className="text-xs font-mono truncate">{file.originalFile?.name ?? file.file.name}</span>
            <span className="text-xs text-gray-400 shrink-0">{size ? `${size.width} × ${size.height} px` : ''}{decision ? ` · ${tr('cull_decision_' + decision)}` : ''}</span>
          </button>
          <div ref={element => { if (element) areas.current.set(file.id, element); else areas.current.delete(file.id); }}
            data-testid="culling-original-image" tabIndex={0} role="region" aria-label={tr('cull_compare_image') + ' ' + file.file.name}
            aria-busy={!size && !error} className="relative flex-1 min-h-0 overflow-auto bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fm-blue"
            style={{ cursor: zoom === 'fit' ? 'zoom-in' : 'grab', touchAction: zoom === 'fit' ? 'auto' : 'none' }}
            onFocus={() => setActiveId(file.id)}
            onClick={event => {
              setActiveId(file.id);
              if (focusMode && size && !busy && onFocusRegion) {
                const point = imagePoint(file.id, event.clientX, event.clientY);
                if (point) {
                  const width = Math.min(focusSize, size.width) / size.width, height = Math.min(focusSize, size.height) / size.height;
                  onFocusRegion(file.id, { x: Math.max(0, Math.min(1 - width, point.x - width / 2)), y: Math.max(0, Math.min(1 - height, point.y - height / 2)), width, height });
                }
              } else if (!focusMode && zoom === 'fit' && size) changeZoom(1, file.id, imagePoint(file.id, event.clientX, event.clientY));
            }}
            onPointerDown={event => {
              setActiveId(file.id);
              if (focusMode || zoom === 'fit' || event.button !== 0) return;
              const area = event.currentTarget;
              drag.current = { id: file.id, x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop };
              area.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const start = drag.current;
              if (!start || start.id !== file.id) return;
              event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
              event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
            }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            {urls[file.id] && !error && <div style={{ position: zoom === 'fit' ? 'absolute' : 'relative', inset: zoom === 'fit' ? 0 : undefined,
              width: pixels?.width ?? '100%', height: pixels?.height ?? '100%', minWidth: '100%', minHeight: '100%', display: 'grid', placeItems: 'center' }}>
              <img src={urls[file.id]} alt={tr('cull_compare_image') + ' ' + file.file.name} draggable={false}
                style={{ position: zoom === 'fit' ? 'absolute' : undefined, inset: zoom === 'fit' ? 0 : undefined,
                  width: pixels?.width ?? '100%', height: pixels?.height ?? '100%', minWidth: 0, minHeight: 0, maxWidth: 'none', maxHeight: 'none', objectFit: 'contain' }}
                onLoad={event => {
                  const image = event.currentTarget;
                  setSizes(previous => ({ ...previous, [file.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
                }} onError={() => setErrors(previous => [...previous, file.id])} />
              {focus && size && <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute" style={{ width: pixels?.width ?? '100%', height: pixels?.height ?? '100%', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} aria-hidden>
                <rect x={focus.x * size.width} y={focus.y * size.height} width={focus.width * size.width} height={focus.height * size.height} fill="#35df9515" stroke="#35df95" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>}
            </div>}
            {(!size || error) && <p role={error ? 'alert' : 'status'} className="absolute inset-0 grid place-items-center p-4 text-sm text-gray-400 pointer-events-none">{tr(error ? 'cull_compare_error' : 'cull_compare_loading')}</p>}
          </div>
          <div className="p-2 bg-elevated flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">{tr(file.cullingSource === 'embedded-jpeg-preview' ? 'cull_source_raw_preview' : 'cull_source_image')}</span>
            <div className="flex gap-1">
              {DECISIONS.map(value => <button key={value} onClick={() => { setActiveId(file.id); onDecision(file.id, value); }}
                aria-pressed={results.get(file.id)?.manualDecision === value} disabled={busy || !results.has(file.id)}
                className={`rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${decision === value ? 'border-fm-blue text-white bg-fm-blue/20' : 'border-border-subtle text-gray-400'}`}>
                {LETTERS[value]} · {tr('cull_decision_' + value)}
              </button>)}
            </div>
          </div>
        </section>;
      })}
    </div>
    <footer className="border-t border-border-subtle p-2 text-[11px] text-gray-400">{focusMode ? tr('cull_focus_hint') : tr('cull_compare_footer')}{busy ? ' · ' + tr('cull_focus_measuring') : ''}</footer>
  </dialog>;
}
