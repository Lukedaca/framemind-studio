import React, { useMemo, useState } from 'react';
import Header from './Header';
import ProjectCard from './ProjectCard';
import ProjectModal from './ProjectModal';
import ClientModal from './ClientModal';
import { useProject } from '../contexts/ProjectContext';
import { useTranslation } from '../contexts/LanguageContext';
import type { ProjectStatus } from '../types';

interface ProjectsViewProps {
  title: string;
  onToggleSidebar: () => void;
  onOpenProject: (id: string) => void;
  onStartUploadForProject: (id: string) => void;
  onOpenApiKeyModal?: () => void;
}

const statusFilters = [
  { id: 'all', labelKey: 'crm_filter_all' },
  { id: 'draft', labelKey: 'status_draft' },
  { id: 'editing', labelKey: 'status_editing' },
  { id: 'review', labelKey: 'status_review' },
  { id: 'delivered', labelKey: 'status_delivered' },
] as const;

const ProjectsView: React.FC<ProjectsViewProps> = ({ title, onToggleSidebar, onOpenProject, onStartUploadForProject, onOpenApiKeyModal }) => {
  const { t } = useTranslation();
  const { projects, clients, addProject, addClient } = useProject();
  const [filter, setFilter] = useState<'all' | ProjectStatus>('all');
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);

  const filteredProjects = useMemo(() => {
    if (filter === 'all') return projects;
    return projects.filter((project) => project.status === filter);
  }, [filter, projects]);

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar">
      <Header title={title} onToggleSidebar={onToggleSidebar} />

      <div className="fm-page w-full space-y-8 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl text-ink-50">{t.crm_projects_title}</h2>
            <p className="text-sm text-text-secondary">{t.crm_projects_desc}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsClientModalOpen(true)}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-border-subtle text-text-primary hover:border-accent/40"
            >
              {t.crm_new_client_short}
            </button>
            <button
              onClick={() => setIsProjectModalOpen(true)}
              className="fm-btn-primary px-5"
            >
              {t.crm_new_project}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {statusFilters.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === item.id
                  ? 'bg-accent/20 border-accent/50 text-accent'
                  : 'bg-elevated border-border-subtle text-text-secondary hover:border-accent/40'
              }`}
            >
              {t[item.labelKey as keyof typeof t]}
            </button>
          ))}
        </div>

        {filteredProjects.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/20 bg-ink-900/40 px-6 py-16 text-center">
            <h3 className="font-display text-2xl text-ink-100">{filter === 'all' ? t.crm_no_projects : t.crm_no_filtered_projects}</h3>
            <button onClick={() => filter === 'all' ? setIsProjectModalOpen(true) : setFilter('all')} className="fm-btn-primary mt-6 px-6">
              {filter === 'all' ? t.crm_new_project : t.crm_filter_all}
            </button>
          </div>
        ) : (
          <div className="fm-grid-cards">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                client={clients.find((client) => client.id === project.clientId)}
                onOpen={() => onOpenProject(project.id)}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectModal
        isOpen={isProjectModalOpen}
        clients={clients}
        onClose={() => setIsProjectModalOpen(false)}
        onCreate={(payload) => {
          const newProject = addProject(payload);
          onStartUploadForProject(newProject.id);
        }}
        onCreateClientRequest={() => {
          setIsProjectModalOpen(false);
          setIsClientModalOpen(true);
        }}
      />

      <ClientModal
        isOpen={isClientModalOpen}
        onClose={() => setIsClientModalOpen(false)}
        onCreate={(client) => addClient(client)}
      />
    </div>
  );
};

export default ProjectsView;


