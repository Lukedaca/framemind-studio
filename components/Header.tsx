
import React from 'react';
import { KeyIcon, MenuIcon, SparklesIcon } from './icons';
import { useTranslation } from '../contexts/LanguageContext';

interface HeaderProps {
  title: string;
  onToggleSidebar: () => void;
  credits?: number;
  onBuyCredits?: () => void;
  onOpenApiKeyModal?: () => void;
}

const Header: React.FC<HeaderProps> = ({ title, onToggleSidebar, credits, onBuyCredits, onOpenApiKeyModal }) => {
  const { language, setLanguage, t } = useTranslation();

  return (
    <header className="relative flex-shrink-0 flex items-center h-20 px-4 sm:px-8 w-full bg-[#0a0a12]/60 backdrop-blur-2xl">
      {/* Vodorovný brand nádech + výrazná spodní linka */}
      <div className="absolute inset-0 bg-gradient-to-r from-fm-magenta/[0.08] via-fm-blue/[0.05] to-fm-green/[0.07] pointer-events-none" />
      <div className="fm-hairline absolute bottom-0 left-0 right-0" />

      {/* Mobile Menu Button */}
      <button
        onClick={onToggleSidebar}
        className="relative lg:hidden p-2 -ml-2 mr-4 text-text-secondary"
        aria-label={t.header_open_menu}
      >
        <MenuIcon className="w-6 h-6" />
      </button>

      {/* Title s gradientovou lištou */}
      <div className="relative flex-1 flex items-center gap-3">
        <span className="w-1 h-6 rounded-full bg-gradient-to-b from-fm-magenta via-fm-blue to-fm-green" />
        <h1 className="text-lg font-bold text-white heading tracking-tight">{title}</h1>
      </div>

      {/* Right side actions */}
      <div className="relative flex items-center space-x-2 sm:space-x-3">

        {onOpenApiKeyModal && (
            <button
              onClick={onOpenApiKeyModal}
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-fm-blue/60 hover:bg-fm-blue/10 text-xs font-bold text-gray-300 hover:text-white transition-all"
            >
              <KeyIcon className="w-4 h-4 text-fm-blue" />
              <span>API</span>
            </button>
        )}

        {/* Credits Display */}
        {credits !== undefined && (
            <button
              onClick={onBuyCredits}
              title={t.credits_buy}
              className="fm-gradient-border hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] text-xs font-bold text-white transition-all"
            >
              <SparklesIcon className="w-4 h-4 text-warning" />
              <span className="font-mono">{credits}</span>
            </button>
        )}

        {/* Language Toggle */}
        <div className="flex bg-white/[0.04] border border-white/[0.08] rounded-full p-1">
            <button
                onClick={() => setLanguage('cs')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
                  language === 'cs'
                    ? 'bg-gradient-to-r from-fm-magenta via-fm-blue to-fm-green text-white shadow-[0_0_12px_rgba(47,111,224,0.4)]'
                    : 'text-gray-500 hover:text-white'
                }`}
            >
                CZ
            </button>
            <button
                onClick={() => setLanguage('en')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
                  language === 'en'
                    ? 'bg-gradient-to-r from-fm-magenta via-fm-blue to-fm-green text-white shadow-[0_0_12px_rgba(47,111,224,0.4)]'
                    : 'text-gray-500 hover:text-white'
                }`}
            >
                EN
            </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
