import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon } from './icons';
import Header from './Header';
import { isRawFile, processRawFile, RAW_EXTENSIONS_STRING } from '../utils/rawProcessor';
import { useTranslation } from '../contexts/LanguageContext';

interface UploadViewProps {
  onFilesSelected: (files: File[]) => void;
  projectName?: string;
  title: string;
  onToggleSidebar: () => void;
  addNotification?: (message: string, type: 'info' | 'error') => void;
}

const UploadView: React.FC<UploadViewProps> = ({ 
  onFilesSelected, 
  projectName,
  title,
  onToggleSidebar,
  addNotification
}) => {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  // RAW soubory čekající na konverzi. showDirectoryPicker vyžaduje čerstvou
  // user activation — z change eventu file inputu ho volat NEJDE (SecurityError),
  // proto mezikrok s tlačítkem: klik = nová aktivace = picker projde.
  const [pendingRawFiles, setPendingRawFiles] = useState<File[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const processFiles = (incomingFiles: File[]) => {
      const rawFiles = incomingFiles.filter(f => isRawFile(f));
      const normalFiles = incomingFiles.filter(f => !isRawFile(f));

      // Normální soubory rovnou do editoru
      if (normalFiles.length > 0) {
          onFilesSelected(normalFiles);
      }

      // RAW soubory → mezikrok s volbou (konverze startuje až kliknutím)
      if (rawFiles.length > 0) {
          setPendingRawFiles(rawFiles);
      }
  };

  const convertRawFiles = async (rawFiles: File[], dirHandle: any | null) => {
      setPendingRawFiles(null);
      setIsProcessing(true);
      const convertedFiles: File[] = [];
      let errors = 0;

      for (let i = 0; i < rawFiles.length; i++) {
          const file = rawFiles[i];
          setProcessingStatus(`${t.upload_raw_converting}: ${file.name} (${i + 1}/${rawFiles.length})`);
          try {
              const convertedFile = await processRawFile(file);

              if (dirHandle) {
                  const fh = await dirHandle.getFileHandle(convertedFile.name, { create: true });
                  const writable = await fh.createWritable();
                  await writable.write(convertedFile);
                  await writable.close();
              }

              convertedFiles.push(convertedFile);
          } catch (error: any) {
              errors++;
              if (addNotification) {
                  addNotification(`${file.name}: ${error.message || 'Konverze selhala'}`, 'error');
              }
          }
      }

      setIsProcessing(false);
      setProcessingStatus('');

      if (convertedFiles.length > 0) {
          if (addNotification) {
              addNotification(
                  dirHandle
                      ? `${convertedFiles.length} RAW → JPEG uloženo do ${dirHandle.name}/`
                      : `${convertedFiles.length} RAW → JPEG převedeno.`,
                  'info'
              );
          }
          onFilesSelected(convertedFiles);
      } else if (errors > 0) {
          if (addNotification) {
              addNotification('Konverze RAW souborů selhala.', 'error');
          }
      }
  };

  // Klik na tlačítko = čerstvá user activation, tady už picker projde.
  const handleConvertWithFolder = async () => {
      if (!pendingRawFiles) return;
      let dirHandle: any;
      try {
          // @ts-ignore - File System Access API
          dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e: any) {
          if (e.name === 'AbortError') return; // zrušeno uživatelem, mezikrok zůstává
          if (addNotification) addNotification('Nepodařilo se otevřít složku.', 'error');
          return;
      }
      await convertRawFiles(pendingRawFiles, dirHandle);
  };

  const handleConvertOnly = () => {
      if (!pendingRawFiles) return;
      convertRawFiles(pendingRawFiles, null);
  };

  // @ts-ignore - File System Access API
  const folderPickerSupported = typeof window !== 'undefined' && !!window.showDirectoryPicker;

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files: File[] = Array.from(e.dataTransfer.files);
      processFiles(files);
      e.dataTransfer.clearData();
    }
  }, [onFilesSelected, addNotification]);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files: File[] = Array.from(e.target.files);
      processFiles(files);
    }
    // Reset — jinak opakovaný výběr stejných souborů nevystřelí change event
    e.target.value = '';
  };
  
  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex h-full w-full flex-col">
      <Header title={title} eyebrow={projectName} onToggleSidebar={onToggleSidebar} />
      <div className="flex w-full flex-1 items-center justify-center p-4 sm:p-10">
        {isProcessing ? (
          <div className="fm-surface flex flex-col items-center rounded-3xl px-12 py-14 text-center animate-fade-in">
            <span className="fm-spinner mb-6 h-6 w-6" />
            <h3 className="font-display text-3xl text-ink-50">{t.upload_processing}</h3>
            <p className="mt-2 font-mono text-xs text-ink-400">{processingStatus}</p>
          </div>
        ) : pendingRawFiles ? (
          <div className="fm-surface w-full max-w-xl rounded-3xl p-10 text-center animate-fade-in">
            <h3 className="font-display text-3xl text-ink-50">{t.upload_raw_pending_title}</h3>
            <p className="mt-3 text-sm text-ink-300">
              {pendingRawFiles.length}× RAW ({pendingRawFiles.slice(0, 3).map(f => f.name).join(', ')}{pendingRawFiles.length > 3 ? '…' : ''})
            </p>
            <p className="mb-8 mt-2 text-sm leading-relaxed text-ink-400">{t.upload_raw_pending_desc}</p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              {folderPickerSupported && (
                <button onClick={handleConvertWithFolder} className="fm-btn-primary px-5">{t.upload_raw_convert_save}</button>
              )}
              <button onClick={handleConvertOnly} className="fm-btn-ghost">{t.upload_raw_convert_only}</button>
              <button onClick={() => setPendingRawFiles(null)} className="fm-icon-btn w-auto px-4 text-[13px]">{t.upload_raw_cancel}</button>
            </div>
          </div>
        ) : (
          <div
            className={`relative flex w-full max-w-4xl flex-col items-center justify-center overflow-hidden rounded-[28px] border px-6 py-20 text-center transition-all duration-300 sm:px-16 ${
              isDragging ? 'border-accent/60 bg-accent/[0.06]' : 'border-hairline bg-ink-900/60'
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Rohy hledáčku místo čárkovaného okraje */}
            {['left-5 top-5 border-l border-t', 'right-5 top-5 border-r border-t', 'left-5 bottom-5 border-l border-b', 'right-5 bottom-5 border-r border-b'].map((c) => (
              <span key={c} className={`pointer-events-none absolute h-6 w-6 ${c} ${isDragging ? 'border-accent' : 'border-ink-500'} transition-colors`} />
            ))}
            <p className="fm-eyebrow">{t.pipeline_step_import}</p>
            <h3 className="mt-4 font-display text-[40px] leading-tight text-ink-50 sm:text-[52px]">{t.upload_drag}</h3>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-400" dangerouslySetInnerHTML={{ __html: t.upload_support_detail }} />
            <input ref={fileInputRef} type="file" multiple accept={`image/*,${RAW_EXTENSIONS_STRING}`} onChange={handleFileSelect} className="hidden" />
            <button type="button" onClick={onButtonClick} className="fm-btn-primary mt-10 h-12 px-7 text-[14px]">
              <UploadIcon className="h-4 w-4" />
              {t.upload_select_files}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadView;