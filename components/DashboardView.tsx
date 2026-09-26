import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { useProject } from '../contexts/ProjectContext';
import type { View } from '../types';

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

      <div className="mx-auto w-full max-w-[1180px] px-5 pb-16 sm:px-10 lg:pt-14">
        {/* Úvod: vlevo co appka dělá, vpravo logo na papírové kartě */}
        <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div className="animate-fade-in">
            <p className="fm-eyebrow">FrameMind Studio</p>
            <h1 className="mt-4 font-display text-[44px] leading-[1.02] text-ink-50 sm:text-[60px]">
              {t.dash_title_1}
              <br />
              <em className="fm-gradient-text not-italic">{t.dash_title_2}</em>
            </h1>
            <p className="mt-6 max-w-[520px] text-[15px] leading-relaxed text-ink-300">{t.dash_lead}</p>
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

          <div className="fm-paper relative mx-auto w-full max-w-[420px] rounded-[20px] p-8 sm:p-10">
            <img
              src={language === 'en' ? '/brand/logo-en.webp' : '/brand/logo-cs.webp'}
              alt="FrameMind — Tvorba poháněná inteligencí"
              className="relative w-full"
            />
          </div>
        </section>

        {/* Postup práce */}
        <section className="mt-16 lg:mt-24">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="fm-eyebrow">{t.dash_workflow}</h2>
            <span className="text-[12px] text-ink-500">{t.dash_local_badge}</span>
          </div>
          <div className="fm-surface grid overflow-hidden rounded-2xl sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((s) => {
              const disabled = s.needsFiles && fileCount === 0;
              return (
                <button
                  key={s.n}
                  disabled={disabled}
                  onClick={() => onNavigate({ view: s.view, action: s.action })}
                  className="group relative border-b border-hairline p-6 text-left transition-colors last:border-b-0 hover:bg-white/[0.025] disabled:cursor-default disabled:hover:bg-transparent sm:border-r lg:border-b-0 lg:last:border-r-0"
                >
                  <span className="font-mono text-[11px] text-ink-500">{s.n}</span>
                  <h3 className="mt-6 font-display text-[24px] leading-none text-ink-50">{s.title}</h3>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">{s.desc}</p>
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
