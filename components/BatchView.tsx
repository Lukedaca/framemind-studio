
import React, { useState, useMemo } from 'react';
import type { UploadedFile } from '../types';
import { enhanceFaces } from '../services/geminiService';
import { SparklesIcon, StackIcon, CheckCircleIcon, FaceIcon } from './icons';
import Header from './Header';
import { useTranslation } from '../contexts/LanguageContext';

interface BatchViewProps {
  files: UploadedFile[];
  onBatchComplete: (updatedFiles: { id: string; file: File }[]) => void;
  onSetFiles: (updater: (files: UploadedFile[]) => UploadedFile[], actionName: string) => void;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  title: string;
  onOpenApiKeyModal: () => void;
  onToggleSidebar: () => void;
  mode?: 'culling' | 'batch';
}

// Helper to group files by time (simulating visual similarity)
const groupFilesByTime = (files: UploadedFile[], thresholdMs = 2000) => {
    const sorted = [...files].sort((a, b) => a.file.lastModified - b.file.lastModified);
    const groups: UploadedFile[][] = [];
    let currentGroup: UploadedFile[] = [];

    sorted.forEach((file, index) => {
        if (index === 0) {
            currentGroup.push(file);
            return;
        }
        const prev = sorted[index - 1];
        if (file.file.lastModified - prev.file.lastModified < thresholdMs) {
            currentGroup.push(file);
        } else {
            groups.push(currentGroup);
            currentGroup = [file];
        }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
};

const BatchView: React.FC<BatchViewProps> = ({ files, onBatchComplete, onSetFiles, addNotification, title, onToggleSidebar, onOpenApiKeyModal }) => {
  const { t, language } = useTranslation();
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set(files.map(f => f.id)));
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingAction, setProcessingAction] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  // Stacking Logic
  const fileGroups = useMemo(() => groupFilesByTime(files), [files]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const selectedFiles = useMemo(() => files.filter(f => selectedFileIds.has(f.id)), [files, selectedFileIds]);

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) newSet.delete(fileId);
      else newSet.add(fileId);
      return newSet;
    });
  };

  const toggleGroup = (index: number) => {
      setExpandedGroups(prev => {
          const next = new Set(prev);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          return next;
      });
  };

  // --- AI ACTIONS ---

  const handleSmartRetouch = async () => {
      if (selectedFiles.length === 0) return;
      setProcessingAction(t.batch_retouching);
      setIsProcessing(true);
      setProgress({ current: 0, total: selectedFiles.length });

      const updatedFiles: { id: string; file: File }[] = [];
      for (const file of selectedFiles) {
          try {
              const { file: newFile } = await enhanceFaces(file.file);
              updatedFiles.push({ id: file.id, file: newFile });
          } catch (e) {
              console.error(e);
          } finally {
              setProgress(prev => ({ ...prev, current: prev.current + 1 }));
          }
      }
      
      setIsProcessing(false);
      setProcessingAction(null);
      if (updatedFiles.length > 0) {
          onBatchComplete(updatedFiles);
          addNotification(t.batch_retouch_done, 'info');
      }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#050505] text-white overflow-hidden">
      <Header
        title="Batch Studio"
        onToggleSidebar={onToggleSidebar}
        onOpenApiKeyModal={onOpenApiKeyModal}
      />
      
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT PANEL: AI CONTROLS */}
        <div className="w-80 bg-[#0a0a0a] border-r border-[#1f1f1f] p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar z-10 shadow-2xl">
            
            {/* Context Card */}
            <div className="bg-[#151515] p-5 rounded-2xl shadow-lg border border-[#222]">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                    <SparklesIcon className="w-4 h-4 text-cyan-400" />
                    Batch Mode
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">{t.batch_batch_desc}</p>
            </div>

            {/* Actions */}
            <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">AI Tools</h3>
                
                <button
                    onClick={handleSmartRetouch}
                    disabled={isProcessing || selectedFiles.length === 0}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-pink-900 to-rose-900 border border-rose-800/50 hover:border-rose-500 text-white text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                >
                    <FaceIcon className="w-4 h-4" /> Smart Portrait Retouch
                </button>
                <button onClick={() => setSelectedFileIds(new Set(files.map(f => f.id)))} className="w-full py-2 bg-[#1a1a1a] rounded-lg border border-[#333] hover:bg-[#252525] text-[10px] text-gray-300 font-bold uppercase">{t.batch_select_all_btn}</button>
            </div>

            {/* Stats */}
            <div className="mt-auto bg-[#0f0f0f] rounded-xl p-4 border border-[#1f1f1f]">
                <div className="flex justify-between text-xs mb-2">
                    <span className="text-gray-500">Selected</span>
                    <span className="text-white font-mono">{selectedFiles.length} / {files.length}</span>
                </div>
                <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Stacks</span>
                    <span className="text-white font-mono">{fileGroups.length}</span>
                </div>
            </div>

        </div>

        {/* RIGHT PANEL: GRID / STACKS */}
        <div className="flex-1 bg-[#050505] p-8 overflow-y-auto custom-scrollbar relative">
            
            {/* Processing Overlay */}
            {isProcessing && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <div className="w-64 bg-[#111] rounded-2xl p-6 border border-[#333] shadow-2xl text-center">
                        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                        <h3 className="text-white font-bold text-sm mb-2">{processingAction || 'Processing...'}</h3>
                        <p className="text-gray-500 text-xs mb-4">{progress.current} / {progress.total}</p>
                        <div className="w-full bg-[#222] h-1 rounded-full overflow-hidden">
                            <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-7xl mx-auto space-y-8">
                {fileGroups.map((group, groupIdx) => {
                    const isStack = group.length > 1;
                    const isExpanded = expandedGroups.has(groupIdx);
                    const filesToShow = isStack && !isExpanded ? [group[0]] : group;

                    return (
                        <div key={groupIdx} className="animate-fade-in">
                            {isStack && (
                                <div className="flex items-center gap-2 mb-2 px-2">
                                    <button onClick={() => toggleGroup(groupIdx)} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                                        <StackIcon className="w-3 h-3" />
                                        <span className="font-bold">Burst Stack ({group.length})</span>
                                        <span className="text-[#333]">|</span>
                                        <span className="text-gray-500 text-[10px]">{new Date(group[0].file.lastModified).toLocaleTimeString()}</span>
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {filesToShow.map((file, idx) => (
                                    <div 
                                        key={file.id} 
                                        className={`group relative aspect-[3/4] rounded-lg overflow-hidden cursor-pointer transition-all duration-300 ${selectedFileIds.has(file.id) ? 'ring-2 ring-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)]' : 'hover:ring-1 hover:ring-gray-600'}`}
                                        onClick={() => toggleFileSelection(file.id)}
                                    >
                                        <img src={file.previewUrl} className={`w-full h-full object-cover transition-transform duration-500 ${selectedFileIds.has(file.id) ? 'scale-105' : 'group-hover:scale-105'}`} />
                                        
                                        {/* Overlay Gradient */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>

                                        {/* Status Indicators */}
                                        <div className="absolute top-2 left-2 flex gap-1">
                                            {file.assessment?.isBestPick && (
                                                <div className="bg-emerald-500/90 backdrop-blur-md text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow-lg">TOP PICK</div>
                                            )}
                                            {file.assessment && file.assessment.score < 50 && (
                                                <div className="bg-red-500/90 backdrop-blur-md text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow-lg">BLUR</div>
                                            )}
                                        </div>

                                        {/* Selection Check */}
                                        <div className={`absolute top-2 right-2 transition-all duration-200 ${selectedFileIds.has(file.id) ? 'opacity-100 scale-100' : 'opacity-0 scale-75 group-hover:opacity-100'}`}>
                                            {selectedFileIds.has(file.id) ? (
                                                <CheckCircleIcon className="w-6 h-6 text-indigo-400 drop-shadow-lg" />
                                            ) : (
                                                <div className="w-5 h-5 rounded-full border-2 border-white/50 bg-black/20"></div>
                                            )}
                                        </div>

                                        {/* Metadata Footer */}
                                        <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 group-hover:translate-y-0 transition-transform">
                                            <p className="text-[10px] text-gray-300 truncate font-mono">{file.file.name}</p>
                                            {file.assessment && (
                                                <div className="flex items-center gap-2 mt-1">
                                                    <div className="h-1 w-full bg-gray-700 rounded-full overflow-hidden">
                                                        <div 
                                                            className={`h-full ${file.assessment.score > 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} 
                                                            style={{ width: `${file.assessment.score}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Stack Effect Visual if collapsed */}
                                        {isStack && !isExpanded && idx === 0 && (
                                            <div className="absolute -bottom-1 left-1 right-1 h-1 bg-gray-800 rounded-b-lg mx-1 shadow-lg"></div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default BatchView;
