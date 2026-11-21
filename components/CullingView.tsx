import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { UploadedFile, CullingResult, CullingGenre, CullingDecision, CullingVerdictSource, CullingIntent, CullingFocusRegion, CullingOutputTarget, CullingStrictnessLevel, CullingStrictnessMode } from '../types';
import { CULLING_GENRES, CULLING_INTENTS, CULLING_ENGINE_VERSION, CULLING_STRICTNESS_MODES, recommendCullingStrictness, rescoreCullingResult, getEffectiveDecision, getVerdictSource } from '../utils/cullingEngine';
import { CULLING_TARGETS, opticsVerdict, outputScale, reliableOptics, OUTPUT_SHARP, OUTPUT_SOFT } from '../utils/cullingOptics';
import { CullingSession } from '../services/cullingSession';
import { SparklesIcon, StackIcon, XCircleIcon } from './icons';
import Aperture from './common/Aperture';
import Header from './Header';
import { confirmAction } from '../utils/confirmAction';
import { useTranslation } from '../contexts/LanguageContext';
import CullingCompare from './CullingCompare';
import CullingFocus, { formatExifStrip, type FocusFilter } from './CullingFocus';

interface CullingViewProps {
  files: UploadedFile[];
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  title: string;
  onToggleSidebar: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onDone?: () => void;
}
type Phase = 'idle' | 'analyzing' | 'grouping' | 'done';
type Filter = 'all' | CullingDecision;
const DECISION_STYLE: Record<CullingDecision, { chip: string; label: string; ring: string }> = {
  keep: { chip: 'bg-fm-green/90 text-black', label: 'K', ring: 'ring-fm-green' },
  review: { chip: 'bg-amber-400 text-black', label: 'R', ring: 'ring-amber-400' },
  reject: { chip: 'bg-fm-red/90 text-white', label: 'X', ring: 'ring-fm-red' },
};
const SOURCE_STYLE: Record<CullingVerdictSource, string> = {
  manual: 'bg-white/15 backdrop-blur text-white',
  technical: 'bg-fm-blue/25 text-fm-blue border border-fm-blue/40',
  legacy: 'bg-black/50 text-gray-300 border border-white/10',
};
/**
 * Concurrent analysis workers. Each holds one decoded original (about 85 MB at
 * 21 MP), so the pool stays small: two lanes on machines with six or more threads.
 */
const analysisLanes = () => {
  const threads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
  const memory = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  return threads >= 6 && (memory === undefined || memory >= 4) ? 2 : 1;
};

/** Blur colour on a fixed scale: green sharp, amber soft, red blurred (output pixels). */
const blurColor = (blur: number) => blur <= OUTPUT_SHARP ? '#1fc06b' : blur <= OUTPUT_SOFT ? '#f5a623' : '#e5484d';

const OpticsMap: React.FC<{ result: CullingResult; previewUrl: string; target: CullingOutputTarget; label: string }> = ({ result, previewUrl, target, label }) => {
  const optics = result.metrics.optics!;
  const scale = outputScale(target, optics.sourceWidth, optics.sourceHeight), radius = optics.tile / optics.sourceWidth * 50;
  const dots: React.ReactElement[] = [];
  for (let i = 0; i < optics.map.length; i += 4) {
    const [x, y, blur, subject] = optics.map.slice(i, i + 4);
    dots.push(<circle key={i} cx={x * 100} cy={y * 100 * optics.sourceHeight / optics.sourceWidth} r={radius}
      fill={blurColor(blur * scale)} fillOpacity={0.75} stroke={subject >= 0.5 ? '#fff' : 'none'} strokeWidth={0.35} />);
  }
  return <figure className="space-y-1">
    <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: optics.sourceWidth / optics.sourceHeight }}>
      <img src={previewUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
      <svg viewBox={`0 0 100 ${100 * optics.sourceHeight / optics.sourceWidth}`} className="absolute inset-0 w-full h-full" aria-hidden="true">{dots}</svg>
    </div>
    <figcaption className="text-[10px] text-gray-400">{label}</figcaption>
  </figure>;
};

const storedMap = (files: UploadedFile[]) => new Map(files.filter(f => f.culling).map((f): [string, CullingResult] => {
  const result = f.culling!;
  if (result.engineVersion === CULLING_ENGINE_VERSION) return [f.id, result];
  // Old automatic analysis cannot hide files or retain obsolete AI risk labels.
  return [f.id, { ...result, decision: 'review' as const, finalScore: 0,
    duplicateGroupId: undefined, isBestInGroup: undefined, groupRank: undefined, groupKind: undefined,
    scoreBreakdown: undefined, reasons: ['cull_reason_reanalyze'], risks: [] }];
}));

const CullingView: React.FC<CullingViewProps> = ({ files, onSetFiles, addNotification, title, onToggleSidebar, onUndo, canUndo, onDone }) => {
  const { t } = useTranslation();
  const tr = (key: string) => (t as unknown as Record<string, string>)[key] ?? key;
  const [cullingMap, setCullingMap] = useState(() => storedMap(files));
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [genre, setGenre] = useState<CullingGenre>(() => files.find(f => f.culling?.genre)?.culling?.genre ?? 'other');
  const [intent, setIntent] = useState<CullingIntent>(() => files.find(f => f.culling?.intent)?.culling?.intent ?? 'standard');
  const [target, setTarget] = useState<CullingOutputTarget>(() => files.find(f => f.culling?.target)?.culling?.target ?? 'full');
  const [strictnessMode, setStrictnessMode] = useState<CullingStrictnessMode>('auto');
  const [filter, setFilter] = useState<Filter>('all');
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('all');
  const [collapseSeries, setCollapseSeries] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'focus' | 'grid'>(() => files.some(file => file.culling) ? 'focus' : 'grid');
  const [finished, setFinished] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [inspectionIds, setInspectionIds] = useState<string[]>([]);
  const sessionRef = useRef<CullingSession | null>(null);
  const helpersRef = useRef<CullingSession[]>([]);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const sourceFilesRef = useRef(files);
  const mapRef = useRef(cullingMap);
  const runStartRef = useRef<number>(0);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  mapRef.current = cullingMap;
  const isRunning = phase === 'analyzing' || phase === 'grouping';
  const batchIntents = new Set(files.map(file => cullingMap.get(file.id)?.intent ?? intent));
  const batchIntent = batchIntents.size > 1 ? '' : batchIntents.values().next().value ?? intent;

  const autoRecommendation = useMemo(
    () => recommendCullingStrictness([...cullingMap.values()], target),
    [cullingMap, target]
  );
  const resolvedStrictness: CullingStrictnessLevel = strictnessMode === 'auto' ? autoRecommendation.level : strictnessMode;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; helpersRef.current.forEach(helper => helper.close()); sessionRef.current?.close(); sessionRef.current = null; };
  }, []);
  // A changed project/Undo cancels a stale run before it can commit.
  useEffect(() => {
    if (sourceFilesRef.current !== files && sessionRef.current) {
      helpersRef.current.forEach(helper => helper.close());
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

  const applySimilarity = async (
    workMap: Map<string, CullingResult>,
    session: CullingSession,
    selectedGenre: CullingGenre,
    selectedTarget: CullingOutputTarget,
    selectedStrictnessMode: CullingStrictnessMode
  ) => {
    const assignments = await session.group(files.flatMap(file => {
      const r = workMap.get(file.id);
      return r?.engineVersion === CULLING_ENGINE_VERSION && r.analysisStatus === 'done' ? [{
        id: file.id, filename: file.file.name, signature: r.metrics.signature, aspectRatio: r.aspectRatio,
        finalScore: r.finalScore, sharpness: r.metrics.technical?.laplacianVariance ?? 0,
        detailConfidence: r.metrics.technical?.detailConfidence ?? 0, exif: r.exif,
        native: r.metrics.native, optics: r.metrics.optics, target: selectedTarget,
        focusRegions: r.metrics.focusRegions, intent: r.intent,
      }] : [];
    }));
    const byId = new Map(files.map(file => [file.id, file]));
    const representatives = new Map([...assignments].filter(([, a]) => a.isBestInGroup && a.duplicateGroupId).map(([id, a]) => [a.duplicateGroupId!, id]));
    const groupedPreview: CullingResult[] = [];
    for (const [id, result] of workMap) {
      if (result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus !== 'done') continue;
      const assignment = assignments.get(id);
      groupedPreview.push({ ...result, ...assignment });
    }
    const effectiveStrictness: CullingStrictnessLevel = selectedStrictnessMode === 'auto'
      ? recommendCullingStrictness(groupedPreview, selectedTarget).level
      : selectedStrictnessMode;
    for (const [id, result] of workMap) {
      if (result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus !== 'done') continue;
      const { duplicateGroupId, isBestInGroup, groupRank, groupKind, similarityToBest, relativeSharpness, scoreGap,
        referenceDetailConfidence, relativeNativeSharpness, referenceNativeSharpness, duplicateVerified,
        focusComparisonVerified, relativeFocusSharpness, referenceFocusSharpness,
        opticalSeriesBlur, referenceOpticalBlur, opticalSeriesRatio, ...base } = result;
      const assignment = assignments.get(id);
      let verified = false;
      if (assignment?.groupKind === 'near-duplicate' && assignment.isBestInGroup === false && (assignment.similarityToBest ?? 0) >= 0.965) {
        const candidate = byId.get(id), reference = byId.get(representatives.get(assignment.duplicateGroupId!) ?? '');
        if (candidate && reference) {
          try { verified = await session.verifyDuplicate(candidate, reference); }
          catch (error) { if ((error as Error).name === 'AbortError' || cancelledRef.current) throw error; }
        }
      }
      workMap.set(id, rescoreCullingResult({ ...base, ...assignment, duplicateVerified: verified }, selectedGenre, selectedTarget, effectiveStrictness));
    }
  };

  const runCulling = async (
    selectedGenre: CullingGenre = genre,
    rescoreOnly = false,
    force = false,
    overrideIntent?: CullingIntent,
    overrideTarget?: CullingOutputTarget,
    overrideStrictnessMode?: CullingStrictnessMode
  ) => {
    if (!files.length || sessionRef.current) return;
    const selectedTarget = overrideTarget ?? target;
    const selectedStrictnessMode = overrideStrictnessMode ?? strictnessMode;
    const initialStrictness: CullingStrictnessLevel = selectedStrictnessMode === 'auto' ? 'balanced' : selectedStrictnessMode;
    let session: CullingSession;
    try { session = new CullingSession(); } catch { addNotification(tr('cull_worker_unavailable'), 'error'); return; }
    sessionRef.current = session; cancelledRef.current = false;
    // Extra lanes only measure; grouping and duplicate checks stay on the primary session.
    const helpers: CullingSession[] = [];
    if (!rescoreOnly) for (let i = 1; i < Math.min(analysisLanes(), files.length); i++) {
      try { helpers.push(new CullingSession()); } catch { break; }
    }
    helpersRef.current = helpers;
    const closeHelpers = () => { helpers.forEach(helper => helper.close()); if (helpersRef.current === helpers) helpersRef.current = []; };
    const workMap = new Map(mapRef.current);
    let failed = 0, runFailed = false;
    runStartRef.current = performance.now();
    setEtaSeconds(null);
    setPhase(rescoreOnly ? 'grouping' : 'analyzing'); setProgress({ current: 0, total: files.length });
    try {
      if (!rescoreOnly) {
        let next = 0, done = 0;
        const lane = async (worker: CullingSession) => { while (next < files.length) {
          if (cancelledRef.current) break;
          const file = files[next++];
          try {
            const previous = workMap.get(file.id);
            const analysis = await worker.analyze(file, force, previous?.focusRegions ?? previous?.focusRegion);
            const result = await worker.score(analysis, selectedGenre, overrideIntent ?? previous?.intent ?? intent, selectedTarget, initialStrictness);
            workMap.set(file.id, { ...result, manualDecision: workMap.get(file.id)?.manualDecision });
          } catch (error) {
            if ((error as Error).name === 'AbortError' || cancelledRef.current) throw error;
            failed += 1;
            workMap.set(file.id, {
              metrics: { hash: '', meanLuma: 0, sharpnessScore: 0, exposureScore: 0, highlightClipping: 0,
                shadowClipping: 0, contrastScore: 0, noiseScore: 0, compositionScore: 0, nativeSharpness: 0 },
              finalScore: 0, decision: 'review', manualDecision: workMap.get(file.id)?.manualDecision,
              focusRegion: workMap.get(file.id)?.focusRegion, focusRegions: workMap.get(file.id)?.focusRegions,
              intent: overrideIntent ?? workMap.get(file.id)?.intent ?? intent,
              reasons: ['cull_reason_unreadable'], risks: ['cull_risk_unreadable'], aspectRatio: 1,
              engineVersion: CULLING_ENGINE_VERSION, analysisStatus: 'error', source: file.cullingSource ?? 'image',
            });
          }
          if (sessionRef.current !== session) return;
          done += 1;
          const elapsedSec = (performance.now() - runStartRef.current) / 1000;
          if (done >= 2 && done < files.length) {
            setEtaSeconds(Math.max(1, Math.round((elapsedSec / done) * (files.length - done))));
          } else if (done >= files.length) {
            setEtaSeconds(null);
          }
          setProgress({ current: done, total: files.length }); setCullingMap(new Map(workMap));
        } };
        await Promise.all([session, ...helpers].map(lane));
        closeHelpers();
        if (sessionRef.current !== session) return;
      } else {
        for (const [id, result] of workMap) workMap.set(id, rescoreCullingResult({ ...result, intent: overrideIntent ?? result.intent }, selectedGenre, selectedTarget, initialStrictness));
      }
      if (!cancelledRef.current && sessionRef.current === session) {
        setPhase('grouping');
        await applySimilarity(workMap, session, selectedGenre, selectedTarget, selectedStrictnessMode);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && !cancelledRef.current) { runFailed = true; addNotification(tr('cull_worker_failed'), 'error'); }
    } finally {
      closeHelpers(); session.close();
      if (mountedRef.current && sessionRef.current === session) {
        sessionRef.current = null; setCullingMap(new Map(workMap)); setPhase('done'); setEtaSeconds(null);
        commitToFiles(workMap, tr('cull_history'));
        if (!rescoreOnly && !cancelledRef.current && !runFailed) {
          setMode('focus'); setFinished(false); setFocusFilter('all'); setFocusedId(files[0]?.id ?? null);
        }
        if (failed) addNotification(failed + ' ' + tr('cull_failed_count'), 'error');
        if (!runFailed) addNotification(cancelledRef.current ? tr('cull_stopped') : tr('cull_complete'), 'info');
      }
    }
  };
  const stopCulling = () => { cancelledRef.current = true; helpersRef.current.forEach(helper => helper.close()); sessionRef.current?.close(); };
  const updateSelection = async (ids: string[], regions?: CullingFocusRegion[], selectedIntent?: CullingIntent) => {
    if (sessionRef.current) return;
    const selectedFiles = files.filter(file => ids.includes(file.id));
    if (!selectedFiles.length) return;
    let session: CullingSession;
    try { session = new CullingSession(); } catch { addNotification(tr('cull_worker_unavailable'), 'error'); return; }
    sessionRef.current = session; cancelledRef.current = false;
    setPhase('analyzing'); setProgress({ current: 0, total: selectedFiles.length });
    const next = new Map(mapRef.current);
    try {
      for (const [index, file] of selectedFiles.entries()) {
        const previous = next.get(file.id);
        const analysis = await session.analyze(file, false, regions ?? previous?.focusRegions ?? previous?.focusRegion);
        const result = await session.score(analysis, genre, selectedIntent ?? previous?.intent ?? intent, target, resolvedStrictness);
        next.set(file.id, { ...result, manualDecision: previous?.manualDecision });
        setProgress({ current: index + 1, total: selectedFiles.length });
      }
      await applySimilarity(next, session, genre, target, strictnessMode);
      if (mountedRef.current && sessionRef.current === session) {
        sessionRef.current = null;
        setCullingMap(next); commitToFiles(next, tr('cull_focus_history'));
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') addNotification(tr('cull_focus_failed'), 'error');
    } finally {
      session.close();
      if (sessionRef.current === session) sessionRef.current = null;
      if (mountedRef.current) setPhase('done');
    }
  };
  const setManualDecision = (id: string, decision: CullingDecision, allowToggle = true) => {
    if (sessionRef.current) return;
    const next = new Map(mapRef.current), current = next.get(id);
    if (!current) return;
    next.set(id, { ...current, manualDecision: allowToggle && current.manualDecision === decision ? undefined : decision });
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
  const removeRejects = async () => {
    if (sessionRef.current) return false;
    const rejects = files.filter(f => getEffectiveDecision(cullingMap.get(f.id)) === 'reject');
    if (!rejects.length) return true;
    if (!await confirmAction(tr('cull_remove_confirm') + ' (' + rejects.length + ')\n' + tr('cull_remove_undo_hint'))) return false;
    const ids = new Set(rejects.map(f => f.id));
    onSetFiles(prev => prev.filter(f => !ids.has(f.id)), tr('cull_remove_rejects'));
    addNotification(ids.size + ' ' + tr('cull_removed_count'), 'info');
    return true;
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
  const showFocus = mode === 'focus' && !isRunning && scored > 0;

  const focusVisibleFiles = useMemo(() => {
    return files.filter(file => {
      const result = cullingMap.get(file.id);
      if (focusFilter === 'all') return true;
      if (focusFilter === 'undecided') return !result?.manualDecision;
      return getEffectiveDecision(result) === focusFilter;
    });
  }, [files, cullingMap, focusFilter]);

  const currentId = focusVisibleFiles.find(file => file.id === focusedId)?.id ?? focusVisibleFiles[0]?.id ?? '';

  const decide = (id: string, decision: CullingDecision) => {
    if (sessionRef.current) return;
    const next = new Map(mapRef.current), current = next.get(id);
    if (!current) return;
    const currentIndex = focusVisibleFiles.findIndex(file => file.id === id);
    const nextAfterCurrent = focusVisibleFiles[currentIndex + 1]?.id;
    next.set(id, { ...current, manualDecision: decision });
    mapRef.current = next;
    setCullingMap(next); commitToFiles(next, tr('cull_manual_decision'));
    if (focusFilter === 'all') {
      if (currentIndex === focusVisibleFiles.length - 1) setFinished(true);
      else if (nextAfterCurrent) setFocusedId(nextAfterCurrent);
    } else {
      const remaining = files.filter(file => {
        const res = next.get(file.id);
        if (focusFilter === 'undecided') return !res?.manualDecision;
        return getEffectiveDecision(res) === focusFilter;
      });
      if (!remaining.length) setFocusedId(null);
      else if (nextAfterCurrent && remaining.some(f => f.id === nextAfterCurrent)) setFocusedId(nextAfterCurrent);
      else setFocusedId(remaining[Math.min(Math.max(0, currentIndex), remaining.length - 1)].id);
    }
  };

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

  const groupsById = useMemo(() => {
    const groups = new Map<string, UploadedFile[]>();
    for (const file of files) {
      const groupId = cullingMap.get(file.id)?.duplicateGroupId;
      if (!groupId) continue;
      const members = groups.get(groupId) ?? [];
      members.push(file); groups.set(groupId, members);
    }
    return groups;
  }, [files, cullingMap]);
  const groupMembers = useCallback((groupId: string) => groupsById.get(groupId) ?? [], [groupsById]);
  const currentSeriesMembers = useMemo(() => {
    const groupId = currentId ? cullingMap.get(currentId)?.duplicateGroupId : undefined;
    return groupId ? groupMembers(groupId) : [];
  }, [currentId, cullingMap, groupMembers]);
  const selectedCompareIds = compareIds.filter(id => files.some(file => file.id === id));
  const inspectionFiles = inspectionIds.flatMap(id => files.find(file => file.id === id) ?? []);
  const toggleCompare = (id: string) => setCompareIds(previous => previous.includes(id) ? previous.filter(value => value !== id) :
    previous.filter(value => files.some(file => file.id === value)).length < 4 ? [...previous.filter(value => files.some(file => file.id === value)), id] : previous);

  // Klávesy jako v profi cullingu: šipky = fokus, K/R/X = verdikt, Z/M/C/Backspace/? = inspekce a pomoc.
  useEffect(() => {
    if (focusedId && !showFocus) document.getElementById(`culling-card-${focusedId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusedId, showFocus]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (sessionRef.current || inspectionIds.length || event.repeat) return;
      const targetEl = event.target as HTMLElement | null;
      if (targetEl && (/^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName) || targetEl.isContentEditable)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (onUndo && canUndo) {
          event.preventDefault();
          onUndo();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (showFocus && finished) return;

      if (showFocus && event.key === '?') {
        event.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }
      if (showFocus && showShortcuts && event.key === 'Escape') {
        event.preventDefault();
        setShowShortcuts(false);
        return;
      }

      const ids = (showFocus ? focusVisibleFiles : visibleFiles).map(f => f.id);
      if (ids.length === 0) return;
      const selectedId = showFocus ? currentId : focusedId;
      const currentIndex = selectedId ? ids.indexOf(selectedId) : -1;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedId(ids[Math.min(ids.length - 1, currentIndex + 1)] ?? ids[0]);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedId(ids[Math.max(0, currentIndex - 1)] ?? ids[0]);
      } else if (showFocus && event.key === 'Backspace' && currentIndex > 0) {
        event.preventDefault();
        setFocusedId(ids[currentIndex - 1]);
      } else if (selectedId) {
        const key = event.key.toLowerCase();
        if (showFocus && key === 'z') {
          event.preventDefault();
          setInspectionIds([selectedId]);
          return;
        }
        if (showFocus && key === 'm') {
          event.preventDefault();
          setShowMap(v => !v);
          return;
        }
        if (showFocus && key === 'c' && currentSeriesMembers.length > 1) {
          event.preventDefault();
          setInspectionIds(currentSeriesMembers.slice(0, 4).map(f => f.id));
          return;
        }
        const decision: CullingDecision | null = key === 'k' ? 'keep' : key === 'r' ? 'review' : key === 'x' ? 'reject' : null;
        if (decision) {
          event.preventDefault();
          if (showFocus) { decide(selectedId, decision); return; }
          setManualDecision(selectedId, decision, false);
          const nextId = ids[Math.min(ids.length - 1, Math.max(0, currentIndex) + 1)];
          if (nextId) setFocusedId(nextId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleFiles, focusVisibleFiles, focusedId, currentId, inspectionIds, showFocus, finished, showShortcuts, currentSeriesMembers, onUndo, canUndo, commitToFiles]);

  const phaseLabel = phase === 'analyzing' ? tr('cull_phase_local') : phase === 'grouping' ? tr('cull_phase_grouping') : null;
  const etaLabel = etaSeconds === null ? null : etaSeconds >= 90
    ? tr('cull_focus_eta_min').replace('{min}', String(Math.ceil(etaSeconds / 60)))
    : tr('cull_focus_eta').replace('{sec}', String(etaSeconds));

  const translateTag = (tag: string) => tag.startsWith('cull_') ? tr(tag) : tag;

  const renderCard = (file: UploadedFile, inStrip = false) => {
    const result = cullingMap.get(file.id);
    const decision = getEffectiveDecision(result);
    const source = getVerdictSource(result);
    const style = decision ? DECISION_STYLE[decision] : null;
    const isFocused = focusedId === file.id;
    const isRepresentative = !inStrip && result?.duplicateGroupId && result.isBestInGroup;
    const groupSize = isRepresentative ? groupMembers(result!.duplicateGroupId!).length : 0;
    const accentBar = decision === 'keep' ? 'bg-fm-green' : decision === 'review' ? 'bg-amber-400' : decision === 'reject' ? 'bg-fm-red' : 'bg-white/10';

    return (
      <div
        key={inStrip ? `strip-${file.id}` : file.id}
        id={inStrip ? undefined : `culling-card-${file.id}`}
        className={`fm-contact-card group flex flex-col overflow-hidden rounded-[14px] cursor-pointer transition-all duration-150
          ${isFocused ? `ring-2 ${style?.ring ?? 'ring-fm-blue'} shadow-lg` : 'hover:border-white/20'}`}
        onClick={() => setFocusedId(file.id)}
        onDoubleClick={() => { if (!isRunning) setInspectionIds([file.id]); }}
      >
        {/* Tenká horní barevná ryska stavu — fotka zůstává 100 % čistá bez překryvu textu */}
        <div className={`h-[2px] w-full flex-shrink-0 ${accentBar}`} aria-hidden />

        {/* Čistá plocha fotografie */}
        <div className={`relative w-full overflow-hidden bg-[#08090d] ${inStrip ? 'aspect-square' : 'aspect-[3/2]'}`}>
          <button
            disabled={isRunning}
            aria-label={tr('cull_inspect') + ' ' + file.file.name}
            onClick={event => { event.stopPropagation(); setFocusedId(file.id); setInspectionIds([file.id]); }}
            className="absolute inset-0 w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fm-blue"
          >
            <img src={file.originalPreviewUrl} className="w-full h-full object-contain" loading="lazy" alt={file.file.name} />
          </button>
          {isRunning && !result && <div className="fm-scanline" />}

          {/* Porovnání (+) pouze nenápadně v pravém horním rohu */}
          <button
            disabled={isRunning || (!selectedCompareIds.includes(file.id) && selectedCompareIds.length >= 4)}
            aria-label={tr('cull_compare_select') + ' ' + file.file.name}
            aria-pressed={selectedCompareIds.includes(file.id)}
            onClick={event => { event.stopPropagation(); toggleCompare(file.id); }}
            className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-md border text-[11px] font-bold transition-opacity disabled:opacity-30 ${
              selectedCompareIds.includes(file.id)
                ? 'bg-fm-blue text-white border-fm-blue opacity-100'
                : 'bg-black/75 text-ink-200 border-white/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {selectedCompareIds.includes(file.id) ? '✓' : '+'}
          </button>

          {/* Rychlé verdikty K / R / X jen při najetí myší */}
          <div className="absolute inset-x-0 bottom-2 hidden group-hover:flex items-center justify-center gap-1.5 pointer-events-none">
            {(['keep', 'review', 'reject'] as CullingDecision[]).map(d => (
              <button
                key={d}
                disabled={isRunning}
                onClick={(e) => { e.stopPropagation(); setManualDecision(file.id, d, true); }}
                className={`${DECISION_STYLE[d].chip} pointer-events-auto w-7 h-7 rounded-full text-[11px] font-black shadow-xl hover:scale-110 transition-transform`}
                title={tr(`cull_decision_${d}`)}
              >
                {DECISION_STYLE[d].label}
              </button>
            ))}
          </div>
        </div>

        {/* Matný pásek kontaktního archu pod fotografií */}
        <div className="flex flex-col gap-1.5 border-t border-white/[0.06] px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            {style && (
              <span className={`${style.chip} h-5 w-5 flex-shrink-0 rounded-full flex items-center justify-center text-[10px] font-black`}>
                {style.label}
              </span>
            )}
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-100">{file.file.name}</p>
            {result && (
              <span className="flex-shrink-0 font-mono text-[11px] font-semibold tabular-nums text-ink-300">
                {result.engineVersion === CULLING_ENGINE_VERSION ? result.finalScore : '—'}
              </span>
            )}
          </div>

          {!inStrip && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {source && (
                  <span className={`${SOURCE_STYLE[source]} text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded`}>
                    {tr(`cull_source_${source}`)}
                  </span>
                )}
                {result?.rejectionKind && decision === 'reject' && !result.manualDecision && (
                  <span className="text-[9px] font-medium text-fm-red">{tr('cull_rejection_' + result.rejectionKind)}</span>
                )}
              </div>
              {isRepresentative && groupSize > 1 && collapseSeries && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const groupId = result!.duplicateGroupId!;
                    setExpandedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(groupId)) next.delete(groupId);
                      else {
                        next.add(groupId);
                        gridScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                      return next;
                    });
                  }}
                  className="flex-shrink-0 bg-fm-blue/20 text-sky-200 border border-fm-blue/40 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 hover:bg-fm-blue/35"
                >
                  <StackIcon className="w-2.5 h-2.5" />
                  {expandedGroups.has(result!.duplicateGroupId!) ? '−' : `+${groupSize - 1}`}
                </button>
              )}
            </div>
          )}

          {result && !inStrip && (
            <p className="text-[11px] text-ink-400 leading-snug line-clamp-1">
              {result.engineVersion === CULLING_ENGINE_VERSION ? result.reasons.map(translateTag).join(' · ') : tr('cull_reason_reanalyze')}
            </p>
          )}
          {result && !inStrip && result.risks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.risks.slice(0, 2).map((risk, i) => (
                <span key={i} className="bg-amber-400/12 text-amber-200 text-[9px] font-medium px-1.5 py-0.5 rounded border border-amber-400/25">
                  {translateTag(risk)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col text-white overflow-hidden">
      <Header title={title} onToggleSidebar={onToggleSidebar} actions={<>
        <div className="fm-seg" role="group" aria-label={tr('cull_title')}>
          {(['focus', 'grid'] as const).map(value => <button key={value} aria-pressed={mode === value}
            disabled={isRunning || !scored} className={mode === value ? 'is-active' : ''}
            onClick={() => setMode(value)}>{tr('cull_mode_' + value)}</button>)}
        </div>
        <span className="hidden h-5 w-px bg-hairline sm:inline-block" aria-hidden />
        <div className="flex items-center gap-2">
          <span id="culling-target-label" className="text-[11px] font-medium text-ink-400">{tr('cull_target_label')}</span>
          <div role="radiogroup" aria-labelledby="culling-target-label" className="fm-seg">
            {CULLING_TARGETS.map(value => <button key={value} role="radio" aria-checked={target === value} disabled={isRunning}
              className={target === value ? 'is-active' : ''} onClick={() => {
                if (value === target) return;
                setTarget(value);
                if (mapRef.current.size) void runCulling(genre, true, false, undefined, value, strictnessMode);
              }}>{tr('cull_target_' + value)}</button>)}
          </div>
        </div>
        <span className="hidden h-5 w-px bg-hairline sm:inline-block" aria-hidden />
        <div className="flex items-center gap-2">
          <span id="culling-strictness-label" className="text-[11px] font-medium text-ink-400">{tr('cull_strict_label')}</span>
          <div role="radiogroup" aria-labelledby="culling-strictness-label" className="fm-seg">
            {CULLING_STRICTNESS_MODES.map(value => {
              const label = value === 'auto' && scored > 0
                ? `${tr('cull_strict_auto')} · ${tr('cull_strict_' + autoRecommendation.level)}`
                : tr('cull_strict_' + value);
              const hint = value === 'auto' && scored > 0 ? tr(autoRecommendation.reason) : undefined;
              return <button key={value} role="radio" aria-checked={strictnessMode === value} disabled={isRunning}
                title={hint}
                className={strictnessMode === value ? 'is-active' : ''} onClick={() => {
                  if (value === strictnessMode) return;
                  setStrictnessMode(value);
                  if (mapRef.current.size) void runCulling(genre, true, false, undefined, target, value);
                }}>{label}</button>;
            })}
          </div>
        </div>
      </>} />

      {showFocus ? <div className="flex min-h-0 flex-1 p-4">
        <CullingFocus
          files={files}
          visibleFiles={focusVisibleFiles}
          results={cullingMap}
          currentId={currentId}
          target={target}
          filter={focusFilter}
          onFilterChange={nextFilter => { setFocusFilter(nextFilter); setFinished(false); }}
          seriesMembers={currentSeriesMembers}
          busy={isRunning}
          finished={finished}
          showMap={showMap}
          onToggleMap={() => setShowMap(v => !v)}
          showShortcuts={showShortcuts}
          onToggleShortcuts={() => setShowShortcuts(v => !v)}
          tr={tr}
          onSelect={id => { setFocusedId(id); setFinished(false); }}
          onDecide={decide}
          onBack={() => {
            const idx = focusVisibleFiles.findIndex(file => file.id === currentId);
            if (idx > 0) setFocusedId(focusVisibleFiles[idx - 1].id);
          }}
          onInspect={id => setInspectionIds([id])}
          onCompareSeries={() => {
            if (currentSeriesMembers.length > 1) setInspectionIds(currentSeriesMembers.slice(0, 4).map(f => f.id));
          }}
          onRestart={() => { setFinished(false); setFocusFilter('all'); setFocusedId(files[0]?.id ?? null); }}
          onShowGrid={() => setMode('grid')}
          onContinue={onDone ? async () => { if (await removeRejects()) onDone(); } : undefined}
          continueLabel={tr(counts.reject ? 'cull_apply_editor' : 'cull_continue_editor')}
        />
      </div> : <div className="flex-1 flex overflow-hidden">
        {/* LEVÝ PANEL */}
        <div className="w-80 flex-shrink-0 bg-surface/70 backdrop-blur-xl border-r border-border-subtle p-5 flex flex-col gap-4 overflow-y-auto custom-scrollbar z-10">

          <div className="glass-panel p-4 rounded-2xl">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
              <Aperture className="w-4 h-4" />
              {tr('cull_title')}
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">{tr('cull_desc')}</p>
            {strictnessMode === 'auto' && scored > 0 && (
              <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] leading-snug text-ink-200">
                {tr(autoRecommendation.reason)}
              </p>
            )}
          </div>

          {/* Spuštění */}
          {!isRunning ? (
            <button
              onClick={() => void runCulling()}
              disabled={files.length === 0}
              className="fm-btn-primary w-full py-3 px-4 disabled:opacity-40 disabled:cursor-not-allowed"
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
                <span className="text-gray-400 font-mono">{progress.current}/{progress.total}</span>
              </div>
              {etaLabel && <p className="text-[11px] text-ink-400 font-mono">{etaLabel}</p>}
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

          {/* Statistika + filtry hned pod spuštěním */}
          {scored > 0 && (
            <div className="glass-panel rounded-2xl p-4 space-y-2.5">
              {(['keep', 'review', 'reject'] as CullingDecision[]).map(d => (
                <div key={d} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-gray-300">
                    <span className={`w-2 h-2 rounded-full ${d === 'keep' ? 'bg-fm-green' : d === 'review' ? 'bg-amber-400' : 'bg-fm-red'}`} />
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

          {/* Profil, záměr a omezení (kompaktní, rozbalitelné — výchozí otevřené pro snadný přístup) */}
          <details open className="rounded-2xl border border-border-subtle bg-elevated/40 p-3.5 space-y-3">
            <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-ink-300 select-none">
              {tr('cull_advanced_settings')}
            </summary>
            <div className="space-y-2 pt-2">
              <label htmlFor="culling-genre" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{tr('cull_genre')}</label>
              <select id="culling-genre" value={genre} disabled={isRunning} onChange={e => handleGenreChange(e.target.value)}
                className="w-full bg-elevated border border-border-subtle rounded-xl px-3 py-2 text-xs text-white focus:border-fm-blue focus:outline-none">
                {CULLING_GENRES.map(g => <option key={g} value={g}>{tr('cull_genre_' + g)}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 leading-relaxed">{tr('cull_genre_hint')}</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="culling-intent" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{tr('cull_intent_batch')}</label>
              <select id="culling-intent" value={batchIntent} disabled={isRunning} onChange={e => {
                const value = e.target.value as CullingIntent; setIntent(value);
                if (mapRef.current.size) void runCulling(genre, true, false, value);
              }} className="w-full bg-elevated border border-border-subtle rounded-xl px-3 py-2 text-xs text-white">
                <option value="" disabled>{tr('cull_intent_mixed')}</option>
                {CULLING_INTENTS.map(value => <option key={value} value={value}>{tr('cull_intent_' + value)}</option>)}
              </select>
              {(batchIntent === 'creative' || batchIntent === 'stack') && (
                <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                  <p className="font-semibold">{tr('cull_rejection_disabled')}</p>
                  <p className="mt-1 leading-relaxed">{tr('cull_rejection_disabled_hint')}</p>
                </div>
              )}
              <p className="text-[11px] text-gray-400 leading-relaxed">{tr('cull_intent_hint')}</p>
            </div>
            {!isRunning && scored > 0 && <div className="space-y-1 pt-1">
              <button onClick={() => void runCulling(genre, false, true)} className="text-xs text-gray-400 underline hover:text-white">{tr('cull_remeasure')}</button>
              <p className="text-[11px] text-gray-500">{tr('cull_cache_hint')}</p>
            </div>}
            <p className="text-[11px] text-gray-500 leading-relaxed border-t border-border-subtle pt-2.5">{tr('cull_limits')}</p>
          </details>

          {focusedId && cullingMap.get(focusedId) && (() => {
            const result = cullingMap.get(focusedId)!;
            const technical = result.engineVersion === CULLING_ENGINE_VERSION ? result.metrics.technical : undefined;
            return <div className="glass-panel rounded-2xl p-4 space-y-3" data-testid="culling-detail">
              <h3 className="text-xs font-bold">{tr('cull_detail_title')}</h3>
              <p className="text-[11px] text-gray-400">{tr(result.source === 'embedded-jpeg-preview' ? 'cull_source_raw_preview' : 'cull_source_image')}</p>
              {result.engineVersion === CULLING_ENGINE_VERSION && reliableOptics(result.metrics.optics) && (() => {
                const optics = result.metrics.optics!, verdict = opticsVerdict(optics, result.target ?? target);
                const scale = outputScale(result.target ?? target, optics.sourceWidth, optics.sourceHeight);
                const px = (blur?: number) => blur === undefined ? '–' : (blur * scale).toFixed(2) + ' px';
                const file = files.find(f => f.id === focusedId);
                return <section className="space-y-2" data-testid="culling-optics">
                  <h4 className="text-[11px] font-bold text-gray-300">{tr('cull_optics_title')}</h4>
                  {file && <OpticsMap result={result} previewUrl={file.previewUrl} target={result.target ?? target} label={tr('cull_optics_map')} />}
                  <dl className="text-[11px] space-y-1">
                    {[[tr('cull_optics_subject'), px(optics.subjectBlur)], [tr('cull_optics_background'), px(optics.backgroundBlur)],
                      [tr('cull_optics_frame'), px(optics.frameBlur)],
                      [tr('cull_optics_sharp_up_to'), verdict.sharpUpTo ? verdict.sharpUpTo + ' px' : '–'],
                      [tr('cull_optics_tiles'), optics.map.length / 4 + ' / ' + optics.planned],
                    ].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-gray-400">{label}</dt><dd className="font-mono">{value}</dd></div>)}
                  </dl>
                </section>;
              })()}
              {technical && <details open className="space-y-2 border-t border-white/10 pt-2">
                <summary className="cursor-pointer text-[11px] font-semibold text-ink-300 select-none">{tr('cull_diagnostics_toggle')}</summary>
                <dl className="text-[11px] space-y-1 pt-1">
                  {[[tr('cull_metric_preview'), technical.width + ' × ' + technical.height],
                    [tr('cull_metric_detail'), String(Math.round(technical.laplacianVariance))],
                    [tr('cull_metric_range'), technical.p5 + ' – ' + technical.p95],
                    [tr('cull_metric_highlights'), (result.metrics.highlightClipping * 100).toFixed(1) + ' %'],
                    [tr('cull_metric_shadows'), (result.metrics.shadowClipping * 100).toFixed(1) + ' %'],
                    [tr('cull_metric_noise'), technical.noiseEstimate.toFixed(1) + ' / 255'],
                    [tr('cull_metric_evidence'), Math.round(technical.detailConfidence * 100) + ' / 100'],
                  ].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-gray-400">{label}</dt><dd className="font-mono">{value}</dd></div>)}
                </dl>
                {result.metrics.native && <dl className="text-[11px] space-y-1">
                  {[[tr('cull_metric_native_source'), result.metrics.native.sourceWidth + ' × ' + result.metrics.native.sourceHeight],
                    [tr('cull_metric_native_samples'), result.metrics.native.sampleCount + ' × ' + result.metrics.native.sampleSize + ' px (1:1)'],
                    [tr('cull_metric_native_detail'), result.metrics.native.maxLaplacianVariance.toFixed(1)],
                    [tr('cull_metric_native_acutance'), result.metrics.native.maxEdgeAcutance.toFixed(4)],
                  ].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-gray-400">{label}</dt><dd className="font-mono">{value}</dd></div>)}
                </dl>}
                {result.scoreBreakdown && <dl className="text-[11px] space-y-1">
                  {Object.entries(result.scoreBreakdown).map(([part, value]) => <div key={part} className="flex justify-between gap-2">
                    <dt className="text-gray-400">{tr('cull_part_' + part)}</dt><dd className="font-mono">{value.contribution.toFixed(1)} / {Math.round(value.weight * 100)}</dd>
                  </div>)}
                </dl>}
                <p className="text-[11px] text-gray-400">{tr('cull_score_hint')}</p>
              </details>}
              {formatExifStrip(result.exif) && <p className="text-[11px] text-ink-300 font-mono">
                {formatExifStrip(result.exif)}
              </p>}
            </div>;
          })()}

          {/* Akce */}
          <div className="mt-auto space-y-2 pt-2">
            <button disabled={isRunning || !focusedId} onClick={() => { if (focusedId) setInspectionIds([focusedId]); }}
              className="w-full py-2.5 rounded-xl bg-elevated border border-border-subtle text-xs font-bold disabled:opacity-40">{tr('cull_inspect')}</button>
            <button disabled={isRunning || selectedCompareIds.length < 2} onClick={() => setInspectionIds(selectedCompareIds)}
              className="w-full py-2.5 rounded-xl bg-elevated border border-fm-blue text-xs font-bold disabled:opacity-40">{tr('cull_compare_open')} ({selectedCompareIds.length}/4)</button>
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
                disabled={isRunning}
                onClick={async () => { if (await removeRejects()) onDone(); }}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-wide hover:bg-gray-200 transition-colors"
              >
                {tr(counts.reject ? 'cull_apply_editor' : 'cull_continue_editor')}
              </button>
            )}
          </div>
        </div>

        {/* GRID */}
        <div ref={gridScrollRef} className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          {files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
              <StackIcon className="w-10 h-10 opacity-40" />
              <p className="text-sm">{tr('cull_empty')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {scored === 0 && !isRunning && (
                <div className="fm-surface flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-display text-lg text-ink-50">{tr('cull_start_ready').replace('{count}', String(files.length))}</p>
                    <p className="mt-0.5 text-xs text-ink-400">{tr('cull_start_sub')}</p>
                  </div>
                </div>
              )}

              {/* Rozbalené série rovnou v zorném poli nahoře */}
              {Array.from(expandedGroups).map(groupId => {
                const members = groupMembers(groupId);
                if (members.length < 2) return null;
                return (
                  <div key={groupId} className="glass-panel rounded-2xl border-fm-blue/30 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-fm-blue flex items-center gap-1.5">
                        <StackIcon className="w-3.5 h-3.5" /> {tr('cull_series')} ({members.length})
                      </span>
                      <button
                        disabled={isRunning}
                        onClick={() => setInspectionIds(members.slice(0, 4).map(file => file.id))}
                        className="ml-auto mr-4 text-xs text-fm-blue disabled:opacity-40"
                      >{tr('cull_compare_open')}</button>
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

              <div className="fm-grid-photos">
                {visibleFiles.map(file => renderCard(file))}
              </div>
            </div>
          )}
        </div>
      </div>
      }
      {inspectionFiles.length > 0 && <CullingCompare key={inspectionIds.join('|')} files={inspectionFiles} results={cullingMap}
        initialZoom={mode === 'focus' ? 1 : 'fit'}
        onDecision={(id, decision) => setManualDecision(id, decision, true)}
        onFocusRegions={(ids, regions) => { void updateSelection(ids, regions); }}
        onIntentChange={(id, value) => { void updateSelection([id], undefined, value); }} busy={isRunning} onClose={() => setInspectionIds([])} />}
    </div>
  );
};

export default CullingView;
