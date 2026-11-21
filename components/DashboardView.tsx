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
  const culledCount = counts.keep + counts.review + counts.reject;
  const continueWork = () => onNavigate({ view: fileCount > culledCount ? 'culling' : 'editor', action: 'base-edit' });

  const steps: { n: string; title: string; desc: string; view: View; action?: string; needsFiles?: boolean; done?: boolean }[] = [
    { n: '01', title: t.pipeline_step_import, desc: t.dash_step_import, view: 'upload', done: fileCount > 0 },
    { n: '02', title: t.pipeline_step_culling, desc: t.dash_step_culling, view: 'culling', needsFiles: true, done: fileCount > 0 && culledCount === fileCount },
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
        <section className={`mt-7 grid gap-5 ${fileCount ? 'xl:grid-cols-[1.65fr_1fr]' : ''}`}>
          {fileCount > 0 && <div className="fm-surface relative grid gap-6 overflow-hidden rounded-[22px] p-7 sm:grid-cols-[1fr_1.25fr]">
            <div className="fm-hairline absolute inset-x-0 top-0" aria-hidden />
            <div className="relative min-h-[188px]" aria-hidden>
              {files.slice(0, 3).map((file, index) => <img key={file.id} src={file.previewUrl} alt=""
                className="absolute top-4 h-[148px] w-[76%] rounded-xl border border-white/15 object-cover shadow-2xl"
                style={{ left: index * 10 + '%', transform: `rotate(${(index - 1) * 8}deg) translateY(${index * 5}px)` }} />)}
            </div>
            <div className="flex flex-col items-start justify-center">
              <div className="flex items-center gap-2.5">
                <h2 className="font-display text-2xl text-ink-50">{t.dash_current_set}</h2>
                <span className="rounded-md border border-hairline bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] tabular-nums text-ink-300">
                  {fileCount} {t.dash_photos}
                </span>
              </div>
              <dl className="mt-4 flex flex-wrap gap-5 text-sm">
                {(['keep', 'review', 'reject'] as const).map(d => <div key={d}>
                  <dt className="flex items-center gap-1.5 text-[11px] text-ink-400">
                    <span className={`h-1.5 w-1.5 rounded-full ${d === 'keep' ? 'bg-fm-green' : d === 'review' ? 'bg-amber-400' : 'bg-fm-red'}`} />
                    {t[`cull_decision_${d}`]}
                  </dt>
                  <dd className={`mt-1 font-display text-[22px] leading-none tabular-nums ${d === 'keep' ? 'text-fm-green' : d === 'review' ? 'text-amber-400' : 'text-fm-red'}`}>{counts[d]}</dd>
                </div>)}
              </dl>
              {culledCount > 0 && (
                <div className="mt-4 flex h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
                  <span style={{ width: `${(counts.keep / fileCount) * 100}%` }} className="bg-fm-green" />
                  <span style={{ width: `${(counts.review / fileCount) * 100}%` }} className="bg-amber-400" />
                  <span style={{ width: `${(counts.reject / fileCount) * 100}%` }} className="bg-fm-red" />
                </div>
              )}
              <button onClick={continueWork} className="fm-btn-primary mt-5 px-6">{t.dash_continue} →</button>
            </div>
          </div>}
          <div className="fm-contact-card flex flex-col items-start justify-center rounded-[22px] border-dashed border-white/15 p-7">
            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-white/[0.03] font-mono text-xl text-ink-200" aria-hidden>+</span>
            <h2 className="font-display text-2xl text-ink-50">{t.dash_new_set}</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-400">{t.dash_new_set_hint}</p>
            <button onClick={() => onNavigate({ view: 'upload', action: fileCount > 0 ? 'new-set' : undefined })} className="fm-btn-primary mt-5 px-6">{t.dash_import}</button>
          </div>
        </section>

        {/* Postup práce */}
        <section className="mt-9">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="fm-eyebrow">{t.dash_workflow}</h2>
            <span className="font-mono text-[11px] text-ink-500">{t.dash_local_badge}</span>
          </div>
          <div className="fm-grid-steps overflow-hidden rounded-[20px] border border-hairline shadow-[0_18px_40px_-20px_rgba(0,0,0,0.8)]">
            {steps.map((s) => {
              const disabled = s.needsFiles && fileCount === 0;
              return (
                <button
                  key={s.n}
                  disabled={disabled}
                  onClick={() => onNavigate({ view: s.view, action: s.action })}
                  className="group relative bg-ink-900 p-[clamp(18px,1.5vw,24px)] text-left transition-colors hover:bg-ink-850 disabled:cursor-default disabled:opacity-65 disabled:hover:bg-ink-900"
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[11px] ${s.done ? 'text-fm-green' : 'text-ink-400'}`}>{s.n}</span>
                    {s.done ? (
                      <span className="h-2 w-2 rounded-full bg-fm-green shadow-[0_0_8px_rgba(31,192,107,0.6)]" aria-hidden />
                    ) : !disabled ? (
                      <span className="text-xs text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-200">→</span>
                    ) : null}
                  </div>
                  <h3 className="mt-5 font-display text-[18px] leading-tight text-ink-50">{s.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">{s.desc}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Poslední projekty */}
        <section className="mt-9">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="fm-eyebrow">{t.dash_recent_projects}</h2>
            <button onClick={() => onNavigate({ view: 'projects' })} className="text-[12px] text-ink-400 hover:text-ink-100">
              {t.dash_show_all} →
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-ink-900/50 px-5 py-4">
              <p className="text-[13px] text-ink-400">{t.dash_no_projects}</p>
              <button onClick={() => onNavigate({ view: 'projects' })} className="fm-btn-ghost h-9 px-4 text-xs">
                {t.nav_projects} →
              </button>
            </div>
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
