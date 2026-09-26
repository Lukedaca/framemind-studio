import React from 'react';
import type { EditorAction, View } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import {
  FmStudioIcon,
  FmProjectsIcon,
  FmClientsIcon,
  FmImportIcon,
  FmCullingIcon,
  FmEditIcon,
  FmRetouchIcon,
  FmExportIcon,
} from './FmIcons';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (payload: { view: View; action?: string }) => void;
  onOpenApiKeyModal: () => void;
  currentView: View;
  activeAction: EditorAction;
  fileCount: number;
}

interface Item {
  icon: React.ReactNode;
  label: string;
  view: View;
  action?: string;
  step?: number;
}

const Sidebar = ({ isOpen, onClose, onNavigate, onOpenApiKeyModal, currentView, activeAction, fileCount }: SidebarProps) => {
  const { t, language, setLanguage } = useTranslation();
  const ic = 'h-[18px] w-[18px]';

  const workflow: Item[] = [
    { icon: <FmImportIcon className={ic} />, label: t.pipeline_step_import, view: 'upload', step: 1 },
    { icon: <FmCullingIcon className={ic} />, label: t.pipeline_step_culling, view: 'culling', step: 2 },
    { icon: <FmEditIcon className={ic} />, label: t.pipeline_step_edit, view: 'editor', action: 'base-edit', step: 3 },
    { icon: <FmRetouchIcon className={ic} />, label: t.pipeline_step_retouch, view: 'editor', action: 'retouch', step: 4 },
    { icon: <FmExportIcon className={ic} />, label: t.pipeline_step_export, view: 'editor', action: 'export', step: 5 },
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

  const go = (item: Item) => {
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
        className={`group relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] transition-colors ${
          active ? 'bg-white/[0.06] text-ink-50' : 'text-ink-300 hover:bg-white/[0.03] hover:text-ink-100'
        } disabled:pointer-events-none disabled:opacity-35`}
      >
        {active && <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full" style={{ background: 'var(--spectrum)' }} />}
        <span className={active ? 'text-ink-50' : 'text-ink-400 group-hover:text-ink-200'}>{item.icon}</span>
        <span className="flex-1 text-left">{item.label}</span>
        {item.step && <span className="font-mono text-[10px] text-ink-600">0{item.step}</span>}
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
        className={`fixed left-0 top-0 z-50 flex h-full w-60 flex-col border-r border-hairline bg-ink-950 transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button onClick={() => go({ icon: null, label: '', view: 'dashboard' })} className="flex h-16 flex-shrink-0 items-center gap-3 px-5 text-left">
          <img src="/brand/mark.webp" alt="FrameMind" className="h-7 w-auto" />
          <span className="leading-none">
            <span className="block text-[14px] font-semibold tracking-tight text-ink-50">FrameMind</span>
            <span className="mt-1 block font-display text-[15px] italic text-ink-300">Studio</span>
          </span>
        </button>
        <div className="fm-hairline mx-5" />

        <nav className="custom-scrollbar flex-1 space-y-7 overflow-y-auto px-3 py-6">
          <div>
            <p className="fm-eyebrow mb-2 px-3">{t.pipeline_workflow}</p>
            <div className="space-y-0.5">{workflow.map(row)}</div>
          </div>
          <div>
            <p className="fm-eyebrow mb-2 px-3">{t.nav_studio_section}</p>
            <div className="space-y-0.5">{studio.map(row)}</div>
          </div>
        </nav>

        <div className="space-y-3 border-t border-hairline p-4">
          <div className="flex items-center gap-2">
            <div className="fm-seg fm-seg--sm flex-1">
              <button className={language === 'cs' ? 'is-active' : ''} onClick={() => setLanguage('cs')}>CZ</button>
              <button className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')}>EN</button>
            </div>
            <button onClick={onOpenApiKeyModal} className="fm-icon-btn border border-hairline" title={t.nav_gemini_key}>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <circle cx="7" cy="12.5" r="3.5" />
                <path d="m9.5 10 7-7M14 5.5l2 2M12 7.5l1.5 1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="flex items-center gap-2 px-1 text-[11px] leading-snug text-ink-500">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-fm-green" />
            {t.nav_local_note}
          </p>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
