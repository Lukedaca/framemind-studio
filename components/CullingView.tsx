import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { UploadedFile, CullingResult, CullingGenre, CullingDecision, CullingVerdictSource } from '../types';
import { CULLING_GENRES, CULLING_ENGINE_VERSION, rescoreCullingResult, getEffectiveDecision, getVerdictSource } from '../utils/cullingEngine';
import { CullingSession } from '../services/cullingSession';
import { SparklesIcon, StackIcon, XCircleIcon } from './icons';
import Aperture from './common/Aperture';
import Header from './Header';
import { useTranslation } from '../contexts/LanguageContext';

interface CullingViewProps {
  files: UploadedFile[];
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  title: string;
  onToggleSidebar: () => void;
  onDone?: () => void;
}
type Phase = 'idle' | 'analyzing' | 'grouping' | 'done';
type Filter = 'all' | CullingDecision;
const DECISION_STYLE: Record<CullingDecision, { chip: string; label: string; ring: string }> = {
  keep: { chip: 'bg-fm-green/90 text-black', label: 'K', ring: 'ring-fm-green' },
  review: { chip: 'bg-fm-blue/90 text-white', label: 'R', ring: 'ring-fm-blue' },
  reject: { chip: 'bg-fm-red/90 text-white', label: 'X', ring: 'ring-fm-red' },
};
const SOURCE_STYLE: Record<CullingVerdictSource, string> = {
  manual: 'bg-white/15 backdrop-blur text-white',
  technical: 'bg-fm-blue/25 text-fm-blue border border-fm-blue/40',
  legacy: 'bg-black/50 text-gray-300 border border-white/10',
};
const storedMap = (files: UploadedFile[]) => new Map(files.filter(f => f.culling).map((f): [string, CullingResult] => {
  const result = f.culling!;
  if (result.engineVersion === CULLING_ENGINE_VERSION) return [f.id, result];
  // Old automatic analysis cannot hide files or retain obsolete AI risk labels.
  return [f.id, { ...result, decision: 'review' as const, finalScore: 0,
    duplicateGroupId: undefined, isBestInGroup: undefined, groupRank: undefined, groupKind: undefined,
    scoreBreakdown: undefined, reasons: ['cull_reason_reanalyze'], risks: [] }];
}));

const CullingView: React.FC<CullingViewProps> = ({ files, onSetFiles, addNotification, title, onToggleSidebar, onDone }) => {
  const { t } = useTranslation();
  const tr = (key: string) => (t as unknown as Record<string, string>)[key] ?? key;
  const [cullingMap, setCullingMap] = useState(() => storedMap(files));
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [genre, setGenre] = useState<CullingGenre>(() => files.find(f => f.culling?.genre)?.culling?.genre ?? 'other');
  const [filter, setFilter] = useState<Filter>('all');
  const [collapseSeries, setCollapseSeries] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const sessionRef = useRef<CullingSession | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const sourceFilesRef = useRef(files);
  const mapRef = useRef(cullingMap);
  mapRef.current = cullingMap;
  const isRunning = phase === 'analyzing' || phase === 'grouping';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; sessionRef.current?.close(); sessionRef.current = null; };
  }, []);
  // A changed project/Undo cancels a stale run before it can commit.
  useEffect(() => {
    if (sourceFilesRef.current !== files && sessionRef.current) {
      sessionRef.current.close(); sessionRef.current = null; setPhase('idle');
    }
    sourceFilesRef.current = files;
    if (!sessionRef.current) setCullingMap(storedMap(files));
  }, [files]);

  const commitToFiles = useCallback((map: Map<string, CullingResult>, actionName: string) => {
    onSetFiles(prev => prev.map(file => {
      const result = map.get(file.id);
      if (!result) return file;
      return { ...file, culling: result, assessment: {
        score: result.engineVersion === CULLING_ENGINE_VERSION ? result.finalScore : 0,
        isBestPick: getEffectiveDecision(result) === 'keep' && (result.isBestInGroup ?? true), flags: result.risks,
      } };
    }), actionName);
  }, [onSetFiles]);

  const applySimilarity = async (workMap: Map<string, CullingResult>, session: CullingSession, selectedGenre: CullingGenre) => {
    const assignments = await session.group(files.flatMap(file => {
      const r = workMap.get(file.id);
      return r?.engineVersion === CULLING_ENGINE_VERSION && r.analysisStatus === 'done' ? [{
        id: file.id, filename: file.file.name, signature: r.metrics.signature, aspectRatio: r.aspectRatio,
        finalScore: r.finalScore, sharpness: r.metrics.technical?.laplacianVariance ?? 0, exif: r.exif,
      }] : [];
    }));
    for (const [id, result] of workMap) {
      if (result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus !== 'done') continue;
      const { duplicateGroupId, isBestInGroup, groupRank, groupKind, similarityToBest, relativeSharpness, scoreGap, ...base } = result;
      workMap.set(id, rescoreCullingResult({ ...base, ...assignments.get(id) }, selectedGenre));
    }
  };

  const runCulling = async (selectedGenre: CullingGenre = genre, rescoreOnly = false) => {
    if (!files.length || sessionRef.current) return;
    let session: CullingSession;
    try { session = new CullingSession(); } catch { addNotification(tr('cull_worker_unavailable'), 'error'); return; }
    sessionRef.current = session; cancelledRef.current = false;
    const workMap = new Map(mapRef.current);
    let failed = 0, runFailed = false;
    setPhase(rescoreOnly ? 'grouping' : 'analyzing'); setProgress({ current: 0, total: files.length });
    try {
      if (!rescoreOnly) {
        for (let index = 0; index < files.length; index += 1) {
          if (cancelledRef.current) break;
          const file = files[index];
          try {
            const analysis = await session.analyze(file);
            const result = await session.score(analysis, selectedGenre);
            workMap.set(file.id, { ...result, manualDecision: workMap.get(file.id)?.manualDecision });
          } catch (error) {
            if ((error as Error).name === 'AbortError' || cancelledRef.current) throw error;
            failed += 1;
            workMap.set(file.id, {
              metrics: { hash: '', meanLuma: 0, sharpnessScore: 0, exposureScore: 0, highlightClipping: 0,
                shadowClipping: 0, contrastScore: 0, noiseScore: 0, compositionScore: 0, nativeSharpness: 0 },
              finalScore: 0, decision: 'review', manualDecision: workMap.get(file.id)?.manualDecision,
              reasons: ['cull_reason_unreadable'], risks: ['cull_risk_unreadable'], aspectRatio: 1,
              engineVersion: CULLING_ENGINE_VERSION, analysisStatus: 'error', source: file.cullingSource ?? 'image',
            });
          }
          if (sessionRef.current !== session) return;
          setProgress({ current: index + 1, total: files.length }); setCullingMap(new Map(workMap));
        }
      } else {
        for (const [id, result] of workMap) workMap.set(id, rescoreCullingResult(result, selectedGenre));
      }
      if (!cancelledRef.current && sessionRef.current === session) { setPhase('grouping'); await applySimilarity(workMap, session, selectedGenre); }
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && !cancelledRef.current) { runFailed = true; addNotification(tr('cull_worker_failed'), 'error'); }
    } finally {
      session.close();
      if (mountedRef.current && sessionRef.current === session) {
        sessionRef.current = null; setCullingMap(new Map(workMap)); setPhase('done');
        commitToFiles(workMap, tr('cull_history'));
        if (failed) addNotification(failed + ' ' + tr('cull_failed_count'), 'error');
        if (!runFailed) addNotification(cancelledRef.current ? tr('cull_stopped') : tr('cull_complete'), 'info');
      }
    }
  };
  const stopCulling = () => { cancelledRef.current = true; sessionRef.current?.close(); };
  const setManualDecision = (id: string, decision: CullingDecision) => {
    if (sessionRef.current) return;
    const next = new Map(mapRef.current), current = next.get(id);
    if (!current) return;
    next.set(id, { ...current, manualDecision: current.manualDecision === decision ? undefined : decision });
    setCullingMap(next); commitToFiles(next, tr('cull_manual_decision'));
  };
  const setSeriesWinner = (groupId: string, winnerId: string) => {
    if (sessionRef.current) return;
    const next = new Map(mapRef.current);
    for (const [id, r] of next) {
      if (r.duplicateGroupId === groupId) next.set(id, { ...r, manualDecision: id === winnerId ? 'keep' : r.manualDecision,
        isBestInGroup: id === winnerId, groupRank: id === winnerId ? 1 : Math.max(2, r.groupRank ?? 2) });
    }
    setCullingMap(next); commitToFiles(next, tr('cull_series_winner'));
  };
  const handleGenreChange = (value: string) => {
    const nextGenre = value as CullingGenre; setGenre(nextGenre);
    if (mapRef.current.size) void runCulling(nextGenre, true);
  };
  const removeRejects = () => {
    if (sessionRef.current) return;
    const rejects = files.filter(f => getEffectiveDecision(cullingMap.get(f.id)) === 'reject');
    if (!rejects.length || !window.confirm(tr('cull_remove_confirm') + ' (' + rejects.length + ')\n' + tr('cull_remove_undo_hint'))) return;
    const ids = new Set(rejects.map(f => f.id));
    onSetFiles(prev => prev.filter(f => !ids.has(f.id)), tr('cull_remove_rejects'));
    addNotification(ids.size + ' ' + tr('cull_removed_count'), 'info');
  };

  // --- Odvozené pohledy ---

  const counts = useMemo(() => {
    const c = { keep: 0, review: 0, reject: 0, none: 0 };
    for (const file of files) {
      const decision = getEffectiveDecision(cullingMap.get(file.id));
      if (decision) c[decision] += 1;
      else c.none += 1;
    }
    return c;
  }, [files, cullingMap]);

  const scored = files.length - counts.none;

  const visibleFiles = useMemo(() => {
    return files.filter(file => {
      const result = cullingMap.get(file.id);
      const decision = getEffectiveDecision(result);
      if (filter !== 'all' && decision !== filter) return false;
      if (filter === 'all' && collapseSeries && result?.duplicateGroupId && !result.isBestInGroup && !expandedGroups.has(result.duplicateGroupId)) {
        return false;
      }
      return true;
    });
  }, [files, cullingMap, filter, collapseSeries, expandedGroups]);

  const groupMembers = useCallback((groupId: string) =>
    files.filter(f => cullingMap.get(f.id)?.duplicateGroupId === groupId), [files, cullingMap]);

  // Klávesy jako v profi cullingu: šipky = fokus, K/R/X = verdikt.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (sessionRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;

      const ids = visibleFiles.map(f => f.id);
      if (ids.length === 0) return;
      const currentIndex = focusedId ? ids.indexOf(focusedId) : -1;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedId(ids[Math.min(ids.length - 1, currentIndex + 1)] ?? ids[0]);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedId(ids[Math.max(0, currentIndex - 1)] ?? ids[0]);
      } else if (focusedId) {
        const key = event.key.toLowerCase();
        const decision: CullingDecision | null = key === 'k' ? 'keep' : key === 'r' ? 'review' : key === 'x' ? 'reject' : null;
        if (decision) {
          event.preventDefault();
          setManualDecision(focusedId, decision);
          const nextId = ids[Math.min(ids.length - 1, Math.max(0, currentIndex) + 1)];
          if (nextId) setFocusedId(nextId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleFiles, focusedId]);

  const phaseLabel = phase === 'analyzing' ? tr('cull_phase_local') : phase === 'grouping' ? tr('cull_phase_grouping') : null;

  const translateTag = (tag: string) => tag.startsWith('cull_') ? tr(tag) : tag;

  const renderCard = (file: UploadedFile, inStrip = false) => {
    const result = cullingMap.get(file.id);
    const decision = getEffectiveDecision(result);
    const source = getVerdictSource(result);
    const style = decision ? DECISION_STYLE[decision] : null;
    const isFocused = focusedId === file.id;
    const isRepresentative = !inStrip && result?.duplicateGroupId && result.isBestInGroup;
    const groupSize = isRepresentative ? groupMembers(result!.duplicateGroupId!).length : 0;

    return (
      <div
        key={inStrip ? `strip-${file.id}` : file.id}
        className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 bg-elevated
          ${inStrip ? 'aspect-square' : 'aspect-[3/4]'}
          ${isFocused ? `ring-2 ${style?.ring ?? 'ring-fm-blue'} shadow-lg` : 'hover:ring-1 hover:ring-gray-600'}`}
        onClick={() => setFocusedId(file.id)}
      >
        <img src={file.previewUrl} className="w-full h-full object-cover" loading="lazy" alt={file.file.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30 opacity-80" />
        {isRunning && !result && <div className="fm-scanline" />}

        {/* Verdikt + skóre */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          {style && (
            <span className={`${style.chip} w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shadow-lg`}>
              {style.label}
            </span>
          )}
          {source && (
            <span className={`${SOURCE_STYLE[source]} text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full`}>
              {tr(`cull_source_${source}`)}
            </span>
          )}
        </div>
        {result && (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            <span className="bg-black/60 backdrop-blur text-white text-[11px] font-mono font-bold px-1.5 py-0.5 rounded">
              {result.engineVersion === CULLING_ENGINE_VERSION ? result.finalScore : '—'}
            </span>
          </div>
        )}

        {/* Rychlé verdikty na hover */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center gap-2">
          {(['keep', 'review', 'reject'] as CullingDecision[]).map(d => (
            <button
              key={d}
              disabled={isRunning}
              onClick={(e) => { e.stopPropagation(); setManualDecision(file.id, d); }}
              className={`${DECISION_STYLE[d].chip} w-8 h-8 rounded-full text-xs font-black shadow-xl hover:scale-110 transition-transform`}
              title={tr(`cull_decision_${d}`)}
            >
              {DECISION_STYLE[d].label}
            </button>
          ))}
        </div>

        {/* Patka: název + technické důvody + rizika */}
        <div className="absolute bottom-0 inset-x-0 p-2.5">
          <p className="text-[11px] text-gray-300 truncate font-mono">{file.file.name}</p>
          {result && !inStrip && <p className="text-[11px] text-gray-200 leading-snug line-clamp-2 mt-0.5">
            {result.engineVersion === CULLING_ENGINE_VERSION ? result.reasons.map(translateTag).join(' · ') : tr('cull_reason_reanalyze')}
          </p>}
          {result && result.risks.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {result.risks.slice(0, 2).map((risk, i) => (
                <span key={i} className="bg-fm-red/20 text-fm-red text-[8px] font-semibold px-1.5 py-0.5 rounded-full border border-fm-red/30">
                  {translateTag(risk)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Expander série */}
        {isRepresentative && groupSize > 1 && collapseSeries && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedGroups(prev => {
                const next = new Set(prev);
                if (next.has(result!.duplicateGroupId!)) next.delete(result!.duplicateGroupId!);
                else next.add(result!.duplicateGroupId!);
                return next;
              });
            }}
            className="absolute bottom-2 right-2 bg-fm-blue/90 text-white text-[11px] font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg hover:bg-fm-blue"
          >
            <StackIcon className="w-3 h-3" />
            {expandedGroups.has(result!.duplicateGroupId!) ? '−' : `+${groupSize - 1}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col text-white overflow-hidden">
      <Header title={title} onToggleSidebar={onToggleSidebar} />

      <div className="flex-1 flex overflow-hidden">
        {/* LEVÝ PANEL */}
        <div className="w-80 flex-shrink-0 bg-surface/70 backdrop-blur-xl border-r border-border-subtle p-5 flex flex-col gap-5 overflow-y-auto custom-scrollbar z-10">

          <div className="glass-panel p-4 rounded-2xl">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
              <Aperture className="w-4 h-4" />
              {tr('cull_title')}
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">{tr('cull_desc')}</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="culling-genre" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{tr('cull_genre')}</label>
            <select id="culling-genre" value={genre} disabled={isRunning} onChange={e => handleGenreChange(e.target.value)}
              className="w-full bg-elevated border border-border-subtle rounded-xl px-3 py-2.5 text-xs text-white focus:border-fm-blue focus:outline-none">
              {CULLING_GENRES.map(g => <option key={g} value={g}>{tr('cull_genre_' + g)}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 leading-relaxed">{tr('cull_genre_hint')}</p>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed border border-border-subtle rounded-xl p-3">{tr('cull_limits')}</p>

          {/* Spuštění */}
          {!isRunning ? (
            <button
              onClick={() => void runCulling()}
              disabled={files.length === 0}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-fm-magenta via-fm-blue to-fm-green text-white text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_20px_rgba(47,111,224,0.45)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SparklesIcon className="w-4 h-4" />
              {scored > 0 ? tr('cull_run_again') : tr('cull_run')}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-gray-300">
                  <Aperture className="w-4 h-4" spinning />
                  {phaseLabel}
                </span>
                <span className="text-gray-500 font-mono">{progress.current}/{progress.total}</span>
              </div>
              <div className="w-full bg-elevated h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-fm-magenta via-fm-blue to-fm-green transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
              <button
                onClick={stopCulling}
                className="w-full py-2 rounded-xl bg-elevated border border-border-subtle hover:border-fm-red hover:text-fm-red text-xs text-gray-300 font-bold uppercase flex items-center justify-center gap-2"
              >
                <XCircleIcon className="w-4 h-4" /> {tr('cull_stop')}
              </button>
            </div>
          )}

          {/* Statistika */}
          {scored > 0 && (
            <div className="glass-panel rounded-2xl p-4 space-y-2.5">
              {(['keep', 'review', 'reject'] as CullingDecision[]).map(d => (
                <div key={d} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-gray-300">
                    <span className={`w-2 h-2 rounded-full ${d === 'keep' ? 'bg-fm-green' : d === 'review' ? 'bg-fm-blue' : 'bg-fm-red'}`} />
                    {tr(`cull_decision_${d}`)}
                  </span>
                  <span className="font-mono text-white">
                    {counts[d]}
                    <span className="text-gray-500 ml-1.5">{scored ? Math.round((counts[d] / scored) * 100) : 0} %</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {focusedId && cullingMap.get(focusedId) && (() => {
            const result = cullingMap.get(focusedId)!;
            const technical = result.engineVersion === CULLING_ENGINE_VERSION ? result.metrics.technical : undefined;
            return <div className="glass-panel rounded-2xl p-4 space-y-3" data-testid="culling-detail">
              <h3 className="text-xs font-bold">{tr('cull_detail_title')}</h3>
              <p className="text-[11px] text-gray-400">{tr(result.source === 'embedded-jpeg-preview' ? 'cull_source_raw_preview' : 'cull_source_image')}</p>
              {technical && <dl className="text-[11px] space-y-1">
                {[[tr('cull_metric_preview'), technical.width + ' × ' + technical.height],
                  [tr('cull_metric_detail'), String(Math.round(technical.laplacianVariance))],
                  [tr('cull_metric_range'), technical.p5 + ' – ' + technical.p95],
                  [tr('cull_metric_highlights'), (result.metrics.highlightClipping * 100).toFixed(1) + ' %'],
                  [tr('cull_metric_shadows'), (result.metrics.shadowClipping * 100).toFixed(1) + ' %'],
                  [tr('cull_metric_noise'), technical.noiseEstimate.toFixed(1) + ' / 255'],
                  [tr('cull_metric_evidence'), Math.round(technical.detailConfidence * 100) + ' / 100'],
                ].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-gray-400">{label}</dt><dd className="font-mono">{value}</dd></div>)}
              </dl>}
              {result.scoreBreakdown && <dl className="text-[11px] space-y-1">
                {Object.entries(result.scoreBreakdown).map(([part, value]) => <div key={part} className="flex justify-between gap-2">
                  <dt className="text-gray-400">{tr('cull_part_' + part)}</dt><dd className="font-mono">{value.contribution.toFixed(1)} / {Math.round(value.weight * 100)}</dd>
                </div>)}
              </dl>}
              <p className="text-[11px] text-gray-400">{tr('cull_score_hint')}</p>
              {result.exif && <p className="text-[11px] text-gray-400 font-mono">
                {result.exif.iso ? 'ISO ' + result.exif.iso + ' · ' : ''}{result.exif.aperture ? 'f/' + result.exif.aperture + ' · ' : ''}
                {result.exif.exposureTime ? result.exif.exposureTime.toFixed(4) + ' s' : ''}
              </p>}
            </div>;
          })()}

          {/* Filtry + série */}
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-1.5">
              {(['all', 'keep', 'review', 'reject'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`py-1.5 rounded-lg text-[11px] font-bold uppercase transition-colors ${
                    filter === f ? 'bg-white/10 text-white border border-white/20' : 'bg-elevated text-gray-500 border border-transparent hover:text-gray-300'
                  }`}
                >
                  {f === 'all' ? tr('cull_filter_all') : tr(`cull_decision_${f}`)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pl-1">
              <input
                type="checkbox"
                checked={collapseSeries}
                onChange={(e) => setCollapseSeries(e.target.checked)}
                className="accent-fm-blue"
              />
              {tr('cull_collapse_series')}
            </label>
          </div>

          {/* Akce */}
          <div className="mt-auto space-y-2 pt-2">
            <p className="text-[11px] text-gray-600 text-center font-mono">{tr('cull_keyboard_hint')}</p>
            {counts.reject > 0 && (
              <button
                disabled={isRunning}
                onClick={removeRejects}
                className="w-full py-2.5 rounded-xl bg-elevated border border-border-subtle hover:border-fm-red hover:text-fm-red text-xs text-gray-300 font-bold uppercase"
              >
                {tr('cull_remove_rejects')} ({counts.reject})
              </button>
            )}
            {onDone && (
              <button
                onClick={onDone}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-wide hover:bg-gray-200 transition-colors"
              >
                {tr('cull_continue_editor')}
              </button>
            )}
          </div>
        </div>

        {/* GRID */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          {files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
              <StackIcon className="w-10 h-10 opacity-40" />
              <p className="text-sm">{tr('cull_empty')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="fm-grid-photos">
                {visibleFiles.map(file => renderCard(file))}
              </div>

              {/* Rozbalené série */}
              {Array.from(expandedGroups).map(groupId => {
                const members = groupMembers(groupId);
                if (members.length < 2) return null;
                return (
                  <div key={groupId} className="glass-panel rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-fm-blue flex items-center gap-1.5">
                        <StackIcon className="w-3.5 h-3.5" /> {tr('cull_series')} ({members.length})
                      </span>
                      <button
                        onClick={() => setExpandedGroups(prev => { const n = new Set(prev); n.delete(groupId); return n; })}
                        className="text-gray-500 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="fm-grid-thumbs">
                      {members.map(member => (
                        <div key={member.id} className="space-y-1.5">
                          {renderCard(member, true)}
                          <button
                            disabled={isRunning}
                            onClick={() => setSeriesWinner(groupId, member.id)}
                            className={`w-full py-1 rounded-lg text-[11px] font-bold uppercase transition-colors ${
                              cullingMap.get(member.id)?.isBestInGroup
                                ? 'bg-fm-green/20 text-fm-green border border-fm-green/40'
                                : 'bg-elevated text-gray-400 border border-border-subtle hover:text-white'
                            }`}
                          >
                            {cullingMap.get(member.id)?.isBestInGroup ? tr('cull_winner') : tr('cull_pick_winner')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CullingView;
