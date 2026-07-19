import React from 'react';
import Header from './Header';
import { useTranslation } from '../contexts/LanguageContext';
import { UploadIcon, HistoryIcon, AutopilotIcon, SparklesIcon, ChevronDoubleLeftIcon } from './icons';
import Aperture from './common/Aperture';
import type { View, HistoryEntry } from '../types';

interface DashboardViewProps {
  onNavigate: (payload: { view: View; action?: string }) => void;
  onToggleSidebar: () => void;
  credits: number;
  recentHistory: HistoryEntry[];
  onBuyCredits: () => void;
  onOpenApiKeyModal?: () => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onToggleSidebar,
  credits,
  recentHistory,
  onBuyCredits,
  onOpenApiKeyModal,
}) => {
  const { t } = useTranslation();

  return (
    <div className="w-full h-full flex flex-col text-white overflow-y-auto custom-scrollbar">
      <Header
        title={t.nav_studio}
        onToggleSidebar={onToggleSidebar}
        credits={credits}
        onBuyCredits={onBuyCredits}
        onOpenApiKeyModal={onOpenApiKeyModal}
      />

      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto w-full space-y-8 animate-fade-in pb-20">
        
        {/* Hero Section */}
        <div className="fm-gradient-border relative overflow-hidden rounded-3xl bg-gradient-to-r from-fm-magenta/15 via-fm-blue/15 to-fm-green/10 border border-[#ffffff10] p-8 lg:p-12 shadow-2xl">
            <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-fm-magenta rounded-full blur-[110px] opacity-20 pointer-events-none"></div>
            <div className="absolute bottom-0 right-1/4 -mb-16 w-56 h-56 bg-fm-green rounded-full blur-[110px] opacity-15 pointer-events-none"></div>
            <div className="absolute right-8 top-1/2 -translate-y-1/2 opacity-[0.13] pointer-events-none hidden lg:block">
                <Aperture className="w-56 h-56" />
            </div>
            <div className="relative z-10 max-w-2xl">
                <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-4 text-white">
                    {t.dash_welcome_title} <span className="fm-gradient-text">{t.dash_welcome_studio}</span>
                </h1>
                <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                    {t.dash_welcome_desc}
                </p>
                <div className="flex flex-wrap gap-4">
                    <button
                        onClick={() => onNavigate({ view: 'upload' })}
                        className="px-8 py-4 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center gap-2"
                    >
                        <UploadIcon className="w-5 h-5" />
                        {t.dash_new_project}
                    </button>
                    <button
                        onClick={() => onNavigate({ view: 'editor' })}
                        className="px-8 py-4 glass-panel text-white rounded-xl font-bold text-sm hover:bg-white/10 transition-all flex items-center gap-2"
                    >
                        {t.dash_open_editor}
                    </button>
                </div>
            </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-auto">
            
            {/* Quick Actions (Tall) */}
            <div className="md:col-span-1 glass-panel rounded-3xl p-6 flex flex-col gap-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{t.dash_quick_tools}</h3>
                
                <button onClick={() => onNavigate({ view: 'batch', action: 'culling' })} className="group relative overflow-hidden bg-[#ffffff05] hover:bg-[#ffffff0a] border border-[#ffffff0a] rounded-2xl p-5 transition-all text-left">
                    <div className="absolute top-0 right-0 p-3 opacity-50 group-hover:opacity-100 transition-opacity">
                        <SparklesIcon className="w-6 h-6 text-indigo-400" />
                    </div>
                    <h4 className="font-bold text-white mb-1">AI Culling</h4>
                    <p className="text-xs text-gray-400">{t.dash_culling_desc}</p>
                </button>

                <button onClick={() => onNavigate({ view: 'editor', action: 'autopilot' })} className="group relative overflow-hidden bg-[#ffffff05] hover:bg-[#ffffff0a] border border-[#ffffff0a] rounded-2xl p-5 transition-all text-left">
                    <div className="absolute top-0 right-0 p-3 opacity-50 group-hover:opacity-100 transition-opacity">
                        <AutopilotIcon className="w-6 h-6 text-emerald-400" />
                    </div>
                    <h4 className="font-bold text-white mb-1">Autopilot</h4>
                    <p className="text-xs text-gray-400">{t.dash_autopilot_desc}</p>
                </button>

                <button onClick={() => onNavigate({ view: 'generate' })} className="group relative overflow-hidden bg-[#ffffff05] hover:bg-[#ffffff0a] border border-[#ffffff0a] rounded-2xl p-5 transition-all text-left mt-auto">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <h4 className="font-bold text-white mb-1 relative z-10">{t.dash_ai_generator}</h4>
                    <p className="text-xs text-gray-400 relative z-10">{t.dash_gen_desc}</p>
                </button>
            </div>

            {/* Recent Activity (Wide) */}
            <div className="md:col-span-2 glass-panel rounded-3xl p-6">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.dash_recent_activity}</h3>
                    <button className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold">{t.dash_show_all}</button>
                </div>
                
                <div className="space-y-3">
                    {recentHistory.length > 0 ? (
                        recentHistory.slice(-4).reverse().map((entry, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 bg-[#ffffff03] border border-[#ffffff05] rounded-xl hover:bg-[#ffffff08] transition-colors group">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-[#ffffff05] flex items-center justify-center text-gray-400 group-hover:text-white transition-colors">
                                        <HistoryIcon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">{entry.actionName}</p>
                                        <p className="text-xs text-gray-500">{entry.state.length} {t.dash_items_ago}</p>
                                    </div>
                                </div>
                                <ChevronDoubleLeftIcon className="w-4 h-4 text-gray-600 rotate-180 group-hover:text-white transition-colors" />
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="w-12 h-12 rounded-full bg-[#ffffff05] flex items-center justify-center text-gray-600 mb-3">
                                <HistoryIcon className="w-6 h-6" />
                            </div>
                            <p className="text-sm text-gray-500">{t.dash_no_history}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Stats / Credits (Wide Bottom) */}
            <div className="md:col-span-3 glass-panel rounded-3xl p-8 flex items-center justify-between relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-r from-fm-magenta/15 via-fm-blue/15 to-fm-green/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                
                <div className="relative z-10">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">{t.dash_available_credits}</p>
                    <h3 className="text-4xl font-black text-white font-mono">{credits}</h3>
                </div>

                <div className="relative z-10 flex gap-4">
                    <div className="text-right hidden sm:block">
                        <p className="text-xs text-gray-400">{t.dash_plan_renewed}</p>
                        <p className="text-sm font-bold text-white">{t.dash_renewal_date}</p>
                    </div>
                    <button onClick={onBuyCredits} className="px-6 py-3 bg-white text-black font-bold rounded-xl text-xs hover:scale-105 transition-transform shadow-lg">
                        {t.dash_topup}
                    </button>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default DashboardView;