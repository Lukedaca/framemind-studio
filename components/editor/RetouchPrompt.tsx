import React, { useState, useRef, useEffect } from 'react';
import { SparklesIcon } from '../icons';
import { useTranslation } from '../../contexts/LanguageContext';

interface RetouchPromptProps {
  onSubmit: (prompt: string, batch: boolean) => void;
  isProcessing: boolean;
  lastPrompts?: string[];
  fileCount: number;
  batchProgress?: { current: number; total: number } | null;
}

const RetouchPrompt: React.FC<RetouchPromptProps> = ({ onSubmit, isProcessing, lastPrompts = [], fileCount, batchProgress }) => {
  const [prompt, setPrompt] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { language } = useTranslation();
  const isCz = language === 'cs';

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isProcessing) return;
    onSubmit(trimmed, batchMode);
    setPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 80) + 'px';
    }
  }, [prompt]);

  const placeholderText = batchMode
    ? (isCz
      ? `Retuš na všech ${fileCount} snímcích... (např. odeber tetování, vyhlaď pleť)`
      : `Retouch all ${fileCount} images... (e.g. remove tattoos, smooth skin)`)
    : (isCz
      ? 'Napiš co chceš retušovat... (např. odstraň vrásky, vyhlaď pleť, odstraň objekt vlevo)'
      : 'Describe what to retouch... (e.g. remove wrinkles, smooth skin, remove object on left)');

  const buttonLabel = () => {
    if (isProcessing && batchProgress) {
      return `${batchProgress.current}/${batchProgress.total}`;
    }
    if (isProcessing) {
      return isCz ? 'AI pracuje...' : 'Processing...';
    }
    if (batchMode) {
      return isCz ? `Všechny (${fileCount})` : `All (${fileCount})`;
    }
    return isCz ? 'Odeslat' : 'Send';
  };

  return (
    <div className="relative">
      <div className="flex items-end gap-2 bg-surface/90 backdrop-blur-md border border-border-subtle rounded-xl px-3 py-2 shadow-lg">
        <SparklesIcon className="w-4 h-4 text-accent flex-shrink-0 mb-1.5" />
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => lastPrompts.length > 0 && setShowHistory(true)}
          onBlur={() => setTimeout(() => setShowHistory(false), 200)}
          placeholder={placeholderText}
          rows={1}
          disabled={isProcessing}
          className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-secondary/50 resize-none outline-none min-h-[24px] max-h-[80px] disabled:opacity-50"
        />

        {/* Batch toggle */}
        {fileCount > 1 && (
          <button
            onClick={() => setBatchMode(!batchMode)}
            disabled={isProcessing}
            title={isCz ? 'Hromadná retuš na všech snímcích' : 'Batch retouch all images'}
            className={`flex-shrink-0 px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all border disabled:opacity-50 ${
              batchMode
                ? 'bg-accent/20 text-accent border-accent/40'
                : 'bg-elevated text-text-secondary border-border-subtle hover:text-text-primary hover:border-accent'
            }`}
          >
            {isCz ? 'Vše' : 'All'}
          </button>
        )}

        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || isProcessing}
          className={`flex-shrink-0 px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all disabled:opacity-30 ${
            batchMode ? 'bg-orange-500 text-white hover:bg-orange-400' : 'bg-accent text-void hover:bg-accent/80'
          }`}
        >
          {buttonLabel()}
        </button>
      </div>

      {/* Prompt history dropdown */}
      {showHistory && lastPrompts.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-surface/95 backdrop-blur-md border border-border-subtle rounded-xl shadow-xl max-h-40 overflow-y-auto z-50">
          <div className="p-1">
            {lastPrompts.map((p, i) => (
              <button
                key={i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPrompt(p);
                  setShowHistory(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-elevated rounded-lg transition-colors truncate"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RetouchPrompt;
