import React from 'react';
import Header from './Header';
import { useProject } from '../contexts/ProjectContext';
import { useTranslation } from '../contexts/LanguageContext';
import ProjectCard from './ProjectCard';

interface ClientDetailViewProps {
  title: string;
  onToggleSidebar: () => void;
  clientId: string;
  onOpenProject: (id: string) => void;
  onOpenApiKeyModal?: () => void;
}

const ClientDetailView: React.FC<ClientDetailViewProps> = ({ title, onToggleSidebar, clientId, onOpenProject, onOpenApiKeyModal }) => {
  const { t } = useTranslation();
  const { clients, projects } = useProject();
  const client = clients.find((item) => item.id === clientId);
  const clientProjects = projects.filter((project) => project.clientId === clientId);

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar">
      <Header title={title} onToggleSidebar={onToggleSidebar} onOpenApiKeyModal={onOpenApiKeyModal} />

      <div className="p-6 lg:p-12 max-w-6xl mx-auto w-full space-y-8 animate-fade-in">
        {!client ? (
          <div className="bg-surface/40 border border-border-subtle rounded-3xl p-12 text-center text-text-secondary">
            {t.crm_client_missing}
          </div>
        ) : (
          <>
            <div className="bg-surface/40 border border-border-subtle rounded-3xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-black text-white">{client.name}</h2>
                  <p className="text-sm text-text-secondary">{client.email}</p>
                </div>
                {client.phone && (
                  <span className="px-4 py-2 rounded-full border border-border-subtle text-xs text-text-primary">
                    {client.phone}
                  </span>
                )}
              </div>
              {client.notes && (
                <p className="text-sm text-text-secondary">{client.notes}</p>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-text-secondary">
                {t.crm_projects_title}
              </h3>
              {clientProjects.length === 0 ? (
                <div className="bg-surface/40 border border-border-subtle rounded-3xl p-10 text-center text-text-secondary">
                  {t.crm_no_projects}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {clientProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      client={client}
                      onOpen={() => onOpenProject(project.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ClientDetailView;

