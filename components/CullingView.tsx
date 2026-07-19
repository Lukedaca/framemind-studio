import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { UploadedFile, CullingResult, CullingGenre, CullingDecision, BatchGenreInfo } from '../types';
import { detectBatchGenre, getCullingVerdict } from '../services/geminiService';
import {
  GENRE_PROFILES,
  CULLING_GENRES,
  analyzePhotoPixels,
  buildCullingResult,
  rescoreCullingResult,
  computeSimilarityGroups,
  getEffectiveDecision,
  mapWithConcurrency,
  type PhotoAnalysis,
} from '../utils/cullingEngine';
import { SparklesIcon, StackIcon, XCircleIcon } from './icons';
import Aperture from './common/Aperture';
import Header from './Header';
import { useTranslation } from '../contexts/LanguageContext';

interface CullingViewProps {
  files: UploadedFile[];
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  title: string;
  onOpenApiKeyModal: () => void;
  onToggleSidebar: () => void;
  onDone?: () => void;
}

type Phase = 'idle' | 'heuristics' | 'genre' | 'ai' | 'done';
type Filter = 'all' | CullingDecision;

const AI_CONCURRENCY = 3;
const DECODE_CONCURRENCY = 3;

const DECISION_STYLE: Record<CullingDecision, { chip: string; label: string; ring: string }> = {
  keep: { chip: 'bg-fm-green/90 text-black', label: 'K', ring: 'ring-fm-green' },
  review: { chip: 'bg-fm-blue/90 text-white', label: 'R', ring: 'ring-fm-blue' },
  reject: { chip: 'bg-fm-red/90 text-white', label: 'X', ring: 'ring-fm-red' },
};

const CullingView: React.FC<CullingViewProps> = ({
  files, onSetFiles, addNotification, title, onOpenApiKeyModal, onToggleSidebar, onDone,
}) => {
  const { t } = useTranslation();
  const tr = (key: string) => (t as unknown as Record<string, string>)[key] ?? key;

  // Živý stav běhu drží lokální mapa; do App history se commitne jen v milnících.
  const [cullingMap, setCullingMap] = useState<Map<string, CullingResult>>(() => {
    const map = new Map<string, CullingResult>();
    for (const file of files) {
      if (file.culling) map.set(file.id, file.culling);
    }
    return map;
  });

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [genreInfo, setGenreInfo] = useState<BatchGenreInfo | null>(null);
  const [brief, setBrief] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [collapseSeries, setCollapseSeries] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const cancelRef = useRef(false);
  const mapRef = useRef(cullingMap);
  mapRef.current = cullingMap;
  const genreRef = useRef<BatchGenreInfo | null>(null);
  genreRef.current = genreInfo;

  const isRunning = phase === 'heuristics' || phase === 'genre' || phase === 'ai';

  const commitToFiles = useCallback((map: Map<string, CullingResult>, actionName: string) => {
    onSetFiles(prev => prev.map(file => {
      const result = map.get(file.id);
      if (!result) return file;
      const decision = result.manualDecision || result.decision;
      return {
        ...file,
        culling: result,
        assessment: {
          score: result.ai?.aiScore ?? result.finalScore,
          isBestPick: decision === 'keep' && (result.isBestInGroup ?? true),
          flags: result.risks,
        },
      };
    }), actionName);
  }, [onSetFiles]);

  const updateResult = useCallback((id: string, patch: Partial<CullingResult>) => {
    setCullingMap(prev => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) next.set(id, { ...current, ...patch });
      return next;
    });
  }, []);

  // --- Hlavní běh cullingu ---

  const runCulling = async () => {
    if (files.length === 0 || isRunning) return;
    cancelRef.current = false;

    // Fáze 1: lokální heuristiky (zdarma, bez API) — ostrost, expozice, šum,
    // kompozice, perceptual hash pro série. Worker drží UI plynulé.
    setPhase('heuristics');
    setProgress({ current: 0, total: files.length });
    const analyses = new Map<string, PhotoAnalysis>();
    const workMap = new Map<string, CullingResult>();
    let failed = 0;

    await mapWithConcurrency(files, DECODE_CONCURRENCY, async (file) => {
      if (cancelRef.current) return;
      try {
        const analysis = await analyzePhotoPixels(file.file);
        analyses.set(file.id, analysis);
        workMap.set(file.id, buildCullingResult(analysis, genreRef.current?.genre ?? null));
      } catch (error) {
        console.error(`Culling analysis failed for ${file.file.name}:`, error);
        failed += 1;
      }
      setProgress(prev => ({ ...prev, current: prev.current + 1 }));
      setCullingMap(new Map(workMap));
    });

    if (cancelRef.current) { finishRun(workMap); return; }

    // Série: union-find nad hashi, reprezentant = nejvyšší skóre.
    applySimilarity(workMap);
    setCullingMap(new Map(workMap));
    commitToFiles(workMap, 'AI Culling – heuristika');

    // Fáze 2: žánr sady — 3 náhledy, jeden Gemini dotaz. Manuální volba má přednost.
    if (!genreRef.current?.manual) {
      setPhase('genre');
      try {
        const thumbs = files.map(f => analyses.get(f.id)?.aiThumbnailDataUrl).filter((x): x is string => !!x).slice(0, 3);
        if (thumbs.length > 0) {
          const detected = await detectBatchGenre(thumbs);
          const info: BatchGenreInfo = { ...detected, manual: false };
          setGenreInfo(info);
          rescoreAll(workMap, info.genre);
          setCullingMap(new Map(workMap));
        }
      } catch (error) {
        console.warn('Genre detection failed:', error);
        addNotification(tr('cull_genre_failed'), 'error');
      }
    }

    if (cancelRef.current) { finishRun(workMap); return; }

    // Fáze 3: AI verdikty. Jisté rejecty přeskakujeme — heuristika už rozhodla,
    // Gemini volání by jen pálilo kvótu (stejná optimalizace jako FrameMind Agent).
    setPhase('ai');
    const candidates = files.filter(f => {
      const result = workMap.get(f.id);
      return result && result.decision !== 'reject' && analyses.has(f.id);
    });
    // Kandidáti dostanou pending — na kartě se zapne scan-line „AI se dívá".
    for (const file of candidates) {
      const result = workMap.get(file.id)!;
      workMap.set(file.id, { ...result, aiStatus: 'pending' });
    }
    setCullingMap(new Map(workMap));
    setProgress({ current: 0, total: candidates.length });
    let aiFailed = 0;

    await mapWithConcurrency(candidates, AI_CONCURRENCY, async (file) => {
      if (cancelRef.current) return;
      const result = workMap.get(file.id)!;
      const analysis = analyses.get(file.id)!;
      try {
        const verdict = await getCullingVerdict(analysis.aiThumbnailDataUrl, {
          filename: file.file.name,
          metrics: result.metrics,
          heuristicScore: result.finalScore,
          duplicateGroupId: result.duplicateGroupId,
          isBestInGroup: result.isBestInGroup,
          genre: genreRef.current?.genre ?? null,
          brief,
        });
        workMap.set(file.id, {
          ...result,
          ai: verdict,
          aiStatus: 'done',
          decision: verdict.decision,
          genre: verdict.genre,
          reasons: verdict.reasons.length ? verdict.reasons : result.reasons,
          risks: verdict.risks.length ? verdict.risks : result.risks,
        });
      } catch (error) {
        aiFailed += 1;
        workMap.set(file.id, {
          ...result,
          aiStatus: 'error',
          aiError: error instanceof Error ? error.message : String(error),
        });
      }
      setProgress(prev => ({ ...prev, current: prev.current + 1 }));
      setCullingMap(new Map(workMap));
    });

    // AI mohla přehodit verdikty → přepočet reprezentantů sérií podle finálních skóre.
    applySimilarity(workMap);
    finishRun(workMap);

    if (failed > 0) addNotification(`${failed} ${tr('cull_failed_count')}`, 'error');
    if (aiFailed > 0) addNotification(`${aiFailed} ${tr('cull_ai_failed_count')}`, 'error');
    else if (!cancelRef.current) addNotification(tr('cull_complete'), 'info');
  };

  const applySimilarity = (workMap: Map<string, CullingResult>) => {
    const assignments = computeSimilarityGroups(
      Array.from(workMap.entries()).map(([id, r]) => ({
        id, hash: r.metrics.hash, aspectRatio: r.aspectRatio, finalScore: r.finalScore,
      }))
    );
    for (const [id, assignment] of assignments) {
      const current = workMap.get(id);
      if (!current) continue;
      const withGroup = { ...current, ...assignment };
      // AI a ruční verdikty jsou autoritativní; heuristické se s novou skupinou přepočítají.
      workMap.set(id, current.aiStatus === 'done' || current.manualDecision
        ? withGroup
        : rescoreCullingResult(withGroup, genreRef.current?.genre ?? null));
    }
  };

  const rescoreAll = (workMap: Map<string, CullingResult>, genre: CullingGenre) => {
    for (const [id, result] of workMap) {
      workMap.set(id, rescoreCullingResult(result, genre));
    }
    applySimilarity(workMap);
  };

  const finishRun = (workMap: Map<string, CullingResult>) => {
    // Po stopce nesmí zůstat viset pending — scan-line by běžela donekonečna.
    for (const [id, result] of workMap) {
      if (result.aiStatus === 'pending') workMap.set(id, { ...result, aiStatus: 'idle' });
    }
    setCullingMap(new Map(workMap));
    commitToFiles(workMap, 'AI Culling');
    setPhase('done');
  };

  const stopCulling = () => { cancelRef.current = true; };

  // --- Ruční zásahy ---

  const setManualDecision = (id: string, decision: CullingDecision) => {
    const current = mapRef.current.get(id);
    if (!current) return;
    const next = new Map(mapRef.current);
    const toggledOff = current.manualDecision === decision;
    next.set(id, { ...current, manualDecision: toggledOff ? undefined : decision });
    setCullingMap(next);
    commitToFiles(next, tr('cull_manual_decision'));
  };

  const setSeriesWinner = (groupId: string, winnerId: string) => {
    const next = new Map(mapRef.current);
    for (const [id, result] of next) {
      if (result.duplicateGroupId !== groupId) continue;
      next.set(id, {
        ...result,
        manualDecision: id === winnerId ? 'keep' : 'reject',
        isBestInGroup: id === winnerId,
        groupRank: id === winnerId ? 1 : Math.max(2, result.groupRank ?? 2),
      });
    }
    setCullingMap(next);
    commitToFiles(next, tr('cull_series_winner'));
  };

  const handleGenreChange = (value: string) => {
    if (value === 'auto') {
      setGenreInfo(null);
      return;
    }
    const genre = value as CullingGenre;
    const info: BatchGenreInfo = { genre, confidence: 100, note: tr('cull_genre_manual_note'), manual: true };
    setGenreInfo(info);
    if (mapRef.current.size > 0) {
      const next = new Map(mapRef.current);
      rescoreAll(next, genre);
      setCullingMap(next);
      commitToFiles(next, tr('cull_genre_changed'));
    }
  };

  const removeRejects = () => {
    const rejectIds = new Set(
      files.filter(f => getEffectiveDecision(cullingMap.get(f.id)) === 'reject').map(f => f.id)
    );
    if (rejectIds.size === 0) return;
    if (!window.confirm(`${tr('cull_remove_confirm')} (${rejectIds.size})`)) return;
    onSetFiles(prev => prev.filter(f => !rejectIds.has(f.id)), tr('cull_remove_rejects'));
    addNotification(`${rejectIds.size} ${tr('cull_removed_count')}`, 'info');
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
      if (collapseSeries && result?.duplicateGroupId && !result.isBestInGroup && !expandedGroups.has(result.duplicateGroupId)) {
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

  const phaseLabel = phase === 'heuristics' ? tr('cull_phase_heuristics')
    : phase === 'genre' ? tr('cull_phase_genre')
    : phase === 'ai' ? tr('cull_phase_ai')
    : null;

  const translateTag = (tag: string) => tag.startsWith('cull_') ? tr(tag) : tag;

  const renderCard = (file: UploadedFile, inStrip = false) => {
    const result = cullingMap.get(file.id);
    const decision = getEffectiveDecision(result);
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
        <img src={file.previewUrl} className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30 opacity-80" />
        {isRunning && (!result || result.aiStatus === 'pending') && <div className="fm-scanline" />}

        {/* Verdikt + skóre */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          {style && (
            <span className={`${style.chip} w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg`}>
              {style.label}
            </span>
          )}
          {result?.manualDecision && (
            <span className="bg-white/15 backdrop-blur text-white text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full">
              {tr('cull_manual_tag')}
            </span>
          )}
        </div>
        {result && (
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded">
            {result.ai?.aiScore ?? result.finalScore}
          </div>
        )}

        {/* Rychlé verdikty na hover */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center gap-2">
          {(['keep', 'review', 'reject'] as CullingDecision[]).map(d => (
            <button
              key={d}
              onClick={(e) => { e.stopPropagation(); setManualDecision(file.id, d); }}
              className={`${DECISION_STYLE[d].chip} w-8 h-8 rounded-full text-xs font-black shadow-xl hover:scale-110 transition-transform`}
              title={tr(`cull_decision_${d}`)}
            >
              {DECISION_STYLE[d].label}
            </button>
          ))}
        </div>

        {/* Patka: název + AI shrnutí + rizika */}
        <div className="absolute bottom-0 inset-x-0 p-2.5">
          <p className="text-[9px] text-gray-300 truncate font-mono">{file.file.name}</p>
          {result?.ai?.summary && !inStrip && (
            <p className="text-[10px] text-gray-200 leading-snug line-clamp-2 mt-0.5">{result.ai.summary}</p>
          )}
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
            className="absolute bottom-2 right-2 bg-fm-blue/90 text-white text-[9px] font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg hover:bg-fm-blue"
          >
            <StackIcon className="w-3 h-3" />
            {expandedGroups.has(result!.duplicateGroupId!) ? '−' : `+${groupSize - 1}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-void text-white overflow-hidden">
      <Header title={title} onToggleSidebar={onToggleSidebar} onOpenApiKeyModal={onOpenApiKeyModal} />

      <div className="flex-1 flex overflow-hidden">
        {/* LEVÝ PANEL */}
        <div className="w-80 flex-shrink-0 bg-surface border-r border-border-subtle p-5 flex flex-col gap-5 overflow-y-auto custom-scrollbar z-10">

          <div className="glass-panel p-4 rounded-2xl">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
              <Aperture className="w-4 h-4" />
              {tr('cull_title')}
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">{tr('cull_desc')}</p>
          </div>

          {/* Žánr */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">{tr('cull_genre')}</label>
            <select
              value={genreInfo?.manual ? genreInfo.genre : 'auto'}
              onChange={(e) => handleGenreChange(e.target.value)}
              className="w-full bg-elevated border border-border-subtle rounded-xl px-3 py-2.5 text-xs text-white focus:border-fm-blue focus:outline-none"
            >
              <option value="auto">{tr('cull_genre_auto')}</option>
              {CULLING_GENRES.map(g => (
                <option key={g} value={g}>{GENRE_PROFILES[g].label}</option>
              ))}
            </select>
            {genreInfo && !genreInfo.manual && (
              <p className="text-[10px] text-gray-400 pl-1 leading-relaxed">
                <span className="text-fm-green font-bold">{GENRE_PROFILES[genreInfo.genre].label}</span>
                {' '}({genreInfo.confidence} %) — {genreInfo.note}
              </p>
            )}
          </div>

          {/* Brief */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">{tr('cull_brief')}</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={tr('cull_brief_placeholder')}
              className="w-full bg-elevated border border-border-subtle rounded-xl px-3 py-2.5 text-xs text-white placeholder-gray-600 resize-none focus:border-fm-blue focus:outline-none"
            />
          </div>

          {/* Spuštění */}
          {!isRunning ? (
            <button
              onClick={runCulling}
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

          {/* Filtry + série */}
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-1.5">
              {(['all', 'keep', 'review', 'reject'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`py-1.5 rounded-lg text-[9px] font-bold uppercase transition-colors ${
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
            <p className="text-[9px] text-gray-600 text-center font-mono">{tr('cull_keyboard_hint')}</p>
            {counts.reject > 0 && (
              <button
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
        <div className="flex-1 bg-void p-6 overflow-y-auto custom-scrollbar">
          {files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
              <StackIcon className="w-10 h-10 opacity-40" />
              <p className="text-sm">{tr('cull_empty')}</p>
            </div>
          ) : (
            <div className="max-w-7xl mx-auto space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
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
                    <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-6 gap-2">
                      {members.map(member => (
                        <div key={member.id} className="space-y-1.5">
                          {renderCard(member, true)}
                          <button
                            onClick={() => setSeriesWinner(groupId, member.id)}
                            className={`w-full py-1 rounded-lg text-[9px] font-bold uppercase transition-colors ${
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
