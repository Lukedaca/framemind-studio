import React from 'react';
import type { EditorAction, View } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import { ChevronDoubleLeftIcon } from './icons';
import {
  FmStudioIcon,
  FmProjectsIcon,
  FmClientsIcon,
  FmImportIcon,
  FmCullingIcon,
  FmEditIcon,
  FmRetouchIcon,
  FmExportIcon,
  FmAiCenterIcon,
  FmYoutubeIcon,
  FmSocialIcon,
  FmVideoIcon,
  FmGenerateIcon,
  FmStyleIcon,
  FmGalleryIcon,
  FmPresetsIcon,
  FmHistoryIcon,
  FmRawIcon,
} from './FmIcons';
import Aperture from './common/Aperture';

interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onNavigate: (payload: { view: View; action?: string }) => void;
  onToggleCollapse: () => void;
  currentView: View;
  activeAction: EditorAction;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isCollapsed: boolean;
  isActive: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, onClick, isCollapsed, isActive }) => (
  <button
    onClick={onClick}
    className={`
      group w-full flex items-center text-xs font-semibold tracking-wide transition-all duration-200
      ${isCollapsed ? 'justify-center py-2' : 'gap-3 px-3 py-1.5 rounded-xl mx-2 mb-0.5'}
      ${isActive ? 'nav-item-active text-white' : 'text-gray-400 hover:text-white'}
    `}
    title={isCollapsed ? label : undefined}
  >
    <span
      className={`
        relative z-10 flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-200 flex-shrink-0
        ${isActive
          ? 'bg-gradient-to-br from-fm-magenta/20 via-fm-blue/20 to-fm-green/15 border-white/20 shadow-[0_0_14px_rgba(47,111,224,0.25)]'
          : 'bg-white/[0.04] border-white/[0.06] group-hover:border-white/20 group-hover:bg-white/[0.07]'}
      `}
    >
      {icon}
    </span>
    {!isCollapsed && <span className="relative z-10">{label}</span>}
  </button>
);

const SectionLabel: React.FC<{ label: string; isCollapsed: boolean }> = ({ label, isCollapsed }) =>
  isCollapsed ? (
    <div className="h-px w-8 mx-auto bg-gradient-to-r from-fm-magenta/40 via-fm-blue/40 to-fm-green/40 my-3" />
  ) : (
    <div className="flex items-center gap-2 px-5 mb-2">
      <span className="w-4 h-px bg-gradient-to-r from-fm-magenta via-fm-blue to-fm-green" />
      <h2 className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">{label}</h2>
    </div>
  );

const Sidebar = ({ isOpen, isCollapsed, onClose, onNavigate, onToggleCollapse, currentView, activeAction }: SidebarProps) => {
  const { t } = useTranslation();

  const iconCls = 'w-[18px] h-[18px]';

  const crmTools: { icon: React.ReactNode; label: string; view: View; action?: string }[] = [
    { icon: <FmStudioIcon className={iconCls} />, label: t.nav_studio, view: 'dashboard' },
    { icon: <FmProjectsIcon className={iconCls} />, label: t.nav_projects, view: 'projects' },
    { icon: <FmClientsIcon className={iconCls} />, label: t.nav_clients, view: 'clients' },
  ];

  const workflowTools = [
    { icon: <FmImportIcon className={iconCls} />, label: t.pipeline_step_import, view: 'upload' as View },
    { icon: <FmCullingIcon className={iconCls} />, label: t.pipeline_step_culling, view: 'batch' as View, action: 'culling' },
    { icon: <FmEditIcon className={iconCls} />, label: t.pipeline_step_edit, view: 'editor' as View, action: 'base-edit' },
    { icon: <FmRetouchIcon className={iconCls} />, label: t.pipeline_step_retouch, view: 'editor' as View, action: 'retouch' },
    { icon: <FmExportIcon className={iconCls} />, label: t.pipeline_step_export, view: 'editor' as View, action: 'export' },
  ];

  const creativeTools = [
    { icon: <FmAiCenterIcon className={iconCls} />, label: t.nav_ai_command, view: 'ai-command' as View },
    { icon: <FmYoutubeIcon className={iconCls} />, label: t.nav_youtube, view: 'editor' as View, action: 'youtube-thumbnail' },
    { icon: <FmSocialIcon className={iconCls} />, label: t.nav_social, view: 'editor' as View, action: 'social-media' },
    { icon: <FmVideoIcon className={iconCls} />, label: t.nav_video, view: 'editor' as View, action: 'video-generation' },
    { icon: <FmGenerateIcon className={iconCls} />, label: t.nav_gen, view: 'generate' as View },
    { icon: <FmStyleIcon className={iconCls} />, label: t.nav_style, view: 'editor' as View, action: 'style-transfer' },
  ];

  const managementTools = [
    { icon: <FmGalleryIcon className={iconCls} />, label: t.nav_ai_gallery, view: 'ai-gallery' as View },
    { icon: <FmPresetsIcon className={iconCls} />, label: t.nav_presets, view: 'editor' as View, action: 'user-presets' },
    { icon: <FmHistoryIcon className={iconCls} />, label: t.nav_history, view: 'editor' as View, action: 'history' },
    { icon: <FmRawIcon className={iconCls} />, label: t.nav_raw, view: 'raw-converter' as View },
  ];

  const handleNavigation = (payload: { view: View; action?: string }) => {
    onNavigate(payload);
    onClose();
  };

  const renderGroup = (
    label: string,
    items: { icon: React.ReactNode; label: string; view: View; action?: string }[],
    activeCheck: (item: { view: View; action?: string }) => boolean
  ) => (
    <div>
      <SectionLabel label={label} isCollapsed={isCollapsed} />
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavItem
            key={item.label}
            icon={item.icon}
            label={item.label}
            onClick={() => handleNavigation({ view: item.view, action: item.action })}
            isCollapsed={isCollapsed}
            isActive={activeCheck(item)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}></div>
      <aside className={`fixed top-0 left-0 h-full bg-[#0a0a12]/60 backdrop-blur-2xl border-r border-white/[0.07] z-50 transform transition-all duration-300 ease-out flex-shrink-0 overflow-hidden ${isOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'} ${isCollapsed ? 'lg:w-20' : 'lg:w-64'} lg:translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.4)]`}>
        {/* Svislý brand nádech za navigací */}
        <div className="absolute inset-0 bg-gradient-to-b from-fm-magenta/[0.07] via-transparent to-fm-green/[0.06] pointer-events-none" />
        <div className="relative flex flex-col h-full">
          {/* Header */}
          <div className={`relative flex items-center h-20 border-b border-white/[0.07] flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'justify-center px-0' : 'px-5'}`}>
            <button onClick={() => handleNavigation({ view: 'dashboard' })} className="flex items-center space-x-3 group w-full">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-tr from-fm-magenta via-fm-blue to-fm-green blur-lg opacity-40 group-hover:opacity-60 transition-opacity"></div>
                <img src="/logo-mark.png" alt="FrameMind" className="w-9 h-9 object-contain relative z-10" />
              </div>
              {!isCollapsed && (
                <div className="flex-grow overflow-hidden text-left">
                  <h1 className="text-base font-bold text-white tracking-tight leading-none">FrameMind <span className="fm-gradient-text">Studio</span></h1>
                  <p className="text-[10px] text-gray-500 font-medium mt-1 tracking-wide">SNÍMKY S INTELIGENCÍ</p>
                </div>
              )}
            </button>
            <button onClick={onToggleCollapse} className="hidden lg:flex items-center justify-center absolute top-1/2 -translate-y-1/2 -right-3 z-20 w-6 h-6 bg-[#14141c] border border-white/10 rounded-full text-gray-400 hover:text-white hover:border-fm-blue transition-colors shadow-lg">
                <ChevronDoubleLeftIcon className={`w-3 h-3 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <nav className="flex-grow flex flex-col space-y-6 overflow-y-auto py-5 custom-scrollbar">
            {renderGroup('CRM', crmTools, (item) =>
              item.view === currentView ||
              (item.view === 'projects' && currentView === 'project-detail') ||
              (item.view === 'clients' && currentView === 'client-detail')
            )}
            {renderGroup(t.pipeline_workflow, workflowTools, (item) =>
              item.view === currentView && (item.action ? item.action === activeAction?.action : activeAction === null)
            )}
            {renderGroup(t.pipeline_creative, creativeTools, (item) =>
              item.view === currentView && (item.action ? item.action === activeAction?.action : !activeAction)
            )}
            {renderGroup(t.pipeline_management, managementTools, (item) =>
              item.view === currentView && (item.action ? item.action === activeAction?.action : !activeAction)
            )}
          </nav>

          {!isCollapsed && (
            <div className="mt-auto p-4 border-t border-white/[0.07]">
              <div className="fm-gradient-border flex items-center gap-3 bg-white/[0.03] p-3 rounded-2xl">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                    <Aperture className="w-5 h-5" />
                  </div>
                  <div>
                      <p className="text-xs font-bold text-white">Pro Plan</p>
                      <p className="text-[10px] text-gray-400">Unlimited AI</p>
                  </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
