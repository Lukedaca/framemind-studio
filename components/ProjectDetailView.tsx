import React, { useEffect, useMemo, useState } from 'react';
import Header from './Header';
import StatusBadge from './StatusBadge';
import GallerySettingsPanel from './GallerySettingsPanel';
import ActivityTimeline from './ActivityTimeline';
import { useProject } from '../contexts/ProjectContext';
import { useTranslation } from '../contexts/LanguageContext';
import type { ProjectStatus, UploadedFile } from '../types';

interface ProjectDetailViewProps {
  title: string;
  onToggleSidebar: () => void;
  projectId: string;
  onStartUpload: () => void;
  onOpenEditor: (fileId: string) => void;
  onOpenGalleryPreview: () => void;
  onOpenApiKeyModal?: () => void;
}

const tabs = ['info', 'photos', 'gallery', 'activity'] as const;

const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
  title,
  onToggleSidebar,
  projectId,
  onStartUpload,
  onOpenEditor,
  onOpenGalleryPreview,
  onOpenApiKeyModal,
}) => {
  const { t } = useTranslation();
  const { clients, projects, updateProject } = useProject();
  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('info');

  useEffect(() => {
    setActiveTab('info');
  }, [projectId]);

  if (!project) {
    return (
      <div className="w-full h-full flex flex-col">
        <Header title={title} onToggleSidebar={onToggleSidebar} onOpenApiKeyModal={onOpenApiKeyModal} />
        <div className="flex-1 flex items-center justify-center text-text-secondary">
          {t.crm_project_missing}
        </div>
      </div>
    );
  }

  const client = clients.find((item) => item.id === project.clientId);
  const typeLabel: Record<string, string> = {
    portrait: t.template_portrait,
    event: t.template_event,
    product: t.template_product,
    social: t.template_social,
  };

  const handleStatusChange = (status: ProjectStatus) => {
    updateProject(project.id, { status });
  };

  const handleNotesChange = (notes: string) => {
    updateProject(project.id, { notes });
  };

  const handleGalleryUpdate = (updates: Partial<typeof project>) => {
    updateProject(project.id, updates);
  };

  const selectedSet = new Set(project.gallery.selectedFileIds);

  const toggleGalleryFile = (fileId: string) => {
    const nextSelected = selectedSet.has(fileId)
      ? project.gallery.selectedFileIds.filter((id) => id !== fileId)
      : [...project.gallery.selectedFileIds, fileId];
    updateProject(project.id, {
      gallery: {
        ...project.gallery,
        selectedFileIds: nextSelected,
      },
    });
  };

  const renderPhotos = (files: UploadedFile[]) => {
    if (files.length === 0) {
      return <div className="text-sm text-text-secondary">{t.crm_no_files}</div>;
    }

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {files.map((file) => (
          <button
            key={file.id}
            onClick={() => onOpenEditor(file.id)}
            className="relative aspect-[4/3] rounded-2xl overflow-hidden border border-border-subtle hover:border-accent/60 transition-all group"
          >
            <img src={file.previewUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white">
              {t.crm_open_in_editor}
            </div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar">
      <Header title={title} onToggleSidebar={onToggleSidebar} onOpenApiKeyModal={onOpenApiKeyModal} />

      <div className="p-6 lg:p-12 max-w-6xl mx-auto w-full space-y-8 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black text-white">{project.name}</h2>
            <p className="text-sm text-text-secondary">{client ? client.name : t.crm_unknown_client}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={project.status} />
            <button
              onClick={onStartUpload}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-border-subtle text-text-primary hover:border-accent/40"
            >
              {t.crm_upload_to_project}
            </button>
            {project.gallery.published && (
              <button
                onClick={onOpenGalleryPreview}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-accent/40 text-accent"
              >
                {t.crm_open_gallery}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-widest border ${
                activeTab === tab
                  ? 'bg-accent/20 border-accent/50 text-accent'
                  : 'bg-elevated border-border-subtle text-text-secondary hover:border-accent/40'
              }`}
            >
              {t[`crm_tab_${tab}` as keyof typeof t]}
            </button>
          ))}
        </div>

        {activeTab === 'info' && (
          <div className="bg-surface/40 border border-border-subtle rounded-3xl p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-text-secondary">{t.crm_project_type}</div>
                <div className="text-sm text-text-primary mt-2">{typeLabel[project.type] || project.type}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-text-secondary">{t.crm_project_date}</div>
                <div className="text-sm text-text-primary mt-2">{project.date}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-text-secondary">{t.crm_status}</div>
                <select
                  value={project.status}
                  onChange={(event) => handleStatusChange(event.target.value as ProjectStatus)}
                  className="mt-2 w-full bg-surface/60 border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="draft">{t.status_draft}</option>
                  <option value="editing">{t.status_editing}</option>
                  <option value="review">{t.status_review}</option>
                  <option value="delivered">{t.status_delivered}</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.2em] text-text-secondary">{t.crm_notes}</div>
              <textarea
                value={project.notes || ''}
                onChange={(event) => handleNotesChange(event.target.value)}
                className="w-full min-h-[120px] bg-surface/60 border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>
        )}

        {activeTab === 'photos' && (
          <div className="bg-surface/40 border border-border-subtle rounded-3xl p-6">
            {renderPhotos(project.files)}
          </div>
        )}

        {activeTab === 'gallery' && (
          <div className="space-y-6">
            <GallerySettingsPanel project={project} onUpdate={handleGalleryUpdate} />
            {project.files.length === 0 ? (
              <div className="bg-surface/40 border border-border-subtle rounded-3xl p-6 text-sm text-text-secondary">
                {t.crm_no_files}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {project.files.map((file) => {
                  const isSelected = selectedSet.has(file.id);
                  return (
                    <button
                      key={file.id}
                      onClick={() => toggleGalleryFile(file.id)}
                      className={`relative aspect-[4/3] rounded-2xl overflow-hidden border transition-all ${
                        isSelected ? 'border-accent/70 ring-2 ring-accent/30' : 'border-border-subtle'
                      }`}
                    >
                      <img src={file.previewUrl} alt="" className="w-full h-full object-cover" />
                      <div className={`absolute inset-0 ${isSelected ? 'bg-accent/10' : 'bg-black/10'}`} />
                      <div className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full bg-black/60 text-white">
                        {isSelected ? t.crm_selected : t.crm_select}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="bg-surface/40 border border-border-subtle rounded-3xl p-6">
            <ActivityTimeline activity={project.activity} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDetailView;


