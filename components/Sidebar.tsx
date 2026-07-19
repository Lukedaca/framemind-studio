import React from 'react';
import type { EditorAction, View } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import {
  UploadIcon,
  AnalysisIcon,
  ManualEditIcon,
  BatchIcon,
  AutopilotIcon,
  AutoCropIcon,
  EraserIcon,
  GenerateImageIcon,
  ExportIcon,
  HistoryIcon,
  ChevronDoubleLeftIcon,
  StyleTransferIcon,
  BackgroundReplacementIcon,
  PresetIcon,
  SparklesIcon,
  FilmIcon,
  YoutubeIcon,
} from './icons';

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
      w-full flex items-center text-xs font-semibold tracking-wide transition-all duration-200
      ${isCollapsed ? 'justify-center py-3' : 'space-x-3 px-4 py-2.5 rounded-lg mx-2 mb-1'} 
      ${isActive 
        ? 'nav-item-active text-white' 
        : 'text-gray-400 hover:text-white hover:bg-white/5'}
    `}
    title={isCollapsed ? label : undefined}
  >
    <span className={`relative z-10 transition-transform ${isActive ? 'scale-110 text-indigo-400' : ''}`}>{icon}</span>
    {!isCollapsed && <span className="relative z-10">{label}</span>}
  </button>
);

const DashboardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 flex-shrink-0">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75h6.5v6.5h-6.5zM13.75 3.75h6.5v4.5h-6.5zM13.75 10.25h6.5v10h-6.5zM3.75 12.25h6.5v8h-6.5z" />
  </svg>
);

const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 flex-shrink-0">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5a2.25 2.25 0 012.25-2.25h4.19a2.25 2.25 0 011.6.66l1.2 1.2a2.25 2.25 0 001.6.66H18.75A2.25 2.25 0 0121 10v7.5A2.25 2.25 0 0118.75 19.75H5.25A2.25 2.25 0 013 17.5v-10z" />
  </svg>
);

const UsersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 flex-shrink-0">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3 3 0 11-6 0 3 3 0 016 0zM4.5 19.5a5.25 5.25 0 0110.5 0v.75H4.5v-.75zM17.5 19.5a4.5 4.5 0 00-3.3-4.34" />
  </svg>
);

const Sidebar = ({ isOpen, isCollapsed, onClose, onNavigate, onToggleCollapse, currentView, activeAction }: SidebarProps) => {
  const { t } = useTranslation();

  const workflowTools = [
    { icon: <UploadIcon className="w-5 h-5 flex-shrink-0"/>, label: t.pipeline_step_import, view: "upload" as View },
    { icon: <AnalysisIcon className="w-5 h-5 flex-shrink-0"/>, label: t.pipeline_step_culling, view: "batch" as View, action: "culling" },
    { icon: <AutopilotIcon className="w-5 h-5 flex-shrink-0"/>, label: t.pipeline_step_edit, view: "editor" as View, action: "base-edit" },
    { icon: <EraserIcon className="w-5 h-5 flex-shrink-0"/>, label: t.pipeline_step_retouch, view: "editor" as View, action: "retouch" },
    { icon: <ExportIcon className="w-5 h-5 flex-shrink-0"/>, label: t.pipeline_step_export, view: "editor" as View, action: "export" },
  ];

  const crmTools: { icon: React.ReactNode; label: string; view: View; action?: string }[] = [
    { icon: <DashboardIcon />, label: t.nav_studio, view: "dashboard" },
    { icon: <FolderIcon />, label: t.nav_projects, view: "projects" },
    { icon: <UsersIcon />, label: t.nav_clients, view: "clients" },
  ];

  const creativeTools = [
    { icon: <SparklesIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_ai_command, view: "ai-command" as View },
    { icon: <YoutubeIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_youtube, view: "editor" as View, action: "youtube-thumbnail" },
    { icon: <SparklesIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_social, view: "editor" as View, action: "social-media" },
    { icon: <FilmIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_video, view: "editor" as View, action: "video-generation" },
    { icon: <GenerateImageIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_gen, view: "generate" as View },
    { icon: <StyleTransferIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_style, view: "editor" as View, action: "style-transfer" },
  ];

  const managementTools = [
    { icon: <SparklesIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_ai_gallery, view: "ai-gallery" as View },
    { icon: <PresetIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_presets, view: "editor" as View, action: "user-presets" },
    { icon: <HistoryIcon className="w-5 h-5 flex-shrink-0"/>, label: t.nav_history, view: "editor" as View, action: "history" },
    { icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 flex-shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" /></svg>, label: t.nav_raw, view: "raw-converter" as View },
  ];

  const handleNavigation = (payload: { view: View; action?: string }) => {
    onNavigate(payload);
    onClose();
  }

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}></div>
      <aside className={`fixed top-0 left-0 h-full bg-[#080808]/90 backdrop-blur-xl border-r border-[#ffffff0a] z-50 transform transition-all duration-300 ease-out flex-shrink-0 ${isOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'} ${isCollapsed ? 'lg:w-20' : 'lg:w-64'} lg:translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.4)]`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className={`relative flex items-center h-20 border-b border-[#ffffff0a] flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'justify-center px-0' : 'px-6'}`}>
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
            <button onClick={onToggleCollapse} className="hidden lg:flex items-center justify-center absolute top-1/2 -translate-y-1/2 -right-3 z-20 w-6 h-6 bg-[#1a1a1a] border border-[#333] rounded-full text-gray-400 hover:text-white hover:border-indigo-500 transition-colors shadow-lg">
                <ChevronDoubleLeftIcon className={`w-3 h-3 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
            </button>
          </div>
          
          <nav className="flex-grow flex flex-col space-y-6 overflow-y-auto py-6 custom-scrollbar">
            {/* CRM Section */}
            <div>
              {!isCollapsed && <h2 className="px-6 mb-2 text-[10px] font-bold tracking-widest text-gray-500 uppercase opacity-70">CRM</h2>}
              {isCollapsed && <div className="h-px w-8 mx-auto bg-[#ffffff0a] mb-4"></div>}
              <div className="space-y-0.5">
                {crmTools.map((item) => {
                  const isActive =
                    item.view === currentView ||
                    (item.view === 'projects' && currentView === 'project-detail') ||
                    (item.view === 'clients' && currentView === 'client-detail');
                  return (
                    <NavItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleNavigation({ view: item.view, action: item.action })} isCollapsed={isCollapsed} isActive={isActive} />
                  );
                })}
              </div>
            </div>

            {/* Workflow Section */}
            <div>
              {!isCollapsed && <h2 className="px-6 mb-2 text-[10px] font-bold tracking-widest text-gray-500 uppercase opacity-70">{t.pipeline_workflow}</h2>}
              {isCollapsed && <div className="h-px w-8 mx-auto bg-[#ffffff0a] my-4"></div>}
              <div className="space-y-0.5">
                {workflowTools.map((item) => {
                  const isActive = item.view === currentView && (item.action ? item.action === (activeAction?.action) : activeAction === null);
                  return (
                    <NavItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleNavigation({ view: item.view, action: item.action })} isCollapsed={isCollapsed} isActive={isActive} />
                  );
                })}
              </div>
            </div>

            {/* Creative Section */}
            <div>
              {!isCollapsed && <h2 className="px-6 mb-2 text-[10px] font-bold tracking-widest text-gray-500 uppercase opacity-70">{t.pipeline_creative}</h2>}
              {isCollapsed && <div className="h-px w-8 mx-auto bg-[#ffffff0a] my-4"></div>}
              <div className="space-y-0.5">
                {creativeTools.map((item) => {
                  const isActive = item.view === currentView && (item.action ? item.action === (activeAction?.action) : !activeAction);
                  return (
                    <NavItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleNavigation({ view: item.view, action: item.action })} isCollapsed={isCollapsed} isActive={isActive}/>
                  );
                })}
              </div>
            </div>

            {/* Management Section */}
            <div>
              {!isCollapsed && <h2 className="px-6 mb-2 text-[10px] font-bold tracking-widest text-gray-500 uppercase opacity-70">{t.pipeline_management}</h2>}
              {isCollapsed && <div className="h-px w-8 mx-auto bg-[#ffffff0a] my-4"></div>}
              <div className="space-y-0.5">
                {managementTools.map((item) => {
                  const isActive = item.view === currentView && (item.action ? item.action === (activeAction?.action) : !activeAction);
                  return (
                    <NavItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleNavigation({ view: item.view, action: item.action })} isCollapsed={isCollapsed} isActive={isActive}/>
                  );
                })}
              </div>
            </div>
          </nav>

          {!isCollapsed && (
            <div className="mt-auto pt-4 p-6 border-t border-[#ffffff0a]">
              <div className="flex items-center gap-3 bg-[#ffffff05] p-3 rounded-xl border border-[#ffffff0a]">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500"></div>
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