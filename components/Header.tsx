
import React from 'react';
import { KeyIcon, MenuIcon, SparklesIcon } from './icons';
import Button from './common/Button';
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
    <header className="relative flex-shrink-0 flex items-center h-20 px-4 sm:px-8 border-b border-gray-800 w-full bg-void/60 backdrop-blur-xl">
      <div className="fm-hairline absolute bottom-0 left-0 right-0" />
      {/* Mobile Menu Button */}
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-2 -ml-2 mr-4 text-text-secondary"
        aria-label={t.header_open_menu}
      >
        <MenuIcon className="w-6 h-6" />
      </button>

      {/* Title */}
      <div className="flex-1">
          <h1 className="text-lg font-bold text-white heading">{title}</h1>
      </div>

      {/* Right side actions */}
      <div className="flex items-center space-x-3 sm:space-x-4">

        {onOpenApiKeyModal && (
            <Button onClick={onOpenApiKeyModal} variant="secondary" className="hidden sm:flex items-center gap-2">
                <KeyIcon className="w-4 h-4 text-accent" />
                <span>API</span>
            </Button>
        )}
        
        {/* Credits Display */}
        {credits !== undefined && (
            <Button onClick={onBuyCredits} variant="secondary" className="hidden sm:flex items-center gap-2" title={t.credits_buy}>
                <SparklesIcon className="w-4 h-4 text-warning" />
                <span>{credits}</span>
            </Button>
        )}

        {/* Language Toggle */}
        <div className="flex bg-void border border-gray-800 p-1">
            <button 
                onClick={() => setLanguage('cs')} 
                className={`px-2 py-1 text-xs font-bold uppercase tracking-widest transition-none ${language === 'cs' ? 'bg-accent text-black' : 'text-gray-500'}`}
            >
                CZ
            </button>
            <button 
                onClick={() => setLanguage('en')} 
                className={`px-2 py-1 text-xs font-bold uppercase tracking-widest transition-none ${language === 'en' ? 'bg-accent text-black' : 'text-gray-500'}`}
            >
                EN
            </button>
        </div>
      </div>
    </header>
  );
};

export default Header;

