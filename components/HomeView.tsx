import React from 'react';
import { AutopilotIcon, EraserIcon, BatchIcon, GenerateImageIcon } from './icons';
import { useTranslation } from '../contexts/LanguageContext';
import Button from './common/Button';

interface HomeViewProps {
  onEnterApp: () => void;
}

const HomeView: React.FC<HomeViewProps> = ({ onEnterApp }) => {
  const { t } = useTranslation();

  const features = [
    { icon: <AutopilotIcon className="w-5 h-5 text-accent" />, name: t.nav_autopilot },
    { icon: <EraserIcon className="w-5 h-5 text-accent" />, name: t.nav_remove_obj },
    { icon: <BatchIcon className="w-5 h-5 text-accent" />, name: t.nav_batch },
    { icon: <GenerateImageIcon className="w-5 h-5 text-accent" />, name: t.nav_gen },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 text-text-primary">
      <div className="relative z-10 flex flex-col items-center max-w-5xl w-full">
        <div className="animate-fade-in-up flex flex-col items-center text-center">
          <img src="/logo-mark.png" alt="FrameMind" className="w-24 h-24 object-contain mb-8" />

          <div className="mb-4">
            <h1 className="heading text-5xl md:text-7xl tracking-tight">
              FrameMind <span className="fm-gradient-text">Studio</span>
            </h1>
          </div>

          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary mb-6">
            Propojujeme snímky s inteligencí
          </p>

          <p className="max-w-xl text-sm md:text-base text-text-secondary leading-relaxed font-medium">
            {t.home_subtitle}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          {features.map((feature, index) => (
            <div key={index} className="flex flex-col items-center justify-center p-6 border border-border-subtle bg-surface transition-none">
              <div className="p-3 border border-border-subtle mb-4">
                {feature.icon}
              </div>
              <span className="font-bold text-[10px] uppercase tracking-widest text-text-secondary">{feature.name}</span>
            </div>
          ))}
        </div>

        <div className="mt-12 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <Button onClick={onEnterApp} className="px-12 py-4 text-sm">
            {t.home_enter}
          </Button>
        </div>

        <div className="mt-16 flex items-center gap-4 opacity-60">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t.home_powered_by}</span>
          <div className="w-1 h-1 bg-border-subtle"></div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Imagen 4.0 Studio</span>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
