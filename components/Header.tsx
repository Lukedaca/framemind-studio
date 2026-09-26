import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';

interface HeaderProps {
  title: string;
  onToggleSidebar: () => void;
  eyebrow?: string;
  actions?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ title, onToggleSidebar, eyebrow, actions }) => {
  const { t } = useTranslation();

  return (
    <header className="relative flex h-16 w-full flex-shrink-0 items-center gap-3 border-b border-hairline bg-ink-950/80 px-4 backdrop-blur-xl sm:px-8">
      <button onClick={onToggleSidebar} className="fm-icon-btn -ml-2 lg:hidden" aria-label={t.header_open_menu}>
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="fm-eyebrow leading-none">{eyebrow}</p>}
        <h1 className="truncate font-display text-[26px] leading-tight text-ink-50">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
};

export default Header;
