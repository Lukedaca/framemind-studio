import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { useProject } from '../contexts/ProjectContext';
import type { View } from '../types';
import FmMark from './common/FmMark';

// Clonová řada f-čísel — stupnice objektivu kolem značky (clona je srdce loga).
const F_STOPS = ['1.4', '2', '2.8', '4', '5.6', '8', '11', '16', '22'];

const LensStage: React.FC = () => (
  <div className="fm-lens-wrap relative mx-auto">
    <div className="fm-halo" />
    <div className="fm-lens">
      <svg viewBox="0 0 200 200" className="fm-lens-scale" aria-hidden>
        <defs>
          <path id="fm-lens-arc" d="M100,100 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0" />
        </defs>
        {Array.from({ length: 72 }, (_, i) => (
          <line
            key={i}
            x1="100"
            y1={i % 8 === 0 ? 3.5 : 5.5}
            x2="100"
            y2="8"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={i % 8 === 0 ? 0.7 : 0.4}
            transform={`rotate(${i * 5} 100 100)`}
          />
        ))}
        <text fill="rgba(200,200,214,0.55)" fontSize="6.2" letterSpacing="1.2" fontFamily="'Geist Mono', monospace">
          <textPath href="#fm-lens-arc">
            {F_STOPS.map((f) => `f/${f}`).join('   ·   ')}
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-[24%] flex items-center justify-center">
        <FmMark title="FrameMind" className="w-full drop-shadow-[0_10px_40px_rgba(90,68,240,0.45)]" />
      </div>
    </div>
  </div>
);

interface DashboardViewProps {
  onNavigate: (payload: { view: View; action?: string; id?: string }) => void;
  onToggleSidebar: () => void;
  fileCount: number;
}

const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onToggleSidebar, fileCount }) => {
  const { t, language } = useTranslation();
  const { projects } = useProject();
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);

  const steps: { n: string; title: string; desc: string; view: View; action?: string; needsFiles?: boolean }[] = [
    { n: '01', title: t.pipeline_step_import, desc: t.dash_step_import, view: 'upload' },
    { n: '02', title: t.pipeline_step_culling, desc: t.dash_step_culling, view: 'culling', needsFiles: true },
    { n: '03', title: t.pipeline_step_edit, desc: t.dash_step_edit, view: 'editor', action: 'base-edit', needsFiles: true },
    { n: '04', title: t.pipeline_step_retouch, desc: t.dash_step_retouch, view: 'editor', action: 'retouch', needsFiles: true },
    { n: '05', title: t.pipeline_step_export, desc: t.dash_step_export, view: 'editor', action: 'export', needsFiles: true },
  ];

  return (
    <div className="custom-scrollbar h-full w-full overflow-y-auto">
      <div className="flex h-14 items-center px-4 lg:hidden">
        <button onClick={onToggleSidebar} className="fm-icon-btn" aria-label={t.header_open_menu}>
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div className="fm-page">
        {/* Úvod: vlevo co appka dělá, vpravo značka v objektivu se clonovou stupnicí */}
        <section className="grid items-center gap-[clamp(32px,5vw,96px)] lg:grid-cols-[1.15fr_0.85fr]">
          <div className="animate-fade-in">
            <p className="fm-eyebrow">FrameMind Studio</p>
            <h1 className="fm-hero-title mt-5 font-display leading-[1.04] text-ink-50">
              {t.dash_title_1}
              <br />
              <span className="fm-gradient-text">{t.dash_title_2}</span>
            </h1>
            <p className="fm-hero-lead mt-6 max-w-[34em] leading-[1.65] text-ink-300">{t.dash_lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={() => onNavigate({ view: 'upload' })} className="fm-btn-primary h-12 px-6 text-[14px]">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M10 13V3m0 0L6 7m4-4 4 4M3.5 13v2.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {t.dash_import}
              </button>
              {fileCount > 0 && (
                <button onClick={() => onNavigate({ view: 'editor', action: 'base-edit' })} className="fm-btn-ghost h-12 px-6 text-[14px]">
                  {t.dash_continue} · {fileCount}
                </button>
              )}
            </div>
          </div>

          <LensStage />
        </section>

        {/* Postup práce */}
        <section className="mt-[clamp(48px,9vh,112px)]">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="fm-eyebrow">{t.dash_workflow}</h2>
            <span className="text-[12px] text-ink-500">{t.dash_local_badge}</span>
          </div>
          <div className="fm-grid-steps overflow-hidden rounded-2xl border border-hairline shadow-[0_18px_40px_-20px_rgba(0,0,0,0.8)]">
            {steps.map((s) => {
              const disabled = s.needsFiles && fileCount === 0;
              return (
                <button
                  key={s.n}
                  disabled={disabled}
                  onClick={() => onNavigate({ view: s.view, action: s.action })}
                  className="group relative bg-ink-900 p-[clamp(18px,1.6vw,28px)] text-left transition-colors hover:bg-ink-850 disabled:cursor-default disabled:hover:bg-ink-900"
                >
                  <span className="font-mono text-[11px] text-ink-400">{s.n}</span>
                  <h3 className="mt-6 font-display text-[19px] leading-tight text-ink-50">{s.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-ink-400">{s.desc}</p>
                  {!disabled && (
                    <span className="absolute right-5 top-6 text-ink-600 transition-colors group-hover:text-ink-200">→</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Poslední projekty */}
        <section className="mt-14">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="fm-eyebrow">{t.dash_recent_projects}</h2>
            <button onClick={() => onNavigate({ view: 'projects' })} className="text-[12px] text-ink-400 hover:text-ink-100">
              {t.dash_show_all} →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-hairline p-8 text-center text-[13px] text-ink-500">{t.dash_no_projects}</p>
          ) : (
            <div className="fm-grid-cards">
              {recent.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onNavigate({ view: 'project-detail', id: p.id })}
                  className="fm-surface rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5"
                >
                  <p className="truncate text-[14px] font-medium text-ink-50">{p.name}</p>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {new Date(p.date || p.updatedAt).toLocaleDateString(language === 'cs' ? 'cs-CZ' : 'en-GB')} · {p.files.length} {t.dash_photos}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default DashboardView;
