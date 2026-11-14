import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { useProject } from '../contexts/ProjectContext';
import type { View, UploadedFile } from '../types';
import { getEffectiveDecision } from '../utils/cullingEngine';

interface DashboardViewProps {
  onNavigate: (payload: { view: View; action?: string; id?: string }) => void;
  onToggleSidebar: () => void;
  files: UploadedFile[];
}

const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onToggleSidebar, files }) => {
  const { t, language } = useTranslation();
  const { projects } = useProject();
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const fileCount = files.length;
  const counts = { keep: 0, review: 0, reject: 0 };
  for (const file of files) {
    const decision = getEffectiveDecision(file.culling);
    if (decision) counts[decision]++;
  }
  const continueWork = () => onNavigate({ view: fileCount > counts.keep + counts.review + counts.reject ? 'culling' : 'editor', action: 'base-edit' });

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
        <h1 className="font-display text-[clamp(30px,3vw,44px)] text-ink-50">{t.nav_overview}</h1>
        <section className={`mt-8 grid gap-5 ${fileCount ? 'xl:grid-cols-[1.6fr_1fr]' : ''}`}>
          {fileCount > 0 && <div className="fm-surface grid gap-6 rounded-3xl p-7 sm:grid-cols-[1fr_1.2fr]">
            <div className="relative min-h-[190px]" aria-hidden>
              {files.slice(0, 3).map((file, index) => <img key={file.id} src={file.previewUrl} alt=""
                className="absolute top-5 h-[145px] w-[75%] rounded-xl border border-white/20 object-cover shadow-2xl"
                style={{ left: index * 10 + '%', transform: `rotate(${(index - 1) * 9}deg) translateY(${index * 6}px)` }} />)}
            </div>
            <div className="flex flex-col items-start justify-center">
              <h2 className="font-display text-2xl text-ink-50">{t.dash_current_set}</h2>
              <p className="mt-2 text-sm text-ink-400">{fileCount} {t.dash_photos}</p>
              <dl className="my-5 flex flex-wrap gap-4 text-sm">
                {(['keep', 'review', 'reject'] as const).map(d => <div key={d}>
                  <dt className="text-xs text-ink-400">{t[`cull_decision_${d}`]}</dt>
                  <dd className={`mt-1 font-display text-xl ${d === 'keep' ? 'text-fm-green' : d === 'review' ? 'text-amber-400' : 'text-fm-red'}`}>{counts[d]}</dd>
                </div>)}
              </dl>
              <button onClick={continueWork} className="fm-btn-primary px-6">{t.dash_continue} →</button>
            </div>
          </div>}
          <div className="flex flex-col items-start justify-center rounded-3xl border border-dashed border-white/20 bg-ink-900/50 p-8">
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline text-2xl text-ink-200" aria-hidden>+</span>
            <h2 className="font-display text-2xl text-ink-50">{t.dash_new_set}</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-400">{t.dash_new_set_hint}</p>
            <button onClick={() => onNavigate({ view: 'upload' })} className="fm-btn-primary mt-6 px-6">{t.dash_import}</button>
          </div>
        </section>

        {/* Postup práce */}
        <section className="mt-10">
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
