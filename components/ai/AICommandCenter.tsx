import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import Header from '../Header';
import CompareSlider from '../CompareSlider';
import { SparklesIcon } from '../icons';
import { useTranslation } from '../../contexts/LanguageContext';
import type { EnhancementMode, UploadedFile } from '../../types';
import { runAutopilot } from '../../services/aiAutopilot';
import MagneticButton from '../common/MagneticButton';

interface AICommandCenterProps {
  title: string;
  onToggleSidebar: () => void;
  credits?: number;
  onBuyCredits?: () => void;
  onOpenApiKeyModal?: () => void;
  files: UploadedFile[];
  activeFileId: string | null;
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  onSetActiveFileId: (id: string | null) => void;
  onDeductCredits: (amount: number) => Promise<boolean>;
  addNotification: (message: string, type?: 'info' | 'error') => void;
}

type BatchProgress = {
  current: number;
  total: number;
  activeFileName: string;
};

const AUTOPILOT_COST = 3;

const AICommandCenter: React.FC<AICommandCenterProps> = ({
  title,
  onToggleSidebar,
  credits,
  onBuyCredits,
  onOpenApiKeyModal,
  files,
  activeFileId,
  onSetFiles,
  onSetActiveFileId,
  onDeductCredits,
  addNotification,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EnhancementMode>('auto');
  const [smartAutoCrop, setSmartAutoCrop] = useState(true);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [stylePresets, setStylePresets] = useState<{ id: string; name: string }[]>([]);
  const hasInitializedSelection = useRef(false);
  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId) || null, [files, activeFileId]);
  const selectedFiles = useMemo(() => {
    const selectedIds = new Set(selectedFileIds);
    return files.filter((file) => selectedIds.has(file.id));
  }, [files, selectedFileIds]);
  const enhancedPreviewUrl = activeFile && activeFile.previewUrl !== activeFile.originalPreviewUrl
    ? activeFile.previewUrl
    : null;
  const totalCreditCost = selectedFiles.length * AUTOPILOT_COST;

  useEffect(() => {
    if (!activeFileId && files.length > 0) {
      onSetActiveFileId(files[0].id);
    }
  }, [activeFileId, files, onSetActiveFileId]);

  useEffect(() => {
    if (files.length === 0) {
      hasInitializedSelection.current = false;
      setSelectedFileIds([]);
      return;
    }

    const availableIds = new Set(files.map((file) => file.id));
    setSelectedFileIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      if (next.length !== current.length) {
        return next;
      }
      if (!hasInitializedSelection.current && next.length === 0) {
        hasInitializedSelection.current = true;
        if (activeFileId && availableIds.has(activeFileId)) {
          return [activeFileId];
        }
        return [files[0].id];
      }
      return current;
    });
  }, [activeFileId, files]);

  const modes: { id: EnhancementMode; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'portrait', label: t.aicc_mode_portrait },
    { id: 'landscape', label: t.aicc_mode_landscape },
    { id: 'product', label: t.aicc_mode_product },
    { id: 'food', label: t.aicc_mode_food },
    { id: 'real-estate', label: t.aicc_mode_realestate },
    { id: 'social-media', label: t.aicc_mode_social },
    { id: 'cinematic', label: t.aicc_mode_cinematic },
    { id: 'your-style', label: t.aicc_mode_yourstyle },
  ];

  const toggleFileSelection = useCallback((fileId: string) => {
    hasInitializedSelection.current = true;
    setSelectedFileIds((current) => (
      current.includes(fileId)
        ? current.filter((id) => id !== fileId)
        : [...current, fileId]
    ));
  }, []);

  const handleSelectAll = useCallback(() => {
    hasInitializedSelection.current = true;
    setSelectedFileIds(files.map((file) => file.id));
  }, [files]);

  const handleClearSelection = useCallback(() => {
    hasInitializedSelection.current = true;
    setSelectedFileIds([]);
  }, []);

  const handleSelectActiveOnly = useCallback(() => {
    if (!activeFileId) return;
    hasInitializedSelection.current = true;
    setSelectedFileIds([activeFileId]);
  }, [activeFileId]);

  const handleRun = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    const total = selectedFiles.length;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let interrupted = false;

    setIsRunning(true);
    setBatchProgress({ current: 0, total, activeFileName: selectedFiles[0].file.name });

    try {
      for (const file of selectedFiles) {
        setBatchProgress({ current: processed, total, activeFileName: file.file.name });

        const hasCredits = await onDeductCredits(AUTOPILOT_COST);
        if (!hasCredits) {
          interrupted = true;
          break;
        }

        try {
          const result = await runAutopilot(file.file, mode, { autoCrop: smartAutoCrop });
          setStylePresets(result.stylePresets.map((preset) => ({ id: preset.id, name: preset.name })));

          if (!result.enhancedFile) {
            failed += 1;
            addNotification(`${t.batch_error}: ${file.file.name}`, 'error');
            continue;
          }

          const previousPreviewUrl = file.previewUrl.startsWith('blob:') && file.previewUrl !== file.originalPreviewUrl
            ? file.previewUrl
            : null;
          const previewUrl = URL.createObjectURL(result.enhancedFile);
          onSetFiles(
            (current) => current.map((currentFile) => (
              currentFile.id === file.id
                ? { ...currentFile, file: result.enhancedFile!, previewUrl }
                : currentFile
            )),
            `${t.aicc_title}: ${file.file.name}`
          );
          if (previousPreviewUrl) {
            setTimeout(() => URL.revokeObjectURL(previousPreviewUrl), 0);
          }
          succeeded += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : '';
          if (message.includes('API_KEY_MISSING') || message.toLowerCase().includes('api key')) {
            onOpenApiKeyModal?.();
            addNotification(t.msg_api_missing, 'error');
            interrupted = true;
            break;
          }
          addNotification(`${t.batch_error}: ${file.file.name}`, 'error');
        } finally {
          processed += 1;
          setBatchProgress({ current: processed, total, activeFileName: file.file.name });
        }
      }

      if (succeeded === total && failed === 0 && !interrupted) {
        addNotification(`${t.batch_complete} (${succeeded}/${total})`, 'info');
      } else if (succeeded > 0) {
        addNotification(`${t.aicc_batch_partial} (${succeeded}/${total})`, 'info');
      } else if (failed > 0 && !interrupted) {
        addNotification(`${t.aicc_batch_failed} (${failed}/${total})`, 'error');
      }
    } finally {
      setIsRunning(false);
      setBatchProgress(null);
    }
  }, [
    addNotification,
    mode,
    onDeductCredits,
    onOpenApiKeyModal,
    onSetFiles,
    selectedFiles,
    smartAutoCrop,
    t.aicc_batch_failed,
    t.aicc_batch_partial,
    t.aicc_title,
    t.batch_complete,
    t.batch_error,
    t.msg_api_missing,
  ]);

  return (
    <div className="flex-1 flex flex-col h-full text-text-primary">
      <Header
        title={title}
        onToggleSidebar={onToggleSidebar}
        credits={credits}
        onBuyCredits={onBuyCredits}
        onOpenApiKeyModal={onOpenApiKeyModal}
      />

      <div className="flex-1 grid lg:grid-cols-[1.2fr_0.8fr] gap-6 p-6 overflow-hidden">
        <div className="flex flex-col gap-6">
          <div className="border border-border-subtle bg-surface p-5">
            <div className="flex items-center justify-between mb-4 border-b border-border-subtle pb-3">
              <div>
                <h2 className="text-2xl heading">{t.aicc_title}</h2>
                <p className="text-xs text-text-secondary uppercase tracking-widest">{t.aicc_subtitle}</p>
              </div>
              <span className="text-[10px] font-mono text-text-secondary uppercase tracking-widest">{t.aicc_status}</span>
            </div>
            <div className="mb-4">
              <label className="text-[11px] text-text-secondary uppercase tracking-widest">{t.aicc_source_file}</label>
              <select
                value={activeFileId || ''}
                onChange={(e) => onSetActiveFileId(e.target.value || null)}
                disabled={isRunning}
                className="mt-2 w-full bg-elevated border border-border-subtle px-3 py-2 text-xs text-text-primary disabled:opacity-60"
              >
                {files.length === 0 && <option value="">{t.aicc_no_files}</option>}
                {files.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.file.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="border border-border-subtle bg-elevated p-4 mb-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-text-secondary uppercase tracking-widest">{t.batch_select}</span>
                <span className="text-[11px] text-text-secondary uppercase tracking-widest">
                  {selectedFiles.length} {t.batch_selected}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={isRunning || files.length === 0}
                  className="border border-border-subtle bg-surface px-3 py-2 text-[11px] uppercase tracking-widest text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-50"
                >
                  {t.batch_select_all}
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  disabled={isRunning || selectedFiles.length === 0}
                  className="border border-border-subtle bg-surface px-3 py-2 text-[11px] uppercase tracking-widest text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-50"
                >
                  {t.batch_deselect_all}
                </button>
                <button
                  type="button"
                  onClick={handleSelectActiveOnly}
                  disabled={isRunning || !activeFileId}
                  className="border border-border-subtle bg-surface px-3 py-2 text-[11px] uppercase tracking-widest text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-50"
                >
                  {t.aicc_select_active_only}
                </button>
              </div>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {files.length === 0 && (
                  <div className="border border-dashed border-border-subtle px-4 py-5 text-sm text-text-secondary">
                    {t.aicc_no_files}
                  </div>
                )}
                {files.map((file) => {
                  const isSelected = selectedFileIds.includes(file.id);
                  const isActive = file.id === activeFileId;
                  const isEnhanced = file.previewUrl !== file.originalPreviewUrl;

                  return (
                    <div
                      key={file.id}
                      className={`border p-2 transition-none ${
                        isActive ? 'border-accent bg-surface' : 'border-border-subtle bg-surface'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleFileSelection(file.id)}
                          disabled={isRunning}
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <button
                          type="button"
                          onClick={() => onSetActiveFileId(file.id)}
                          disabled={isRunning}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                        >
                          <img
                            src={file.previewUrl}
                            alt={file.file.name}
                            className="h-14 w-14 shrink-0 border border-border-subtle bg-void object-cover"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-text-primary">{file.file.name}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-widest text-text-secondary">
                              {isEnhanced ? t.aicc_ai_enhanced : t.aicc_original}
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {activeFile && enhancedPreviewUrl ? (
              <div className="aspect-[4/3] border border-border-subtle bg-elevated overflow-hidden">
                <CompareSlider beforeUrl={activeFile.originalPreviewUrl} afterUrl={enhancedPreviewUrl} />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="aspect-[4/3] border border-border-subtle bg-elevated flex items-center justify-center text-text-secondary text-sm overflow-hidden">
                  {activeFile ? (
                    <img src={activeFile.originalPreviewUrl} alt={t.aicc_original} className="w-full h-full object-contain" />
                  ) : (
                    t.aicc_original
                  )}
                </div>
                <div className="aspect-[4/3] border border-border-subtle bg-elevated flex items-center justify-center text-text-secondary text-sm overflow-hidden">
                  {enhancedPreviewUrl ? (
                    <img src={enhancedPreviewUrl} alt={t.aicc_ai_enhanced} className="w-full h-full object-contain" />
                  ) : (
                    t.aicc_ai_enhanced
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border border-border-subtle bg-surface p-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-text-secondary mb-4">{t.aicc_ai_analysis}</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {[t.aicc_exposure, t.aicc_colors, t.aicc_sharpness, t.aicc_composition].map((item) => (
                <div key={item} className="border border-border-subtle bg-elevated p-4">
                  <div className="text-xs text-text-secondary">{item}</div>
                  <div className="text-lg font-bold text-text-primary mt-2">—</div>
                  <div className="text-[11px] text-text-secondary mt-2">{t.aicc_awaiting}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="border border-border-subtle bg-surface p-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-text-secondary mb-4">{t.aicc_enhancement_modes}</h3>
            <div className="grid grid-cols-2 gap-3">
              {modes.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setMode(option.id)}
                  className={`border px-3 py-2 text-xs font-semibold transition-none ${
                    option.id === mode
                      ? 'border-accent text-text-primary bg-elevated'
                      : 'border-border-subtle bg-elevated text-text-secondary hover:text-text-primary hover:border-accent'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-4 border border-border-subtle bg-elevated p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-text-secondary">{t.aicc_autocrop_label}</div>
                  <p className="mt-1 text-xs text-text-secondary">{t.aicc_autocrop_hint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSmartAutoCrop((current) => !current)}
                  disabled={isRunning}
                  className={`border px-3 py-2 text-[11px] font-bold uppercase tracking-widest disabled:opacity-50 ${
                    smartAutoCrop
                      ? 'border-accent bg-surface text-text-primary'
                      : 'border-border-subtle bg-surface text-text-secondary'
                  }`}
                >
                  {smartAutoCrop ? t.aicc_autocrop_on : t.aicc_autocrop_off}
                </button>
              </div>
            </div>
            <MagneticButton
              className="mt-5 w-full py-3 font-bold text-void bg-accent flex items-center justify-center gap-2 disabled:opacity-50"
              disabled={isRunning || selectedFiles.length === 0}
              aria-disabled={isRunning || selectedFiles.length === 0}
              onClick={handleRun}
            >
              <SparklesIcon className="w-4 h-4" />
              {isRunning
                ? t.aicc_running
                : selectedFiles.length > 1
                  ? `${t.batch_run} ${selectedFiles.length}`
                  : t.aicc_run_autopilot}
            </MagneticButton>
            <p className="text-[11px] text-text-secondary mt-3">{t.credits_cost}: {totalCreditCost}</p>
            {batchProgress && (
              <div className="mt-3 border border-border-subtle bg-elevated p-3">
                <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-widest text-text-secondary">
                  <span>{t.batch_processing}</span>
                  <span>{batchProgress.current}/{batchProgress.total}</span>
                </div>
                <div className="mt-2 h-1 w-full bg-surface">
                  <div
                    className="h-full bg-accent transition-none"
                    style={{ width: `${batchProgress.total === 0 ? 0 : (batchProgress.current / batchProgress.total) * 100}%` }}
                  />
                </div>
                <p className="mt-2 truncate text-xs text-text-primary">{batchProgress.activeFileName}</p>
              </div>
            )}
          </div>

          <div className="border border-border-subtle bg-surface p-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-text-secondary mb-3">{t.aicc_recommendations}</h3>
            <div className="space-y-3 text-sm text-text-secondary">
              <div className="border border-border-subtle bg-elevated p-3">
                • {t.aicc_rec_contrast}
              </div>
              <div className="border border-border-subtle bg-elevated p-3">
                • {t.aicc_rec_crop}
              </div>
              <div className="border border-border-subtle bg-elevated p-3">
                • {t.aicc_rec_vignette}
              </div>
            </div>
          </div>

          <div className="border border-border-subtle bg-surface p-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-text-secondary mb-3">{t.aicc_style_presets}</h3>
            <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
              {(stylePresets.length > 0 ? stylePresets : [
                { id: 'default-1', name: t.preset_soft_light },
                { id: 'default-2', name: t.preset_vivid },
                { id: 'default-3', name: t.preset_matte },
              ]).map((preset) => (
                <div key={preset.id} className="min-w-[140px] border border-border-subtle bg-elevated p-4 text-xs text-text-secondary">
                  <div className="text-text-primary font-bold mb-2">{preset.name}</div>
                  <div className="text-[10px] text-text-secondary">AI preset</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AICommandCenter;
