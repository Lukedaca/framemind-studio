import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Header from './Header';
import FloatingDock from './editor/FloatingDock';
import RadialMenu from './editor/RadialMenu';
import CanvasViewport, { type RetouchTool, type CanvasViewportHandle } from './editor/CanvasViewport';
import RetouchToolbar from './editor/RetouchToolbar';
import RetouchPrompt from './editor/RetouchPrompt';
import CinematicLoader from './common/CinematicLoader';
import ManualEditControls from './ManualEditControls';
import Histogram from './Histogram';
import CompareSlider from './CompareSlider';
import {
    UndoIcon,
    UploadIcon,
    AutopilotIcon,
    SparklesIcon,
    YoutubeIcon,
    MicrophoneIcon,
    HistoryIcon,
    ExportIcon,
    EraserIcon,
    AutoCropIcon,
    BackgroundReplacementIcon,
    StyleTransferIcon // Assume this exists or use Sparkles
} from './icons';
import type {
    UploadedFile,
    EditorAction,
    History,
    Preset,
    ManualEdits,
    View,
    AIGalleryType,
    AutoCropSuggestion,
    QualityAssessment,
    YouTubeThumbnailTemplate,
} from '../types';
import * as geminiService from '../services/geminiService';
import { runAutopilot } from '../services/aiAutopilot';
import { applyEditsAndExport } from '../utils/imageProcessor';
import { getImageDimensionsFromBlob, saveAIGalleryAsset } from '../utils/aiGallery';
import {
    buildEditedFileName,
    downloadBlob,
    pickDirectoryForSave,
    saveBlobToDirectory,
    saveBlobWithPicker,
    supportsNativeDirectoryPicker,
    supportsNativeSavePicker,
    type SupportedExportFormat
} from '../utils/fileSave';
import { useTranslation } from '../contexts/LanguageContext';
import { updateUserTendencies } from '../services/userProfileService';

interface EditorViewProps {
  files: UploadedFile[];
  activeFileId: string | null;
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  onSetActiveFileId: (id: string | null) => void;
  activeAction: EditorAction;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  userPresets: Preset[];
  onPresetsChange: (presets: Preset[]) => void;
  history: History;
  onUndo: () => void;
  onRedo: () => void;
  onNavigate: (payload: { view: View; action?: string }) => void;
  onOpenApiKeyModal: () => void;
  onToggleSidebar: () => void;
  credits: number;
  onDeductCredits: (amount: number) => Promise<boolean>;
  onBuyCredits?: () => void;
  currentProjectId?: string | null;
}

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
  watermark: { enabled: false, text: '', opacity: 50, size: 20, position: 'bottom-right', color: '#ffffff' }
};

const EditorView: React.FC<EditorViewProps> = (props) => {
  const { files, activeFileId, onSetFiles, onSetActiveFileId, activeAction, addNotification, credits, onDeductCredits, history, onUndo, onRedo, onNavigate, onOpenApiKeyModal, currentProjectId } = props;
  const { t: trans, language } = useTranslation();

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [manualEdits, setManualEdits] = useState<ManualEdits>(INITIAL_EDITS);
  const [exportOptions, setExportOptions] = useState<{ format: SupportedExportFormat; quality: number; scale: number }>({ format: 'jpeg', quality: 90, scale: 1 });
  const [isComparing, setIsComparing] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [autoCropSuggestions, setAutoCropSuggestions] = useState<AutoCropSuggestion[]>([]);
  const [autoCropSelectedIndex, setAutoCropSelectedIndex] = useState(0);
  const [liveSuggestions, setLiveSuggestions] = useState<string[]>([]);
  const [qualityAssessment, setQualityAssessment] = useState<QualityAssessment | null>(null);
  const [showBgModal, setShowBgModal] = useState(false);
  const [bgPrompt, setBgPrompt] = useState('');
  const [autoCropImageSize, setAutoCropImageSize] = useState<{ width: number; height: number } | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number } | null>(null);
  const [retouchTool, setRetouchTool] = useState<RetouchTool>('none');
  const [retouchBrushSize, setRetouchBrushSize] = useState(40);
  const [retouchHasMask, setRetouchHasMask] = useState(false);
  const [retouchProcessing, setRetouchProcessing] = useState(false);
  const [retouchPromptHistory, setRetouchPromptHistory] = useState<string[]>([]);
  const [retouchBatchProgress, setRetouchBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [isRetouchMode, setIsRetouchMode] = useState(false);
  const canvasViewportRef = useRef<CanvasViewportHandle>(null);
  const lastAutoCropAtRef = useRef<number | null>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const createdUrlsRef = useRef<string[]>([]);
  const createTrackedUrl = useCallback((blob: Blob) => {
      const url = URL.createObjectURL(blob);
      createdUrlsRef.current.push(url);
      return url;
  }, []);
  const revokeTrackedUrl = useCallback((url: string) => {
      URL.revokeObjectURL(url);
      createdUrlsRef.current = createdUrlsRef.current.filter((item) => item !== url);
  }, []);
  
  // YouTube Thumbnail State
  const [thumbnailTopic, setThumbnailTopic] = useState('');
  const [thumbnailText, setThumbnailText] = useState('');
  const [thumbnailTemplate, setThumbnailTemplate] = useState<YouTubeThumbnailTemplate>('shock-face');
  const [thumbnailResolution, setThumbnailResolution] = useState<'1K' | '2K' | '4K'>('2K');
  const [thumbnailFormat, setThumbnailFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  const [thumbnailReferenceFile, setThumbnailReferenceFile] = useState<File | null>(null);
  const [thumbnailReferencePreview, setThumbnailReferencePreview] = useState<string | null>(null);

  const activeFile = useMemo(() => files.find(f => f.id === activeFileId), [files, activeFileId]);
  const isYouTubeMode = activeAction?.action === 'youtube-thumbnail';
  const isExportMode = activeAction?.action === 'export';
  const canUseNativeSave = supportsNativeSavePicker();
  const canUseNativeBatchSave = supportsNativeDirectoryPicker();
  const thumbnailTemplates: Array<{ id: YouTubeThumbnailTemplate; title: string; description: string }> = [
      { id: 'shock-face', title: trans.tool_youtube_template_shock_face, description: trans.tool_youtube_template_shock_face_desc },
      { id: 'authority-clean', title: trans.tool_youtube_template_authority_clean, description: trans.tool_youtube_template_authority_clean_desc },
      { id: 'split-drama', title: trans.tool_youtube_template_split_drama, description: trans.tool_youtube_template_split_drama_desc },
      { id: 'cinematic-poster', title: trans.tool_youtube_template_cinematic_poster, description: trans.tool_youtube_template_cinematic_poster_desc },
  ];
  const thumbnailResolutions: Array<'1K' | '2K' | '4K'> = ['1K', '2K', '4K'];
  const thumbnailFormats: Array<'jpeg' | 'png' | 'webp'> = ['jpeg', 'png', 'webp'];


  useEffect(() => {
      return () => {
          createdUrlsRef.current.forEach((url) => {
              URL.revokeObjectURL(url);
          });
          createdUrlsRef.current = [];
      };
  }, []);

  // Exit retouch mode when navigating to another action
  useEffect(() => {
    if (activeAction?.action && activeAction.action !== 'retouch') {
      setIsRetouchMode(false);
    }
  }, [activeAction]);

  useEffect(() => {
      return () => {
          if (editedPreviewUrl && editedPreviewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(editedPreviewUrl);
          }
      };
  }, [editedPreviewUrl]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
        if (!isYouTubeMode) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    handleSetReferenceFile(blob);
                    addNotification('Screenshot vložen ze schránky', 'info');
                    break;
                }
            }
        }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isYouTubeMode, trans]);

  useEffect(() => {
    if (!activeFile) return;
    setQualityAssessment(activeFile.assessment || null);

    const currentFileId = activeFile.id;
    const currentUrl = activeFile.previewUrl;
    let isCancelled = false;

    const apply = async () => {
        try {
            const blob = await applyEditsAndExport(
                currentUrl,
                manualEdits,
                { format: 'jpeg', quality: 90, scale: 0.5 }
            );
            if (isCancelled) return;
            const stillExists = files.find(f => f.id === currentFileId);
            if (!stillExists) return;
            const url = createTrackedUrl(blob);
            setEditedPreviewUrl(url);
        } catch (e) {
            if (!isCancelled) {
                console.error('Preview generation failed:', e);
            }
        }
    };

    const t = setTimeout(apply, 150);
    return () => {
        isCancelled = true;
        clearTimeout(t);
    };
  }, [activeFile?.id, activeFile?.previewUrl, manualEdits, files, createTrackedUrl]);

  const handleBackgroundRemoval = async () => {
    if (!activeFile) return;
    const COST = 4;
    if (!await onDeductCredits(COST)) return;

    setIsLoading(true);
    setLoadingMessage(trans.editor_removing_bg);
    try {
        const { file: newFile } = await geminiService.removeBackground(activeFile.file);
        const url = createTrackedUrl(newFile);
        onSetFiles(current => current.map(f => f.id === activeFileId ? { ...f, file: newFile, previewUrl: url } : f), 'Background Removal');
        addNotification(trans.msg_success, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
    }
  };

  const handleBackgroundReplace = async () => {
    if (!activeFile) return;
    if (!bgPrompt.trim()) return;
    const COST = 5;
    if (!await onDeductCredits(COST)) return;
    setIsLoading(true);
    setLoadingMessage(trans.editor_replacing_bg);
    try {
        const { file: newFile } = await geminiService.replaceBackground(activeFile.file, bgPrompt.trim());
        const url = createTrackedUrl(newFile);
        onSetFiles(current => current.map(f => f.id === activeFileId ? { ...f, file: newFile, previewUrl: url } : f), trans.editor_bg_replace);
        setBgPrompt('');
        setShowBgModal(false);
        addNotification(trans.msg_success, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
    }
  };

  const handleFaceEnhance = async () => {
    if (!activeFile) return;
    const COST = 3;
    if (!await onDeductCredits(COST)) return;
    setIsLoading(true);
    setLoadingMessage(trans.editor_enhancing_faces);
    try {
        const { file: newFile } = await geminiService.enhanceFaces(activeFile.file);
        const url = createTrackedUrl(newFile);
        onSetFiles(current => current.map(f => f.id === activeFileId ? { ...f, file: newFile, previewUrl: url } : f), 'Face Enhancement');
        addNotification(trans.msg_success, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
    }
  };

  const handleScorePhoto = async () => {
    if (!activeFile) return;
    const COST = 2;
    if (!await onDeductCredits(COST)) return;
    setIsLoading(true);
    setLoadingMessage(trans.editor_scoring);
    try {
        const result = await geminiService.assessQuality(activeFile.file);
        setQualityAssessment(result);
        onSetFiles(current => current.map(f => f.id === activeFileId ? { ...f, assessment: result } : f), 'Photo Scoring');
        addNotification(trans.msg_success, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
    }
  };

  // --- Retouch handlers ---
  const handleRetouchPrompt = async (prompt: string, batch: boolean) => {
    if (!activeFile) return;

    if (batch && files.length > 1) {
      // Batch retouch all files
      const totalCost = 3 * files.length;
      if (!await onDeductCredits(totalCost)) return;

      setRetouchProcessing(true);
      setIsLoading(true);
      setRetouchBatchProgress({ current: 0, total: files.length });

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setRetouchBatchProgress({ current: i + 1, total: files.length });
        setLoadingMessage(language === 'cs'
          ? `AI retušuje ${i + 1}/${files.length}...`
          : `AI retouching ${i + 1}/${files.length}...`);
        try {
          const result = await geminiService.retouchWithPrompt(file.file, prompt);
          const newUrl = URL.createObjectURL(result.file);
          onSetFiles((prev) => prev.map(f =>
            f.id === file.id ? { ...f, file: result.file, previewUrl: newUrl } : f
          ), `Batch retouch ${i + 1}/${files.length}: ${prompt}`);
          if (file.id === activeFileId) {
            setEditedPreviewUrl(newUrl);
          }
          successCount++;
        } catch {
          failCount++;
        }
      }

      setRetouchPromptHistory(prev => [prompt, ...prev.filter(p => p !== prompt)].slice(0, 10));
      const msg = language === 'cs'
        ? `Hromadná retuš: ${successCount} OK${failCount > 0 ? `, ${failCount} chyb` : ''}`
        : `Batch retouch: ${successCount} OK${failCount > 0 ? `, ${failCount} failed` : ''}`;
      addNotification(msg, failCount > 0 ? 'error' : 'info');
      setRetouchProcessing(false);
      setIsLoading(false);
      setRetouchBatchProgress(null);
    } else {
      // Single file retouch
      const COST = 3;
      if (!await onDeductCredits(COST)) return;

      setRetouchProcessing(true);
      setIsLoading(true);
      setLoadingMessage(language === 'cs' ? 'AI retušuje...' : 'AI retouching...');
      try {
        const result = await geminiService.retouchWithPrompt(activeFile.file, prompt);
        const newUrl = URL.createObjectURL(result.file);
        setEditedPreviewUrl(newUrl);
        onSetFiles((prev) => prev.map(f =>
          f.id === activeFile.id ? { ...f, file: result.file, previewUrl: newUrl } : f
        ), `Retouch: ${prompt}`);
        setRetouchPromptHistory(prev => [prompt, ...prev.filter(p => p !== prompt)].slice(0, 10));
        addNotification(language === 'cs' ? 'Retuš dokončena' : 'Retouch complete', 'info');
      } catch (e: any) {
        const raw = e?.message || '';
        const isSafety = raw.startsWith('SAFETY_BLOCKED:');
        const isPatchFail = raw.startsWith('PATCH_FALLBACK_FAILED:');
        let friendly: string;
        if (isPatchFail) {
          // Patch flow nezvládl - ukázat konkrétní hint
          const detail = raw.replace('PATCH_FALLBACK_FAILED:', '').trim();
          friendly = language === 'cs'
            ? `Lokální retuš selhala: ${detail}`
            : `Local retouch failed: ${detail}`;
        } else if (isSafety) {
          // Safety block, který ani patch flow neobešel
          friendly = language === 'cs'
            ? 'AI zablokovala i lokální retuš. Zkus masku (štětec) — namaluj přes oblast a aplikuj.'
            : 'AI blocked even local retouch. Try the mask brush — paint over the area and apply.';
        } else {
          friendly = language === 'cs' ? `Retuš se nepovedla: ${raw}` : `Retouch failed: ${raw}`;
        }
        addNotification(friendly, 'error');
        console.error('Retouch error:', e);
      } finally {
        setRetouchProcessing(false);
        setIsLoading(false);
      }
    }
  };

  const handleRetouchMask = async () => {
    if (!activeFile || !canvasViewportRef.current) return;
    const maskDataUrl = canvasViewportRef.current.getMaskDataUrl();
    if (!maskDataUrl) return;

    const COST = 3;
    if (!await onDeductCredits(COST)) return;

    setRetouchProcessing(true);
    setIsLoading(true);
    setLoadingMessage(language === 'cs' ? 'AI retušuje vybranou oblast...' : 'AI retouching selected area...');
    try {
      // Extract base64 from data URL
      const maskBase64 = maskDataUrl.split(',')[1];
      const result = await geminiService.retouchWithMask(activeFile.file, maskBase64);
      const newUrl = URL.createObjectURL(result.file);
      setEditedPreviewUrl(newUrl);
      onSetFiles((prev) => prev.map(f =>
        f.id === activeFile.id ? { ...f, file: result.file, previewUrl: newUrl } : f
      ), 'Retouch (mask selection)');
      canvasViewportRef.current.clearMask();
      setRetouchHasMask(false);
      addNotification(language === 'cs' ? 'Retuš dokončena' : 'Retouch complete', 'info');
    } catch (e: any) {
      addNotification(`Retouch error: ${e.message}`, 'error');
    } finally {
      setRetouchProcessing(false);
      setIsLoading(false);
    }
  };

  const handleAutopilot = async () => {
    if (!activeFile) return;
    const COST = 3;
    if (!await onDeductCredits(COST)) return;

    setIsLoading(true);
    setLoadingMessage(trans.editor_ai_enhancing);
    try {
        const result = await runAutopilot(activeFile.file, 'auto', { autoCrop: true });
        const newFile = result.enhancedFile;
        if (!newFile) {
            throw new Error('AUTOPILOT_EMPTY_RESULT');
        }
        const url = createTrackedUrl(newFile);
        onSetFiles(current => current.map(f => f.id === activeFileId ? { ...f, file: newFile, previewUrl: url } : f), 'AI Autopilot');
        try {
            const { width, height } = await getImageDimensionsFromBlob(newFile);
            await saveAIGalleryAsset({
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                createdAt: new Date().toISOString(),
                type: 'autopilot' as AIGalleryType,
                prompt: 'Autopilot',
                sourceFileId: activeFile.id,
                projectId: currentProjectId || null,
                fileName: newFile.name,
                mimeType: newFile.type,
                size: newFile.size,
                width,
                height,
                blob: newFile,
            });
        } catch (e) {
            console.error('Failed to save AI gallery item', e);
        }
        addNotification(trans.msg_success, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    }
    finally { setIsLoading(false); }
  };

  const handleAutoCrop = useCallback(async () => {
    if (!activeFile) return;
    const COST = 2;
    if (!await onDeductCredits(COST)) return;

    setIsLoading(true);
    setLoadingMessage(trans.editor_ai_crop_search);
    try {
        const { width, height } = await getImageDimensionsFromBlob(activeFile.file);
        const result = await geminiService.analyzeForAutoCrop(activeFile.file, { width, height });
        const best = result.suggestedCrops[0];
        if (!best?.rect) {
            throw new Error('Auto-crop analysis returned no suggestions');
        }
        setAutoCropSuggestions(result.suggestedCrops);
        setAutoCropSelectedIndex(0);
        setAutoCropImageSize({ width, height });
        setManualEdits(prev => ({
            ...prev,
            cropRect: best.rect,
            aspectRatio: undefined
        }));
        addNotification(trans.editor_autocrop_ready, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
    }
  }, [activeFile, addNotification, onDeductCredits, onOpenApiKeyModal, trans.msg_error]);

  const buildExportArtifactForFile = useCallback(async (file: UploadedFile, edits: ManualEdits) => {
    // Vytvoříme fresh blob URL přímo z File objektu — file.previewUrl může být revoked
    // useEffectem co generuje low-res preview (sdílí stejný URL string po retuši).
    const freshUrl = URL.createObjectURL(file.file);
    try {
      const blob = await applyEditsAndExport(freshUrl, edits, exportOptions);
      const fileName = buildEditedFileName(file.file.name, exportOptions.format);
      return { blob, fileName };
    } finally {
      URL.revokeObjectURL(freshUrl);
    }
  }, [exportOptions]);

  const buildManualExportArtifact = useCallback(async () => {
    if (!activeFile) {
      throw new Error('NO_ACTIVE_FILE');
    }

    return buildExportArtifactForFile(activeFile, manualEdits);
  }, [activeFile, buildExportArtifactForFile, manualEdits]);

  const handleManualExport = async () => {
    if (!activeFile) return;
    setIsLoading(true);
    try {
        const { blob, fileName } = await buildManualExportArtifact();
        downloadBlob(blob, fileName);
        addNotification(trans.msg_success, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        console.error('Manual export failed:', e);
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
            addNotification(trans.msg_error, 'error');
            return;
        }
        addNotification(language === 'cs' ? `Export selhal: ${message || 'neznámá chyba'}` : `Export failed: ${message || 'unknown error'}`, 'error');
    }
    finally { setIsLoading(false); }
  };

  const handleManualSaveAs = async () => {
    if (!activeFile) return;

    setIsLoading(true);
    setLoadingMessage(trans.export_save_as);

    try {
        const { blob, fileName } = await buildManualExportArtifact();

        if (!canUseNativeSave) {
            downloadBlob(blob, fileName);
            addNotification(trans.export_native_fallback, 'info');
            return;
        }

        await saveBlobWithPicker(blob, fileName, exportOptions.format);
        addNotification(trans.export_saved_to_folder, 'info');
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
            return;
        }

        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const handleBatchExport = useCallback(async () => {
    if (files.length === 0) return;

    setIsLoading(true);
    setLoadingMessage(trans.export_batch_processing);

    try {
        const directoryHandle = canUseNativeBatchSave ? await pickDirectoryForSave() : null;
        const usedNames = new Map<string, number>();
        let exportedCount = 0;

        const getUniqueFileName = (fileName: string) => {
            const seen = usedNames.get(fileName) || 0;
            usedNames.set(fileName, seen + 1);
            if (seen === 0) return fileName;
            const dotIndex = fileName.lastIndexOf('.');
            if (dotIndex === -1) return `${fileName}_${seen + 1}`;
            const base = fileName.slice(0, dotIndex);
            const ext = fileName.slice(dotIndex);
            return `${base}_${seen + 1}${ext}`;
        };

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const fileEdits = file.id === activeFileId ? manualEdits : INITIAL_EDITS;

            setLoadingMessage(`${trans.export_batch_processing} ${index + 1}/${files.length}`);
            const artifact = await buildExportArtifactForFile(file, fileEdits);
            const fileName = getUniqueFileName(artifact.fileName);

            if (directoryHandle) {
                await saveBlobToDirectory(directoryHandle, artifact.blob, fileName);
            } else {
                downloadBlob(artifact.blob, fileName);
            }
            exportedCount += 1;
        }

        if (directoryHandle) {
            addNotification(`${exportedCount} ${trans.export_batch_saved_to_folder}`, 'info');
        } else {
            addNotification(trans.export_batch_native_fallback, 'info');
        }
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
            return;
        }

        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  }, [
    activeFileId,
    addNotification,
    buildExportArtifactForFile,
    canUseNativeBatchSave,
    files,
    manualEdits,
    onOpenApiKeyModal,
    trans.export_batch_native_fallback,
    trans.export_batch_processing,
    trans.export_batch_saved_to_folder,
    trans.msg_error,
  ]);

  const handleSnapshot = () => {
    updateUserTendencies({
      brightness: manualEdits.brightness,
      contrast: manualEdits.contrast,
      saturation: manualEdits.saturation,
      vibrance: manualEdits.vibrance,
      shadows: manualEdits.shadows,
      highlights: manualEdits.highlights,
      clarity: manualEdits.clarity,
      sharpness: manualEdits.sharpness,
      noiseReduction: manualEdits.noiseReduction,
    });
    addNotification(trans.editor_style_saved, 'info');
  };

  const handleLearnStyle = () => {
      // Analyze current edits and save as style tendency
      updateUserTendencies({
          brightness: manualEdits.brightness,
          contrast: manualEdits.contrast,
          saturation: manualEdits.saturation,
          vibrance: manualEdits.vibrance,
          shadows: manualEdits.shadows,
          highlights: manualEdits.highlights,
          clarity: manualEdits.clarity,
          sharpness: manualEdits.sharpness,
          noiseReduction: manualEdits.noiseReduction
      });
      addNotification(trans.editor_style_saved_look, 'info');
  };

  useEffect(() => {
    if (activeAction?.action !== 'auto-crop') return;
    if (activeAction.timestamp === lastAutoCropAtRef.current) return;
    lastAutoCropAtRef.current = activeAction.timestamp;
    handleAutoCrop();
  }, [activeAction?.action, activeAction?.timestamp, handleAutoCrop]);

  const handleSmartSelect = async () => {
    if (!activeFile) return;
    const COST = 2;
    if (!await onDeductCredits(COST)) return;
    setIsLoading(true);
    setLoadingMessage(trans.editor_selecting_subject);
    try {
        const { width, height } = await getImageDimensionsFromBlob(activeFile.file);
        const result = await geminiService.analyzeForAutoCrop(activeFile.file, { width, height });
        if (!result.mainSubject) {
            throw new Error('No subject found');
        }
        setManualEdits(prev => ({
            ...prev,
            cropRect: result.mainSubject,
            aspectRatio: undefined
        }));
        addNotification(trans.editor_subject_selected, 'info');
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error');
    } finally {
        setIsLoading(false);
    }
  };

  // Voice Recognition
  useEffect(() => {
      if (!isVoiceActive) return;

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
          addNotification('Voice recognition not supported in this browser', 'error');
          setIsVoiceActive(false);
          return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = language === 'cs' ? 'cs-CZ' : 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
          if (!event.results || event.results.length === 0) return;
          const last = event.results.length - 1;
          const result = event.results[last];
          if (!result || !result[0]) return;

          const command = result[0].transcript.toLowerCase().trim();
          if (!command) return;

          if (command.includes('hey foto') || command.includes('hej foto') || command.includes('hey photo')) {
              addNotification('Hey Foto ready', 'info');
          }

          if (command.includes('jas') || command.includes('brightness')) {
              if (command.includes('víc') || command.includes('up')) {
                  setManualEdits(prev => ({...prev, brightness: Math.min(100, prev.brightness + 10)}));
              } else if (command.includes('méně') || command.includes('down')) {
                   setManualEdits(prev => ({...prev, brightness: Math.max(-100, prev.brightness - 10)}));
              }
          } else if (command.includes('auto crop') || command.includes('ořez') || command.includes('crop')) {
              handleAutoCrop();
          } else if (command.includes('remove background') || command.includes('remove bg') || command.includes('odstraň pozad')) {
              handleBackgroundRemoval();
          } else if (command.includes('replace background') || command.includes('vyměnit pozad')) {
              setShowBgModal(true);
          } else if (command.includes('face') || command.includes('obličej')) {
              handleFaceEnhance();
          } else if (command.includes('score') || command.includes('hodno')) {
              handleScorePhoto();
          } else if (command.includes('compare') || command.includes('porov')) {
              setIsComparing(prev => !prev);
          } else if (command.includes('export') || command.includes('stáhn')) {
              handleManualExport();
          } else if (command.includes('focus')) {
              setIsFocusMode(true);
          } else if (command.includes('exit focus') || command.includes('zruš focus') || command.includes('zpět')) {
              setIsFocusMode(false);
          } else if (command.includes('undo last 3') || command.includes('vrať poslední 3')) {
              onUndo(); onUndo(); onUndo();
          } else if (command.includes('undo') || command.includes('zpět')) {
              onUndo();
          } else if (command.includes('reset')) {
              setManualEdits(INITIAL_EDITS);
          }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.error('Speech recognition error:', event.error);
          const errorMessages: Record<string, string> = {
              'no-speech': 'No speech detected - try speaking louder',
              'audio-capture': 'Microphone not available',
              'not-allowed': 'Microphone permission denied',
              'network': 'Network error - check connection',
          };
          const message = errorMessages[event.error] || `Voice error: ${event.error}`;
          addNotification(message, 'error');
          if (event.error === 'not-allowed' || event.error === 'audio-capture') {
              setIsVoiceActive(false);
          }
      };

      recognition.onend = () => {
          if (isVoiceActive) {
              try {
                  recognition.start();
              } catch (e) {
                  // already started
              }
          }
      };

      try {
          recognition.start();
      } catch (e) {
          addNotification('Failed to start voice recognition', 'error');
          setIsVoiceActive(false);
      }

      return () => {
          try {
              recognition.stop();
          } catch (e) {
              // already stopped
          }
      };
  }, [isVoiceActive, language, addNotification, handleAutoCrop, handleBackgroundRemoval, handleFaceEnhance, handleManualExport, handleScorePhoto, onUndo]);

  useEffect(() => {
    const suggestions: string[] = [];
    if (manualEdits.brightness > 25 && manualEdits.highlights < 10) {
      suggestions.push(trans.suggestion_lower_highlights);
    }
    if (manualEdits.brightness < -20 && manualEdits.shadows < 10) {
      suggestions.push(trans.suggestion_raise_shadows);
    }
    if (manualEdits.saturation > 35 && manualEdits.vibrance < 10) {
      suggestions.push(trans.suggestion_raise_vibrance);
    }
    if (manualEdits.sharpness > 60 && manualEdits.noiseReduction < 10) {
      suggestions.push(trans.suggestion_add_noise_reduction);
    }
    if (manualEdits.contrast < -20) {
      suggestions.push(trans.suggestion_raise_contrast);
    }
    if (manualEdits.cropRect && !manualEdits.aspectRatio) {
      suggestions.push(trans.suggestion_crop_tip);
    }
    setLiveSuggestions(suggestions.slice(0, 3));
  }, [manualEdits, trans]);

  const switchToFile = useCallback((file: UploadedFile) => {
    onSetActiveFileId(file.id);
    setEditedPreviewUrl(null);
    setManualEdits(INITIAL_EDITS);
    setAutoCropSuggestions([]);
    setAutoCropImageSize(null);
    setQualityAssessment(file.assessment || null);
  }, [onSetActiveFileId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFocusMode(false);
        setRadialMenu(null);
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && files.length > 1) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        const idx = files.findIndex(f => f.id === activeFileId);
        if (event.key === 'ArrowLeft' && idx > 0) {
          switchToFile(files[idx - 1]);
        } else if (event.key === 'ArrowRight' && idx < files.length - 1) {
          switchToFile(files[idx + 1]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [files, activeFileId, switchToFile]);

  useEffect(() => {
    if (autoCropSuggestions.length === 0) return;
    const handleKey = (event: KeyboardEvent) => {
        if (event.key === '1' || event.key === '2' || event.key === '3') {
            const idx = Number(event.key) - 1;
            const suggestion = autoCropSuggestions[idx];
            if (!suggestion) return;
            setAutoCropSelectedIndex(idx);
            setManualEdits(prev => ({
                ...prev,
                cropRect: suggestion.rect,
                aspectRatio: undefined
            }));
        }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [autoCropSuggestions]);

  const handleGenerateThumbnail = async () => {
    if (!thumbnailTopic.trim()) { addNotification(trans.tool_youtube_topic_ph, 'error'); return; }
    const COST = 10;
    if (!await onDeductCredits(COST)) return;
    setIsLoading(true);
    setLoadingMessage(trans.editor_generating_thumbnail);
    try {
        const { file } = await geminiService.generateYouTubeThumbnail(thumbnailTopic, thumbnailText, { 
            template: thumbnailTemplate,
            resolution: thumbnailResolution, 
            format: thumbnailFormat,
            referenceFile: thumbnailReferenceFile || undefined
        });
        const previewUrl = createTrackedUrl(file);
        const newUploadedFile: UploadedFile = { id: `yt-${Date.now()}`, file, previewUrl, originalPreviewUrl: previewUrl };
        onSetFiles(prev => [...prev, newUploadedFile], 'YouTube Thumbnail Creation');
        onSetActiveFileId(newUploadedFile.id);
        try {
            const { width, height } = await getImageDimensionsFromBlob(file);
            await saveAIGalleryAsset({
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                createdAt: new Date().toISOString(),
                type: 'youtube-thumbnail' as AIGalleryType,
                prompt: `Template: ${thumbnailTemplate}
Topic: ${thumbnailTopic}
Text: ${thumbnailText}${thumbnailReferenceFile ? '\n(Used visual reference)' : ''}`,
                projectId: currentProjectId || null,
                fileName: file.name,
                mimeType: file.type,
                size: file.size,
                width,
                height,
                blob: file,
            });
        } catch (e) {
            console.error('Failed to save AI gallery item', e);
        }
        addNotification(trans.msg_success, 'info');
    } catch (e) { 
        console.error('Thumbnail generation failed:', e);
        const message = e instanceof Error ? e.message : '';
        if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal();
        }
        addNotification(trans.msg_error, 'error'); 
    }
    finally { setIsLoading(false); }
  };

  const handleSetReferenceFile = (file: File) => {
    setThumbnailReferenceFile(file);
    if (thumbnailReferencePreview) revokeTrackedUrl(thumbnailReferencePreview);
    setThumbnailReferencePreview(createTrackedUrl(file));
  };

  const handleClearReference = () => {
    setThumbnailReferenceFile(null);
    if (thumbnailReferencePreview) {
        revokeTrackedUrl(thumbnailReferencePreview);
        setThumbnailReferencePreview(null);
    }
  };

  const handleUseActiveFileAsReference = async () => {
    if (!activeFile) return;
    handleSetReferenceFile(activeFile.file);
    addNotification('Aktuální fotka nastavena jako reference.', 'info');
  };

  if (!activeFile && !isYouTubeMode) {
    return (
      <div className="flex-1 flex flex-col h-full">
         <Header title={trans.app_title} onToggleSidebar={props.onToggleSidebar} credits={credits} />
         <div className="flex-1 flex flex-col items-center justify-center text-text-secondary p-8 text-center">
            <div className="p-6 bg-surface mb-6 border border-border-subtle rounded-3xl">
                <UploadIcon className="w-16 h-16 opacity-30" />
            </div>
            <p className="text-xl font-bold text-text-primary">{trans.editor_no_image}</p>
         </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
        {!isFocusMode && (
          <Header title={isYouTubeMode ? "YouTube Studio" : trans.nav_studio} onToggleSidebar={props.onToggleSidebar} credits={credits} onBuyCredits={props.onBuyCredits} />
        )}
        
        {/* Quick Start Ribbon */}
        {!isFocusMode && !isYouTubeMode && activeFile && (
          <div className="bg-void border-b border-border-subtle py-2 px-8 flex items-center gap-4 overflow-x-auto custom-scrollbar">
            <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary mr-2">{trans.editor_quick_actions}</span>
            <button onClick={handleAutopilot} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <AutopilotIcon className="w-3.5 h-3.5" />
              {trans.editor_basic_edit}
            </button>
            <button onClick={() => setIsRetouchMode(true)} className={`flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm ${isRetouchMode ? 'border-accent bg-accent/20 text-accent' : 'border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10'}`}>
              <EraserIcon className="w-3.5 h-3.5" />
              {trans.editor_retouch}
            </button>
            <button onClick={() => onNavigate({ view: 'editor', action: 'auto-crop' })} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <AutoCropIcon className="w-3.5 h-3.5" />
              {trans.editor_auto_crop}
            </button>
            <button onClick={handleBackgroundRemoval} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <BackgroundReplacementIcon className="w-3.5 h-3.5" />
              {trans.editor_remove_bg}
            </button>
            <button onClick={() => setShowBgModal(true)} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <BackgroundReplacementIcon className="w-3.5 h-3.5" />
              {trans.editor_replace_bg}
            </button>
            <button onClick={handleSmartSelect} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <SparklesIcon className="w-3.5 h-3.5" />
              {trans.editor_select_subject}
            </button>
            <button onClick={handleFaceEnhance} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <SparklesIcon className="w-3.5 h-3.5" />
              {trans.editor_enhance_face}
            </button>
            <button onClick={handleScorePhoto} className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <SparklesIcon className="w-3.5 h-3.5" />
              {trans.editor_score}
            </button>
            <button onClick={() => onNavigate({ view: 'editor', action: 'export' })} className="ml-auto flex-shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent hover:bg-accent/10 transition-all text-[11px] font-bold uppercase tracking-widest shadow-sm">
              <ExportIcon className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        )}

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
            {/* Viewport */}
            <div
              className="flex-1 bg-surface/60 relative overflow-hidden flex flex-col"
              onContextMenu={(e) => {
                e.preventDefault();
                if (isYouTubeMode || !activeFile) return;
                setRadialMenu({ x: e.clientX, y: e.clientY });
              }}
            >
                {/* Retouch toolbar + mode toggle — hidden in export mode */}
                {!isYouTubeMode && !isExportMode && activeFile && (
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface/80 backdrop-blur-sm z-20">
                    <button
                      onClick={() => setIsRetouchMode(!isRetouchMode)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all border ${
                        isRetouchMode
                          ? 'bg-accent/20 text-accent border-accent/40'
                          : 'bg-elevated text-text-secondary border-border-subtle hover:text-text-primary hover:border-accent'
                      }`}
                    >
                      <EraserIcon className="w-3.5 h-3.5" />
                      {language === 'cs' ? 'Retuš' : 'Retouch'}
                    </button>

                    {isRetouchMode && (
                      <RetouchToolbar
                        activeTool={retouchTool}
                        onToolChange={setRetouchTool}
                        brushSize={retouchBrushSize}
                        onBrushSizeChange={setRetouchBrushSize}
                        onClearMask={() => {
                          canvasViewportRef.current?.clearMask();
                          setRetouchHasMask(false);
                        }}
                        onApplyMask={handleRetouchMask}
                        hasMask={retouchHasMask}
                        isProcessing={retouchProcessing}
                      />
                    )}

                    {!isRetouchMode && (
                      <>
                        <button onClick={() => setIsVoiceActive(!isVoiceActive)} className={`p-2 rounded-lg border border-border-subtle transition-all ${isVoiceActive ? 'bg-accent text-void' : 'bg-elevated text-text-secondary hover:text-text-primary'}`}>
                          <MicrophoneIcon className="w-4 h-4" />
                        </button>
                        <button onMouseDown={() => setIsComparing(true)} onMouseUp={() => setIsComparing(false)} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider bg-elevated text-text-secondary border border-border-subtle rounded-lg hover:text-text-primary hover:border-accent transition-all">
                          {trans.compare_btn}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Canvas viewport */}
                <div className="flex-1 relative">
                  {activeFile ? (
                    isComparing ? (
                      <div className="w-full h-full flex items-center justify-center p-6">
                        <CompareSlider beforeUrl={activeFile.originalPreviewUrl} afterUrl={editedPreviewUrl || activeFile.previewUrl} />
                      </div>
                    ) : (
                      <CanvasViewport
                        ref={canvasViewportRef}
                        imageSrc={editedPreviewUrl || activeFile.previewUrl}
                        activeTool={isRetouchMode ? retouchTool : 'none'}
                        brushSize={retouchBrushSize}
                        onMaskReady={() => setRetouchHasMask(true)}
                      />
                    )
                  ) : isYouTubeMode ? (
                    <div className="w-full h-full flex items-center justify-center p-6">
                      <div className="w-full h-full border-2 border-dashed border-accent/40 rounded-3xl flex flex-col items-center justify-center bg-surface group">
                        <div className="p-8 bg-elevated rounded-full mb-6">
                          <YoutubeIcon className="w-20 h-20 text-red-600 opacity-20" />
                        </div>
                        <h2 className="text-2xl font-black text-text-secondary tracking-tighter uppercase">Studio miniatur</h2>
                      </div>
                    </div>
                  ) : null}

                  {/* Auto-crop overlay */}
                  {!isYouTubeMode && autoCropSuggestions.length > 0 && (
                    <div className="absolute bottom-4 left-4 z-40 bg-surface/90 backdrop-blur border border-border-subtle p-4 rounded-2xl shadow-xl">
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-accent">{trans.editor_ai_crop}</div>
                            <button
                                onClick={() => {
                                    setAutoCropSuggestions([]);
                                    setAutoCropImageSize(null);
                                    setManualEdits(prev => ({ ...prev, cropRect: undefined }));
                                }}
                                className="text-[10px] text-text-secondary hover:text-text-primary"
                            >
                                {trans.editor_cancel}
                            </button>
                        </div>
                        <div className="flex gap-2">
                            {autoCropSuggestions.slice(0, 3).map((item, index) => (
                                <button
                                    key={`${item.aspectRatio}-${index}`}
                                    onClick={() => {
                                        setAutoCropSelectedIndex(index);
                                        setManualEdits(prev => ({
                                            ...prev,
                                            cropRect: item.rect,
                                            aspectRatio: undefined
                                        }));
                                    }}
                                    className={`px-3 py-2 text-[11px] font-bold border rounded-lg transition-all ${
                                        autoCropSelectedIndex === index
                                            ? 'bg-elevated border-accent text-text-primary shadow-sm'
                                            : 'bg-elevated border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent'
                                    }`}
                                >
                                    {index + 1}. {item.aspectRatio}
                                    <span className="ml-2 text-[10px] text-text-secondary">{Math.round((item.confidence || 0) * 100)}%</span>
                                </button>
                            ))}
                        </div>
                        <div className="mt-2 text-[10px] text-text-secondary">{trans.editor_shortcuts}</div>
                    </div>
                  )}

                  {isLoading && (
                    <div className="absolute inset-0 bg-void/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
                        <CinematicLoader label={loadingMessage || 'Processing'} />
                    </div>
                  )}
                </div>

                {/* Retouch prompt bar — hidden in export mode */}
                {isRetouchMode && !isExportMode && activeFile && (
                  <div className="px-4 py-2 border-t border-border-subtle bg-surface/80 backdrop-blur-sm">
                    <RetouchPrompt
                      onSubmit={handleRetouchPrompt}
                      isProcessing={retouchProcessing}
                      lastPrompts={retouchPromptHistory}
                      fileCount={files.length}
                      batchProgress={retouchBatchProgress}
                    />
                  </div>
                )}
            </div>

            {/* Controls Sidebar */}
            <AnimatePresence>
            {!isFocusMode && (
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full lg:w-[420px] bg-surface border-l border-border-subtle flex flex-col z-20 overflow-y-auto custom-scrollbar"
            >
                
                {/* Job Log (Recent History) */}
                <div className="px-8 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary">{trans.editor_edit_log}</h4>
                    <div className="flex gap-2">
                      <button onClick={onUndo} disabled={history.past.length === 0} className="p-1.5 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-30"><UndoIcon className="w-3 h-3" /></button>
                      <button onClick={onRedo} disabled={history.future.length === 0} className="p-1.5 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-30"><UndoIcon className="w-3 h-3 rotate-180" /></button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-24 overflow-y-auto mb-6">
                    {history.past.slice(-3).map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px] text-text-secondary">
                        <HistoryIcon className="w-3 h-3" />
                        <span>{h.actionName}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-[10px] text-accent font-bold">
                        <SparklesIcon className="w-3 h-3" />
                        <span>{history.present.actionName}</span>
                    </div>
                  </div>
                </div>

                {!isYouTubeMode && activeFile && (
                    <div className="px-8">
                        <Histogram imageUrl={editedPreviewUrl || activeFile.previewUrl} />
                    </div>
                )}

                {!isYouTubeMode && activeFile && (
                    <div className="px-8 mt-4">
                        <div className="p-4 border border-border-subtle bg-elevated rounded-2xl shadow-sm">
                            <div className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-2">{trans.editor_ai_recommendations}</div>
                            {liveSuggestions.length === 0 ? (
                                <div className="text-xs text-text-secondary">{trans.editor_looks_good}</div>
                            ) : (
                                <div className="space-y-2">
                                    {liveSuggestions.map((item, idx) => (
                                        <div key={`${item}-${idx}`} className="text-xs text-text-secondary">
                                            • {item}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {!isYouTubeMode && activeFile && (
                    <div className="px-8 mt-4">
                        <div className="p-4 border border-border-subtle bg-surface rounded-2xl shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] font-black uppercase tracking-widest text-text-secondary">{trans.editor_ai_score}</div>
                                <button onClick={handleScorePhoto} className="text-[10px] text-text-secondary hover:text-text-primary">{trans.editor_run}</button>
                            </div>
                            {qualityAssessment ? (
                                <div className="space-y-2 text-xs text-text-secondary">
                                    <div className="flex items-center justify-between">
                                        <span>Skóre</span>
                                        <span className="text-text-primary font-bold">{qualityAssessment.score}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span>Best Pick</span>
                                        <span className="text-text-primary font-bold">{qualityAssessment.isBestPick ? 'Yes' : 'No'}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {(qualityAssessment.flags || []).slice(0, 6).map((flag) => (
                                            <span key={flag} className="px-2 py-1 border border-border-subtle bg-elevated rounded-md text-[10px] text-text-secondary">
                                                {flag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-text-secondary">{trans.editor_no_score}</div>
                            )}
                        </div>
                    </div>
                )}

                <div className="p-8 space-y-8 pt-2">
                    {isYouTubeMode && (
                        <div className="space-y-6 animate-fade-in-right">
                             <div className="space-y-2">
                                <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest ml-1">{trans.tool_youtube_topic}</label>
                                <textarea rows={3} value={thumbnailTopic} onChange={(e) => setThumbnailTopic(e.target.value)} placeholder={trans.tool_youtube_topic_ph} className="w-full bg-elevated border border-border-subtle rounded-xl p-4 text-sm text-text-primary outline-none placeholder:text-text-secondary" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest ml-1">{trans.tool_youtube_text}</label>
                                <input type="text" value={thumbnailText} onChange={(e) => setThumbnailText(e.target.value)} placeholder={trans.tool_youtube_text_ph} className="w-full bg-elevated border border-border-subtle rounded-xl p-4 text-sm text-text-primary outline-none placeholder:text-text-secondary" />
                                <div className={`text-[10px] ml-1 ${thumbnailText.trim().length > 42 ? 'text-amber-400' : 'text-text-secondary'}`}>
                                    {thumbnailText.trim().length > 42
                                        ? trans.tool_youtube_text_hint_long
                                        : trans.tool_youtube_text_hint}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest ml-1">{trans.tool_youtube_template}</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {thumbnailTemplates.map((template) => {
                                        const isActive = thumbnailTemplate === template.id;
                                        return (
                                            <button
                                                key={template.id}
                                                onClick={() => setThumbnailTemplate(template.id)}
                                                className={`text-left rounded-2xl border p-4 transition-all ${
                                                    isActive
                                                        ? 'border-accent bg-accent/10 shadow-[0_0_20px_rgba(99,102,241,0.18)]'
                                                        : 'border-border-subtle bg-elevated hover:border-accent/40 hover:bg-surface'
                                                }`}
                                            >
                                                <div className="text-[11px] font-black uppercase tracking-wider text-text-primary">{template.title}</div>
                                                <div className="mt-2 text-[11px] leading-relaxed text-text-secondary">{template.description}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest ml-1">{trans.tool_youtube_quality}</label>
                                    <div className="flex gap-2">
                                        {thumbnailResolutions.map((resolution) => (
                                            <button
                                                key={resolution}
                                                onClick={() => setThumbnailResolution(resolution)}
                                                className={`flex-1 rounded-xl border px-3 py-3 text-[11px] font-black uppercase tracking-wider transition-all ${
                                                    thumbnailResolution === resolution
                                                        ? 'border-accent bg-accent text-void'
                                                        : 'border-border-subtle bg-elevated text-text-secondary hover:border-accent/40 hover:text-text-primary'
                                                }`}
                                            >
                                                {resolution}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest ml-1">{trans.tool_youtube_format}</label>
                                    <div className="flex gap-2">
                                        {thumbnailFormats.map((format) => (
                                            <button
                                                key={format}
                                                onClick={() => setThumbnailFormat(format)}
                                                className={`flex-1 rounded-xl border px-3 py-3 text-[11px] font-black uppercase tracking-wider transition-all ${
                                                    thumbnailFormat === format
                                                        ? 'border-accent bg-accent text-void'
                                                        : 'border-border-subtle bg-elevated text-text-secondary hover:border-accent/40 hover:text-text-primary'
                                                }`}
                                            >
                                                {format}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3 p-1">
                                <label className="text-[10px] font-black text-accent uppercase tracking-widest ml-1 flex items-center gap-2">
                                    <SparklesIcon className="w-3 h-3" />
                                    {trans.tool_youtube_ref_title}
                                </label>
                                
                                {thumbnailReferencePreview ? (
                                    <div className="relative group rounded-xl overflow-hidden border-2 border-accent shadow-[0_0_15px_rgba(139,92,246,0.3)] bg-accent/5 aspect-video">
                                        <img src={thumbnailReferencePreview} alt="Reference" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm">
                                            <button onClick={handleClearReference} className="px-4 py-2 bg-red-500 text-white text-[10px] font-bold uppercase rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2">
                                                <EraserIcon className="w-4 h-4" />
                                                {trans.tool_youtube_ref_remove}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <div 
                                            onClick={() => document.getElementById('ref-upload')?.click()}
                                            className="border-2 border-dashed border-border-subtle hover:border-accent hover:shadow-[0_0_15px_rgba(139,92,246,0.2)] bg-elevated/50 hover:bg-accent/5 rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all group"
                                        >
                                            <div className="p-3 rounded-full bg-surface border border-border-subtle group-hover:border-accent group-hover:bg-accent/10 transition-all">
                                                <UploadIcon className="w-6 h-6 text-text-secondary group-hover:text-accent" />
                                            </div>
                                            <div className="text-center">
                                                <span className="block text-[11px] text-text-primary font-black uppercase tracking-wider mb-1">{trans.tool_youtube_ref_upload}</span>
                                                <span className="block text-[9px] text-text-secondary uppercase tracking-tighter">{trans.tool_youtube_ref_paste}</span>
                                            </div>
                                            <input 
                                                id="ref-upload" 
                                                type="file" 
                                                accept="image/*" 
                                                className="hidden" 
                                                onChange={(e) => e.target.files?.[0] && handleSetReferenceFile(e.target.files[0])} 
                                            />
                                        </div>
                                        
                                        {activeFile && (
                                            <button 
                                                onClick={handleUseActiveFileAsReference}
                                                className="w-full py-2.5 px-3 border border-border-subtle bg-surface hover:bg-elevated hover:border-accent/50 rounded-xl text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-text-primary transition-all flex items-center justify-center gap-2"
                                            >
                                                <HistoryIcon className="w-3.5 h-3.5" />
                                                {trans.tool_youtube_ref_current}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                             <div className="flex items-center justify-between text-xs text-text-secondary">
                                <span>{trans.credits_cost}:</span>
                                <span className="font-bold text-warning">10 {trans.credits_remaining}</span>
                             </div>
                             <button onClick={handleGenerateThumbnail} disabled={isLoading} className="w-full py-4 bg-accent text-void text-sm font-black border border-accent rounded-xl transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-3 disabled:opacity-50">
                                <SparklesIcon className="w-5 h-5" />
                                {trans.tool_youtube_btn}
                            </button>
                            {activeFile && (
                                <div className="pt-4 border-t border-border-subtle space-y-3">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Export</h4>
                                    {canUseNativeSave && (
                                        <button
                                            onClick={handleManualSaveAs}
                                            className="w-full py-3 bg-elevated text-text-primary text-sm font-bold border border-border-subtle rounded-xl flex items-center justify-center gap-2 transition-all hover:border-accent"
                                        >
                                            <ExportIcon className="w-4 h-4" />
                                            {trans.export_save_as}
                                        </button>
                                    )}
                                    <button
                                        onClick={handleManualExport}
                                        className="w-full py-3 bg-accent text-void text-sm font-bold border border-accent rounded-xl flex items-center justify-center gap-2 transition-all"
                                    >
                                        <ExportIcon className="w-4 h-4" />
                                        {trans.export_btn}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {!isYouTubeMode && activeFile && (
                        <>
                         <ManualEditControls
                           edits={manualEdits}
                           onEditChange={(k, v) => setManualEdits(p => ({...p, [k]: v}))}
                           onReset={() => setManualEdits(INITIAL_EDITS)}
                           exportOptions={exportOptions}
                           onExportOptionsChange={setExportOptions}
                           onRequestExport={handleManualExport}
                           onRequestBatchExport={handleBatchExport}
                           onRequestSaveAs={handleManualSaveAs}
                           canBatchExport={files.length > 1}
                           canUseNativeSave={canUseNativeSave}
                           onStartManualCrop={() => {}}
                           onSnapshot={handleSnapshot}
                           cropRef={cropRef}
                           lightRef={lightRef}
                           colorRef={colorRef}
                           detailRef={detailRef}
                           exportRef={exportRef}
                         />
                         
                         {/* LEARN STYLE BUTTON */}
                         <div className="pt-4 border-t border-border-subtle">
                             <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-3">{trans.editor_ai_personalization}</h4>
                             <button
                                onClick={handleLearnStyle}
                                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-900 to-fuchsia-900 border border-violet-700 hover:border-violet-500 text-white text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_15px_rgba(139,92,246,0.5)]"
                             >
                                 <StyleTransferIcon className="w-4 h-4" />
                                 {trans.editor_learn_style}
                             </button>
                             <p className="text-[10px] text-text-secondary mt-2 text-center">
                                 {trans.editor_learn_style_desc}
                             </p>
                         </div>
                        </>
                    )}
                </div>
            </motion.div>
            )}
            </AnimatePresence>
        </div>

        {/* Filmstrip - photo switcher (top-level, always visible) */}
        {!isFocusMode && !isYouTubeMode && files.length > 1 && (
          <div className="flex-shrink-0 bg-void border-t border-b border-border-subtle">
            <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto custom-scrollbar">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary mr-1 flex-shrink-0">
                {files.findIndex(f => f.id === activeFileId) + 1}/{files.length}
              </span>
              {files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    if (f.id === activeFileId) return;
                    switchToFile(f);
                  }}
                  className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                    f.id === activeFileId
                      ? 'border-accent shadow-lg shadow-accent/20 scale-105'
                      : 'border-border-subtle opacity-60 hover:opacity-100 hover:border-text-secondary'
                  }`}
                >
                  <img
                    src={f.previewUrl}
                    alt={f.file.name}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </button>
              ))}
              <div className="flex-shrink-0 flex items-center gap-1 ml-2">
                <button
                  onClick={() => {
                    const idx = files.findIndex(f => f.id === activeFileId);
                    if (idx > 0) switchToFile(files[idx - 1]);
                  }}
                  disabled={files.findIndex(f => f.id === activeFileId) <= 0}
                  className="p-1.5 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-30 transition-all"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <button
                  onClick={() => {
                    const idx = files.findIndex(f => f.id === activeFileId);
                    if (idx < files.length - 1) switchToFile(files[idx + 1]);
                  }}
                  disabled={files.findIndex(f => f.id === activeFileId) >= files.length - 1}
                  className="p-1.5 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-30 transition-all"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {!isFocusMode && !isYouTubeMode && activeFile && (
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
              <FloatingDock
                items={[
                  { id: 'crop', label: 'Crop', onClick: () => cropRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
                  { id: 'light', label: 'Light', onClick: () => lightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
                  { id: 'color', label: 'Color', onClick: () => colorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
                  { id: 'detail', label: 'Detail', onClick: () => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
                  { id: 'export', label: 'Export', onClick: () => exportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
                ]}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {isFocusMode && (
          <div className="absolute top-4 right-6 z-40">
            <button
              onClick={() => setIsFocusMode(false)}
              className="px-3 py-2 text-[11px] font-bold border border-border-subtle bg-surface text-text-secondary hover:text-text-primary hover:bg-elevated rounded-full shadow-lg transition-all"
            >
              Exit Focus
            </button>
          </div>
        )}

        <AnimatePresence>
          {radialMenu && (
            <RadialMenu
              x={radialMenu.x}
              y={radialMenu.y}
              onClose={() => setRadialMenu(null)}
              items={[
                { id: 'autopilot', label: 'Autopilot', onClick: handleAutopilot },
                { id: 'retouch', label: trans.editor_retouch, onClick: () => setIsRetouchMode(true) },
                { id: 'auto-crop', label: trans.editor_auto_crop, onClick: handleAutoCrop },
                { id: 'select-subject', label: trans.editor_select_subject, onClick: handleSmartSelect },
                { id: 'remove-bg', label: trans.editor_remove_bg, onClick: handleBackgroundRemoval },
                { id: 'replace-bg', label: trans.editor_replace_bg, onClick: () => setShowBgModal(true) },
                { id: 'face', label: trans.editor_enhance_face, onClick: handleFaceEnhance },
                { id: 'score', label: trans.editor_ai_score, onClick: handleScorePhoto },
                { id: 'compare', label: isComparing ? trans.editor_stop_compare : trans.editor_compare, onClick: () => setIsComparing((p) => !p) },
                { id: 'export', label: 'Export', onClick: handleManualExport },
              ]}
            />
          )}
        </AnimatePresence>

        {showBgModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg border border-border-subtle bg-surface rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-black uppercase tracking-widest text-text-secondary">{trans.editor_replace_bg}</div>
                <button onClick={() => setShowBgModal(false)} className="text-xs text-text-secondary hover:text-text-primary">{trans.editor_close}</button>
              </div>
              <textarea
                rows={4}
                value={bgPrompt}
                onChange={(e) => setBgPrompt(e.target.value)}
                placeholder={trans.editor_bg_placeholder}
                className="w-full bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary outline-none focus:border-accent"
              />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[11px] text-text-secondary">{trans.editor_bg_cost}</span>
                <button
                  onClick={handleBackgroundReplace}
                  className="px-4 py-2 text-[11px] font-bold bg-accent text-void rounded-lg hover:bg-accent/80 transition-all"
                >
                  {trans.editor_apply}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default EditorView;
