import React from 'react';
import type { EditorAction, View } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import { useProject } from '../contexts/ProjectContext';
import { FmStudioIcon, FmProjectsIcon, FmClientsIcon } from './FmIcons';
import FmMark from './common/FmMark';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (payload: { view: View; action?: string }) => void;
  onOpenApiKeyModal: () => void;
  currentView: View;
  activeAction: EditorAction;
  fileCount: number;
  /** Photos with a culling result: the selection step is done for them. */
  culledCount: number;
  hasWorkspace: boolean;
  onClearWorkspace: () => void;
  clearPending: boolean;
}

interface Item {
  icon?: React.ReactNode;
  label: string;
  view: View;
  action?: string;
  step?: number;
  done?: boolean;
}

const Sidebar = ({ isOpen, onClose, onNavigate, onOpenApiKeyModal, currentView, activeAction, fileCount, culledCount, hasWorkspace, onClearWorkspace, clearPending }: SidebarProps) => {
  const { t, language, setLanguage } = useTranslation();
  const { storageStatus, retryStorage } = useProject();
  const ic = 'h-[18px] w-[18px]';

  // Hotové jsou jen kroky, které jde poznat z dat: import (sada má fotky) a výběr (fotky mají verdikt).
  const workflow: Item[] = [
    { label: t.pipeline_step_import, view: 'upload', step: 1, done: fileCount > 0 },
    { label: t.pipeline_step_culling, view: 'culling', step: 2, done: fileCount > 0 && culledCount === fileCount },
    { label: t.pipeline_step_edit, view: 'editor', action: 'base-edit', step: 3 },
    { label: t.pipeline_step_retouch, view: 'editor', action: 'retouch', step: 4 },
    { label: t.pipeline_step_export, view: 'editor', action: 'export', step: 5 },
  ];
  const studio: Item[] = [
    { icon: <FmStudioIcon className={ic} />, label: t.nav_overview, view: 'dashboard' },
    { icon: <FmProjectsIcon className={ic} />, label: t.nav_projects, view: 'projects' },
    { icon: <FmClientsIcon className={ic} />, label: t.nav_clients, view: 'clients' },
  ];

  const editorMode = (a: EditorAction) =>
    a?.action === 'export' ? 'export' : a?.action === 'retouch' || a?.action === 'remove-object' ? 'retouch' : 'base-edit';

  const isActive = (item: Item) => {
    if (item.view === 'editor') return currentView === 'editor' && editorMode(activeAction) === item.action;
    if (item.view === 'projects') return currentView === 'projects' || currentView === 'project-detail';
    if (item.view === 'clients') return currentView === 'clients' || currentView === 'client-detail';
    return currentView === item.view;
  };

  const go = (item: Pick<Item, 'view' | 'action'>) => {
    onNavigate({ view: item.view, action: item.action });
    onClose();
  };

  const row = (item: Item) => {
    const active = isActive(item);
    const needsFiles = item.view === 'editor' || item.view === 'culling';
    const disabled = needsFiles && fileCount === 0;
    return (
      <button
        key={item.label}
        onClick={() => go(item)}
        disabled={disabled}
        aria-current={active ? 'page' : undefined}
        title={item.done && !active ? t.nav_step_done : undefined}
        className={`fm-nav-item ${active ? 'is-active' : ''} ${item.done && !active ? 'is-done' : ''}`}
      >
        {/* Popisek je v DOM první, kroužek se jen vizuálně řadí před něj: název tlačítka zůstává „Import 01". */}
        <span className="flex-1">{item.label}</span>
        {item.step ? (
          <span className="fm-nav-num order-first">
            {item.done && !active ? <>
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="m5 10.5 3.2 3.2L15 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="sr-only">0{item.step}</span>
            </> : `0${item.step}`}
          </span>
        ) : <span className="fm-nav-num order-first" aria-hidden>{item.icon}</span>}
      </button>
    );
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-hairline bg-ink-950 transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0) 40%)' }}
      >
        <button
          onClick={() => go({ view: 'dashboard' })}
          className="flex h-[84px] flex-shrink-0 items-center gap-3.5 px-6 text-left"
          aria-label="FrameMind Studio"
        >
          <FmMark className="h-10 w-auto flex-shrink-0 drop-shadow-[0_0_16px_rgba(111,80,255,0.35)]" />
          <span className="leading-none">
            <span className="fm-wordmark block text-[20px] text-ink-50">
              Frame<span className="fm-gradient-text">Mind</span>
            </span>
            <span className="mt-1.5 block font-mono text-[11px] uppercase tracking-[0.3em] text-ink-400">Studio</span>
          </span>
        </button>

        <nav className="custom-scrollbar flex-1 space-y-8 overflow-y-auto px-4 py-4" aria-label={t.pipeline_workflow}>
          <div>
            <p className="fm-eyebrow mb-3 px-3">{t.pipeline_workflow}</p>
            <div className="space-y-1">{workflow.map(row)}</div>
            <button
              onClick={onClearWorkspace}
              disabled={!hasWorkspace || clearPending}
              className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 text-left text-[13px] text-ink-400 transition-colors hover:bg-white/[0.04] hover:text-ink-100 disabled:opacity-35"
              title={t.workspace_clear_hint}
            >
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.workspace_clear}
            </button>
          </div>
          <div>
            <p className="fm-eyebrow mb-3 px-3">{t.nav_studio_section}</p>
            <div className="space-y-1">{studio.map(row)}</div>
          </div>
        </nav>

        <div className="space-y-3 border-t border-hairline p-5">
          {(currentView !== 'editor' || fileCount === 0) && <div className={`px-1 text-[12px] leading-snug ${storageStatus === 'error' ? 'text-[#ffb3c0]' : 'text-ink-400'}`} role="status" aria-live="polite">
            {storageStatus === 'error' ? t.storage_save_failed : storageStatus === 'saving' ? t.storage_saving : t.storage_saved}
            {storageStatus === 'error' && <button onClick={retryStorage} className="mt-1 block underline">{t.storage_retry}</button>}
          </div>}
          <div className="flex items-center gap-2">
            <div className="fm-seg flex-1">
              <button className={language === 'cs' ? 'is-active' : ''} onClick={() => setLanguage('cs')}>CZ</button>
              <button className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')}>EN</button>
            </div>
            {currentView !== 'culling' && <button onClick={onOpenApiKeyModal} className="fm-icon-btn h-[38px] w-[38px] border border-hairline" title={t.nav_gemini_key} aria-label={t.nav_gemini_key}>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <circle cx="7" cy="12.5" r="3.5" />
                <path d="m9.5 10 7-7M14 5.5l2 2M12 7.5l1.5 1.5" strokeLinecap="round" />
              </svg>
            </button>}
          </div>
          <p className="flex items-center gap-2 px-1 text-[12px] leading-snug text-ink-400">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-fm-green shadow-[0_0_8px_#1fc06b]" />
            {t.nav_local_note}
          </p>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
