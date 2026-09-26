import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import CanvasViewport, { type CanvasViewportHandle } from './editor/CanvasViewport';
import AdjustPanel from './editor/AdjustPanel';
import RetouchPanel, { type ModelStatus } from './editor/RetouchPanel';
import ExportPanel, { type ExportOptions } from './editor/ExportPanel';
import { Segmented } from './editor/ui';
import type { UploadedFile, EditorAction, History, ManualEdits, View } from '../types';
import * as geminiService from '../services/geminiService';
import { describeAiError } from '../services/aiErrors';
import { encodeCanvas, inpaintRegion, outputType, preloadInpaintModel, type InpaintChoice } from '../services/localInpaint';
import { encodeForSegment, loadSegmentModel, renderSegmentMask, segmentAt, segmentBoxes, type SegmentCandidate } from '../services/localSegment';
import { SEGMENT_TOTAL_BYTES } from '../utils/segmentModel';
import type { LassoStatus } from './editor/RetouchPanel';

// Jeden objekt vybraný lasem: tři velikosti (část/objekt/celek) a zvolená.
interface LassoObject {
  candidates: SegmentCandidate[];
  level: number;
  subtract: boolean;
}
import type { InpaintModelId } from '../utils/inpaintModels';
import { computeAutoAdjust } from '../utils/autoAdjust';
import { applyEditsAndExport } from '../utils/imageProcessor';
import {
  buildEditedFileName,
  downloadBlob,
  pickDirectoryForSave,
  saveBlobToDirectory,
  saveBlobWithPicker,
  supportsNativeDirectoryPicker,
  supportsNativeSavePicker,
} from '../utils/fileSave';
import { useTranslation } from '../contexts/LanguageContext';

interface EditorViewProps {
  files: UploadedFile[];
  activeFileId: string | null;
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  onSetActiveFileId: (id: string | null) => void;
  activeAction: EditorAction;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  history: History;
  onUndo: () => void;
  onRedo: () => void;
  onNavigate: (payload: { view: View; action?: string }) => void;
  onOpenApiKeyModal: () => void;
  onToggleSidebar: () => void;
}

type Mode = 'adjust' | 'retouch' | 'export';

const INITIAL_EDITS: ManualEdits = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  shadows: 0,
  highlights: 0,
  clarity: 0,
  sharpness: 0,
  noiseReduction: 0,
  aspectRatio: undefined,
  cropRect: undefined,
  watermark: { enabled: false, text: '', opacity: 50, size: 20, position: 'bottom-right', color: '#ffffff' },
};

const modeFromAction = (action: EditorAction): Mode => {
  if (action?.action === 'export') return 'export';
  if (action?.action === 'retouch' || action?.action === 'remove-object') return 'retouch';
  return 'adjust';
};

const MODEL_KEY = 'fm_inpaint_model';
const BRUSH_KEY = 'fm_retouch_brush';

// Nastavení štětce si studio pamatuje mezi spuštěními (jen preference v prohlížeči).
const loadBrush = () => {
  const fallback = { size: 48, hardness: 85, strength: 100 };
  try {
    const saved = JSON.parse(localStorage.getItem(BRUSH_KEY) || 'null');
    if (!saved) return fallback;
    const clamp = (v: unknown, min: number, max: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
    return {
      size: clamp(saved.size, 8, 240, fallback.size),
      hardness: clamp(saved.hardness, 0, 100, fallback.hardness),
      strength: clamp(saved.strength, 10, 100, fallback.strength),
    };
  } catch {
    return fallback;
  }
};

const EditorView: React.FC<EditorViewProps> = (props) => {
  const { files, activeFileId, onSetFiles, onSetActiveFileId, activeAction, addNotification, history, onUndo, onRedo, onOpenApiKeyModal } = props;
  const { t, language } = useTranslation();

  const [mode, setMode] = useState<Mode>(() => modeFromAction(activeAction));
  const [editsById, setEditsById] = useState<Record<string, ManualEdits>>({});
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({ format: 'jpeg', quality: 92, scale: 1 });
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  const [initialBrush] = useState(loadBrush);
  const [brushSize, setBrushSize] = useState(initialBrush.size);
  // Tvrdost a síla v procentech, jak je ukazují posuvníky.
  const [brushHardness, setBrushHardness] = useState(initialBrush.hardness);
  const [retouchStrength, setRetouchStrength] = useState(initialBrush.strength);
  useEffect(() => {
    try {
      localStorage.setItem(BRUSH_KEY, JSON.stringify({ size: brushSize, hardness: brushHardness, strength: retouchStrength }));
    } catch {
      /* jen preference */
    }
  }, [brushSize, brushHardness, retouchStrength]);
  const [model, setModel] = useState<InpaintChoice>(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      return saved === 'quality' || saved === 'fast' ? saved : 'auto';
    } catch {
      return 'fast';
    }
  });
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'idle' });
  const [retouching, setRetouching] = useState(false);
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);

  // --- Chytré laso ---
  const [retouchTool, setRetouchTool] = useState<'brush' | 'lasso'>('brush');
  const [lassoObjects, setLassoObjects] = useState<LassoObject[]>([]);
  const [lassoStatus, setLassoStatus] = useState<LassoStatus>({ state: 'idle' });
  const [lassoBusy, setLassoBusy] = useState(false);
  const lassoBusyRef = useRef(false);
  const segmentLoadedRef = useRef(false);
  const encodedKeyRef = useRef<string | null>(null);
  const encodingRef = useRef<{ key: string; promise: Promise<string | null> } | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const viewportRef = useRef<CanvasViewportHandle>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  // Verze obsahu plátna po posledním vloženém výřezu a URL souboru, ze kterého retuš vyšla.
  const currentVersionRef = useRef(0);
  const baseUrlRef = useRef<string | null>(null);
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [savingRetouch, setSavingRetouch] = useState(false);
  const savingRef = useRef(false);
  savingRef.current = savingRetouch;
  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId), [files, activeFileId]);
  const manualEdits = (activeFileId && editsById[activeFileId]) || INITIAL_EDITS;
  const activeIndex = files.findIndex((f) => f.id === activeFileId);

  useEffect(() => {
    if (activeAction) setMode(modeFromAction(activeAction));
  }, [activeAction]);

  const setEdit = useCallback(<K extends keyof ManualEdits>(key: K, value: ManualEdits[K]) => {
    if (!activeFileId) return;
    setEditsById((prev) => ({ ...prev, [activeFileId]: { ...(prev[activeFileId] || INITIAL_EDITS), [key]: value } }));
  }, [activeFileId]);

  // Náhled s úpravami posuvníků (poloviční rozlišení, jen pro zobrazení).
  useEffect(() => {
    if (!activeFile) return;
    let cancelled = false;
    let created: string | null = null;
    const timer = setTimeout(async () => {
      try {
        const blob = await applyEditsAndExport(activeFile.previewUrl, manualEdits, { format: 'jpeg', quality: 90, scale: 0.5 });
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setEditedPreviewUrl(created);
      } catch (e) {
        if (!cancelled) console.error('Preview generation failed:', e);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (created) setTimeout(() => URL.revokeObjectURL(created!), 1000);
    };
  }, [activeFile?.id, activeFile?.previewUrl, manualEdits]);

  // --- Retuš ---
  const loadModel = useCallback((id: InpaintModelId) => {
    setModelStatus((s) => (s.state === 'ready' ? s : { state: 'downloading', loaded: 0, total: 1 }));
    return preloadInpaintModel(id, (p) => {
      if (p.phase === 'init') setModelStatus({ state: 'preparing' });
      else if (p.phase === 'download' && p.total) setModelStatus({ state: 'downloading', loaded: p.loaded || 0, total: p.total });
    })
      .then((backend) => {
        setModelStatus({ state: 'ready', backend });
        return true;
      })
      .catch((e: Error) => {
        setModelStatus({ state: 'error', message: `${t.retouch_model_error} (${e.message})` });
        return false;
      });
  }, [t.retouch_model_error]);

  // Rychlý model se připravuje hned při otevření retuše; velký až na vyžádání
  // (208 MB se nemá stahovat bez tahu štětcem).
  useEffect(() => {
    if (mode !== 'retouch') return;
    if (model === 'fast' || model === 'auto') loadModel('fast');
    else setModelStatus({ state: 'idle' });
  }, [mode, model, loadModel]);

  const changeModel = (next: InpaintChoice) => {
    setModel(next);
    try {
      localStorage.setItem(MODEL_KEY, next);
    } catch {
      /* jen preference */
    }
  };

  // Uložení retušované fotky do souboru běží na pozadí a vždy jen jedno;
  // tahy mezi tím se do souboru dostanou dalším kolem (bere se nejnovější verze).
  const saveRef = useRef<{ running: boolean; pending: boolean }>({ running: false, pending: false });

  const saveRetouched = useCallback(async (fileId: string, name: string, type: string) => {
    const state = saveRef.current;
    if (state.running) {
      state.pending = true;
      return;
    }
    state.running = true;
    setSavingRetouch(true);
    try {
      do {
        state.pending = false;
        const vp = viewportRef.current;
        // Ukládá se plátno, do kterého se retuš vložila — ne to, co je zrovna
        // vidět (při Porovnat je na plátně originál).
        const source = workingCanvasRef.current;
        if (!vp || !source) return;
        const version = currentVersionRef.current;
        const file = await encodeCanvas(source, name, type);
        // Mezitím přišel další tah → uložit znovu až s ním.
        if (state.pending || version !== currentVersionRef.current) continue;
        // Mezitím se fotka změnila jinak (zpět, jiná fotka) → výsledek zahodit.
        const current = filesRef.current.find((f) => f.id === fileId);
        if (!current || current.previewUrl !== baseUrlRef.current) return;
        const url = URL.createObjectURL(file);
        vp.commitSource(url, version);
        baseUrlRef.current = url;
        onSetFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, file, previewUrl: url } : f)), t.retouch_history_entry);
      } while (state.pending);
    } catch (e) {
      console.error('Saving retouched photo failed:', e);
      addNotification(t.retouch_failed, 'error');
    } finally {
      state.running = false;
      setSavingRetouch(false);
    }
  }, [onSetFiles, addNotification, t]);

  const runRetouch = useCallback(async (fromLasso = false) => {
    const vp = viewportRef.current;
    const mask = vp?.getMaskCanvas();
    if (!activeFile || !vp || !mask || !vp.hasMask() || retouching) return;
    const source = vp.getSourceCanvas();
    if (!source) return;
    setRetouching(true);
    if (!saveRef.current.running) baseUrlRef.current = activeFile.previewUrl;
    try {
      const patch = await inpaintRegion(source, mask, model, (p) => {
        if (p.phase === 'init') setModelStatus({ state: 'preparing' });
        else if (p.phase === 'download' && p.total) setModelStatus({ state: 'downloading', loaded: p.loaded || 0, total: p.total });
        // Výběr z lasa má ostrý obrys — tvrdá díra s okrajem, jinak by po objektu zůstal obrys.
      }, { hardness: fromLasso ? 1 : brushHardness / 100, strength: retouchStrength / 100 });
      // Výsledek je vidět hned; soubor se uloží potom.
      setModelStatus({ state: 'ready', backend: patch.backend });
      setLastRunMs(patch.ms);
      const version = vp.applyPatch(source, patch.layer, patch.x, patch.y);
      if (version < 0) return; // mezitím jiná fotka
      currentVersionRef.current = version;
      workingCanvasRef.current = source;
      saveRetouched(activeFile.id, activeFile.file.name, outputType(activeFile.file));
    } catch (e) {
      vp.clearMask();
      const message = e instanceof Error ? e.message : String(e);
      if (message !== 'EMPTY_MASK') {
        console.error('Local retouch failed:', e);
        setModelStatus({ state: 'error', message: `${t.retouch_model_error} (${message})` });
        addNotification(t.retouch_failed, 'error');
      }
    } finally {
      setRetouching(false);
    }
  }, [activeFile, model, retouching, addNotification, t, saveRetouched, brushHardness, retouchStrength]);

  // Laso: model se stáhne jednou, fotka se „přečte" jednou na každou verzi obsahu.
  const ensureEncoded = useCallback(async () => {
    const vp = viewportRef.current;
    const source = vp?.getSourceCanvas();
    if (!vp || !source || !activeFile) return null;
    const key = `${activeFile.id}|${vp.getContentVersion()}`;
    if (encodedKeyRef.current === key) return key;
    // Stejnou verzi už někdo čte (otevření lasa + rychlý klik) — počkat na ni.
    if (encodingRef.current?.key === key) return encodingRef.current.promise;
    const promise = (async () => {
      if (!segmentLoadedRef.current) {
        setLassoStatus({ state: 'downloading', loaded: 0, total: SEGMENT_TOTAL_BYTES });
        await loadSegmentModel((p) => setLassoStatus({ state: 'downloading', loaded: p.loaded, total: p.total }));
        segmentLoadedRef.current = true;
      }
      setLassoStatus({ state: 'reading' });
      await encodeForSegment(source, key);
      encodedKeyRef.current = key;
      setLassoStatus({ state: 'ready' });
      return key;
    })();
    encodingRef.current = { key, promise };
    try {
      return await promise;
    } finally {
      if (encodingRef.current?.promise === promise) encodingRef.current = null;
    }
  }, [activeFile]);

  const lassoError = useCallback((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Smart lasso failed:', e);
    setLassoStatus({ state: 'error', message: `${t.lasso_error} (${message})` });
  }, [t.lasso_error]);

  // Otevření lasa rovnou připraví model i fotku, ať první klik nečeká.
  useEffect(() => {
    if (mode !== 'retouch' || retouchTool !== 'lasso' || retouching) return;
    ensureEncoded().catch(lassoError);
  }, [mode, retouchTool, retouching, activeFile?.id, ensureEncoded, lassoError]);

  // Jiná fotka = starý výběr neplatí.
  useEffect(() => {
    setLassoObjects([]);
  }, [activeFile?.id]);

  // Výběr = sjednocení objektů, Alt+klik ubírá; kreslí se do masky plátna.
  useEffect(() => {
    if (retouchTool !== 'lasso') return;
    const vp = viewportRef.current;
    const mask = vp?.getMaskCanvas();
    if (!vp || !mask) return;
    if (lassoObjects.length === 0) {
      vp.setMask(null);
      return;
    }
    const selection = document.createElement('canvas');
    selection.width = mask.width;
    selection.height = mask.height;
    const ctx = selection.getContext('2d')!;
    for (const obj of lassoObjects) {
      ctx.globalCompositeOperation = obj.subtract ? 'destination-out' : 'source-over';
      ctx.drawImage(renderSegmentMask(obj.candidates[obj.level].logits, mask.width, mask.height), 0, 0);
    }
    vp.setMask(selection);
  }, [lassoObjects, retouchTool]);

  const onLassoClick = useCallback(async (point: { x: number; y: number }, subtract: boolean) => {
    if (lassoBusyRef.current || retouching) return;
    lassoBusyRef.current = true;
    setLassoBusy(true);
    try {
      const key = await ensureEncoded();
      const size = viewportRef.current?.getImageSize();
      if (!key || !size) return;
      const { candidates, best } = await segmentAt(key, point, size.width, size.height);
      if (candidates.length) setLassoObjects((prev) => [...prev, { candidates, level: best, subtract }]);
    } catch (e) {
      lassoError(e);
    } finally {
      lassoBusyRef.current = false;
      setLassoBusy(false);
    }
  }, [ensureEncoded, lassoError, retouching]);

  const changeLassoLevel = (level: number) =>
    setLassoObjects((prev) => prev.map((obj, i) => (i === prev.length - 1 ? { ...obj, level } : obj)));

  const removeLassoSelection = async () => {
    await runRetouch(true);
    setLassoObjects([]);
  };

  // Výběr textem: Gemini najde obdélníky, masky z nich udělá lokální SAM.
  const findByText = async (query: string) => {
    if (!query.trim() || lassoBusyRef.current || retouching) return;
    lassoBusyRef.current = true;
    setLassoBusy(true);
    try {
      const key = await ensureEncoded();
      const vp = viewportRef.current;
      const source = vp?.getSourceCanvas();
      const size = vp?.getImageSize();
      if (!key || !source || !size) return;
      // Gemini stačí zmenšená fotka (delší strana 1536 px); obdélníky se přepočítají.
      const scale = Math.min(1, 1536 / Math.max(size.width, size.height));
      const small = document.createElement('canvas');
      small.width = Math.round(size.width * scale);
      small.height = Math.round(size.height * scale);
      small.getContext('2d')!.drawImage(source, 0, 0, small.width, small.height);
      const found = await geminiService.locateObjects(small.toDataURL('image/jpeg', 0.9), small.width, small.height, query);
      if (!found.length) {
        addNotification(t.lasso_text_none, 'info');
        return;
      }
      const boxes = found.map(({ box }) => ({ x0: box.x0 / scale, y0: box.y0 / scale, x1: box.x1 / scale, y1: box.y1 / scale }));
      const objects = await segmentBoxes(key, boxes, size.width, size.height);
      setLassoObjects((prev) => [...prev, ...objects.map((o) => ({ candidates: o.candidates, level: o.best, subtract: false }))]);
      addNotification(`${t.lasso_text_found}: ${found.length}`, 'info');
    } catch (e) {
      const { code, message } = describeAiError(e, language);
      if (code === 'API_KEY_MISSING') onOpenApiKeyModal();
      else if (/SEGMENT_/.test(String((e as Error)?.message))) lassoError(e);
      else addNotification(message, 'error');
    } finally {
      lassoBusyRef.current = false;
      setLassoBusy(false);
    }
  };

  const changeRetouchTool = (tool: 'brush' | 'lasso') => {
    // Výběr z lasa zůstane v masce — štětcem se dá doladit a puštěním tahu odstranit.
    setLassoObjects([]);
    setRetouchTool(tool);
  };

  // Úprava textem přes Gemini — volitelná, potřebuje vlastní API klíč.
  const runPromptRetouch = async (prompt: string, batch: boolean) => {
    if (!activeFile) return;
    const targets = batch ? files : [activeFile];
    setRetouching(true);
    let ok = 0;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (targets.length > 1) setBatchProgress({ current: i + 1, total: targets.length });
      setBusyLabel(t.retouch_text_running);
      try {
        const result = await geminiService.retouchWithPrompt(target.file, prompt);
        const url = URL.createObjectURL(result.file);
        onSetFiles((prev) => prev.map((f) => (f.id === target.id ? { ...f, file: result.file, previewUrl: url } : f)), `${t.retouch_text_title}: ${prompt}`);
        ok++;
      } catch (e) {
        const { code, message } = describeAiError(e, language);
        if (code === 'API_KEY_MISSING') {
          onOpenApiKeyModal();
          break;
        }
        addNotification(message, 'error');
      }
    }
    setPromptHistory((prev) => [prompt, ...prev.filter((p) => p !== prompt)].slice(0, 10));
    if (ok > 0) addNotification(`${t.retouch_done} (${ok}/${targets.length})`, 'info');
    setBatchProgress(null);
    setBusyLabel(null);
    setRetouching(false);
  };

  // --- Automatická úprava (lokálně, z histogramu) ---
  const [autoRunning, setAutoRunning] = useState(false);
  const runAuto = async () => {
    if (!activeFile || !activeFileId) return;
    setAutoRunning(true);
    try {
      const bitmap = await createImageBitmap(activeFile.file, { resizeWidth: 320, resizeQuality: 'medium' });
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const auto = computeAutoAdjust(ctx.getImageData(0, 0, c.width, c.height).data);
      setEditsById((prev) => ({ ...prev, [activeFileId]: { ...(prev[activeFileId] || INITIAL_EDITS), ...auto } }));
    } catch (e) {
      console.error('Auto adjust failed:', e);
      addNotification(t.msg_error, 'error');
    } finally {
      setAutoRunning(false);
    }
  };

  // --- Export ---
  const canUseNativeSave = supportsNativeSavePicker();
  const buildExport = useCallback(async (file: UploadedFile) => {
    const url = URL.createObjectURL(file.file);
    try {
      const blob = await applyEditsAndExport(url, editsById[file.id] || INITIAL_EDITS, exportOptions);
      return { blob, fileName: buildEditedFileName(file.file.name, exportOptions.format) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [editsById, exportOptions]);

  const withBusy = async (label: string, job: () => Promise<void>) => {
    setBusyLabel(label);
    try {
      await job();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error('Export failed:', e);
      addNotification(`${t.export_failed}: ${e instanceof Error ? e.message : ''}`, 'error');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleDownload = () => withBusy(t.export_running, async () => {
    if (!activeFile) return;
    const { blob, fileName } = await buildExport(activeFile);
    downloadBlob(blob, fileName);
  });

  const handleSaveAs = () => withBusy(t.export_running, async () => {
    if (!activeFile) return;
    const { blob, fileName } = await buildExport(activeFile);
    await saveBlobWithPicker(blob, fileName, exportOptions.format);
    addNotification(t.export_saved_to_folder, 'info');
  });

  const handleExportAll = () => withBusy(t.export_batch_processing, async () => {
    const dir = supportsNativeDirectoryPicker() ? await pickDirectoryForSave() : null;
    const used = new Map<string, number>();
    for (let i = 0; i < files.length; i++) {
      setBusyLabel(`${t.export_batch_processing} ${i + 1}/${files.length}`);
      const { blob, fileName } = await buildExport(files[i]);
      const seen = used.get(fileName) || 0;
      used.set(fileName, seen + 1);
      const name = seen === 0 ? fileName : fileName.replace(/(\.[^.]+)?$/, `_${seen + 1}$1`);
      if (dir) await saveBlobToDirectory(dir, blob, name);
      else downloadBlob(blob, name);
    }
    addNotification(dir ? `${files.length} ${t.export_batch_saved_to_folder}` : t.export_batch_native_fallback, 'info');
  });

  // --- Navigace mezi fotkami a klávesy ---
  const goTo = useCallback((index: number) => {
    const target = files[index];
    if (!target || target.id === activeFileId) return;
    viewportRef.current?.clearMask();
    onSetActiveFileId(target.id);
  }, [files, activeFileId, onSetActiveFileId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (savingRef.current) return;
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (e.key === 'ArrowLeft') goTo(activeIndex - 1);
      if (e.key === 'ArrowRight') goTo(activeIndex + 1);
      if (mode === 'retouch' && e.key === '[') setBrushSize((s) => Math.max(8, Math.round(s / 1.2)));
      if (mode === 'retouch' && e.key === ']') setBrushSize((s) => Math.min(240, Math.round(s * 1.2)));
      if (e.key === '\\' && !e.repeat) setIsComparing(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') setIsComparing(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeIndex, goTo, mode, onUndo, onRedo]);

  if (!activeFile) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <p className="font-display text-3xl text-ink-100">{t.editor_no_image}</p>
        <button onClick={() => props.onNavigate({ view: 'upload' })} className="fm-btn-primary px-6">
          {t.editor_go_import}
        </button>
      </div>
    );
  }

  // V retuši se ukazuje originální soubor (plné rozlišení, bez posuvníků), aby
  // maska seděla na pixely, které se opravdu retušují.
  const viewportSrc = isComparing
    ? activeFile.originalPreviewUrl
    : mode === 'retouch'
      ? activeFile.previewUrl
      : editedPreviewUrl || activeFile.previewUrl;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Horní lišta */}
      <header className="relative z-20 flex h-14 flex-shrink-0 items-center gap-3 border-b border-hairline bg-ink-950/80 px-3 backdrop-blur-xl sm:px-5">
        <button onClick={props.onToggleSidebar} className="fm-icon-btn lg:hidden" aria-label="Menu">
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" /></svg>
        </button>
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate text-[13px] text-ink-100">{activeFile.file.name}</p>
          <p className="font-mono text-[11px] text-ink-500">{activeIndex + 1} / {files.length}</p>
        </div>
        <div className="flex-1 md:flex-none">
          <Segmented<Mode>
            value={mode}
            // Přes navigaci, ať s režimem drží krok i zvýraznění v postranním panelu.
            onChange={(m) => props.onNavigate({ view: 'editor', action: m === 'adjust' ? 'base-edit' : m })}
            options={[
              { value: 'adjust', label: t.editor_mode_adjust },
              { value: 'retouch', label: t.editor_mode_retouch },
              { value: 'export', label: t.editor_mode_export },
            ]}
          />
        </div>
        <div className="flex flex-1 items-center justify-end gap-1">
          <button onClick={onUndo} disabled={history.past.length === 0 || retouching || savingRetouch} className="fm-icon-btn" title={`${t.retouch_undo} (Ctrl+Z)`}>
            <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M7.5 5 3.5 9l4 4M4 9h8a4.5 4.5 0 0 1 0 9h-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={onRedo} disabled={history.future.length === 0 || retouching} className="fm-icon-btn" title="Ctrl+Shift+Z">
            <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] -scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M7.5 5 3.5 9l4 4M4 9h8a4.5 4.5 0 0 1 0 9h-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            onPointerDown={() => setIsComparing(true)}
            onPointerUp={() => setIsComparing(false)}
            onPointerLeave={() => setIsComparing(false)}
            className={`fm-chip ml-1 ${isComparing ? 'is-active' : ''}`}
            title={`${t.editor_compare_hint} (\\)`}
          >
            {t.editor_compare}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Plátno */}
        <main className="fm-stage relative min-h-[45vh] flex-1">
          <CanvasViewport
            ref={viewportRef}
            imageSrc={viewportSrc}
            activeTool={mode === 'retouch' && !isComparing ? retouchTool : 'none'}
            brushSize={brushSize}
            brushHardness={brushHardness / 100}
            onStrokeEnd={() => runRetouch()}
            onLassoClick={onLassoClick}
            processing={retouching}
          />
          {isComparing && <span className="fm-chip is-active pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">{t.editor_original}</span>}
          {mode === 'retouch' && !retouching && !isComparing && (
            <p className="pointer-events-none absolute left-1/2 top-4 hidden -translate-x-1/2 rounded-full border border-hairline bg-ink-950/70 px-4 py-1.5 text-[12px] text-ink-200 backdrop-blur-md sm:block">
              {t.retouch_hint}
            </p>
          )}
          {(retouching || busyLabel) && (
            <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-hairline bg-ink-950/80 px-4 py-1.5 text-[12px] text-ink-100 backdrop-blur-md">
              <span className="fm-spinner" />
              {busyLabel || (modelStatus.state === 'downloading' ? t.retouch_downloading : modelStatus.state === 'preparing' ? t.retouch_preparing : t.retouch_running)}
            </div>
          )}
        </main>

        {/* Panel */}
        <aside className="fm-panel w-full flex-shrink-0 overflow-y-auto custom-scrollbar lg:w-[clamp(300px,24vw,420px)]">
          {mode === 'adjust' && (
            <AdjustPanel
              edits={manualEdits}
              previewUrl={editedPreviewUrl}
              onChange={setEdit}
              onAuto={runAuto}
              isAutoRunning={autoRunning}
              onReset={() => activeFileId && setEditsById((prev) => ({ ...prev, [activeFileId]: { ...INITIAL_EDITS, watermark: manualEdits.watermark } }))}
            />
          )}
          {mode === 'retouch' && (
            <RetouchPanel
              model={model}
              onModelChange={changeModel}
              modelStatus={modelStatus}
              brushSize={brushSize}
              onBrushSizeChange={setBrushSize}
              brushHardness={brushHardness}
              onBrushHardnessChange={setBrushHardness}
              strength={retouchStrength}
              onStrengthChange={setRetouchStrength}
              isProcessing={retouching}
              lastRunMs={lastRunMs}
              canUndo={history.past.length > 0 && !savingRetouch}
              onUndo={onUndo}
              onPromptSubmit={runPromptRetouch}
              promptHistory={promptHistory}
              fileCount={files.length}
              batchProgress={batchProgress}
              tool={retouchTool}
              onToolChange={changeRetouchTool}
              lasso={{
                status: lassoStatus,
                busy: lassoBusy,
                objectCount: lassoObjects.length,
                level: lassoObjects.length ? lassoObjects[lassoObjects.length - 1].level : null,
                levelCount: lassoObjects.length ? lassoObjects[lassoObjects.length - 1].candidates.length : 0,
                onLevelChange: changeLassoLevel,
                onRemove: removeLassoSelection,
                onClear: () => setLassoObjects([]),
                onFindByText: findByText,
              }}
            />
          )}
          {mode === 'export' && (
            <ExportPanel
              options={exportOptions}
              onOptionsChange={setExportOptions}
              watermark={manualEdits.watermark}
              onWatermarkChange={(wm) => {
                // Vodoznak platí pro celou sadu — typicky jde o podpis fotografa.
                setEditsById((prev) => {
                  const next = { ...prev };
                  for (const f of files) next[f.id] = { ...(prev[f.id] || INITIAL_EDITS), watermark: wm };
                  return next;
                });
              }}
              fileCount={files.length}
              canUseNativeSave={canUseNativeSave}
              onDownload={handleDownload}
              onSaveAs={handleSaveAs}
              onExportAll={handleExportAll}
              busy={!!busyLabel}
            />
          )}
        </aside>
      </div>

      {/* Filmový pás */}
      {files.length > 1 && (
        <nav className="flex h-[76px] flex-shrink-0 items-center gap-2 overflow-x-auto border-t border-hairline bg-ink-950 px-4 custom-scrollbar" aria-label={t.editor_filmstrip}>
          {files.map((f, i) => (
            <button
              key={f.id}
              onClick={() => goTo(i)}
              className={`fm-thumb ${f.id === activeFileId ? 'is-active' : ''}`}
              title={f.file.name}
            >
              <img src={f.previewUrl} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
};

export default EditorView;
