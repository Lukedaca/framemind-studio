import React, { useMemo, useState } from 'react';
import Header from './Header';
import ClientCard from './ClientCard';
import ClientModal from './ClientModal';
import { useProject } from '../contexts/ProjectContext';
import { useTranslation } from '../contexts/LanguageContext';

interface ClientsViewProps {
  title: string;
  onToggleSidebar: () => void;
  onOpenClient: (id: string) => void;
  onOpenApiKeyModal?: () => void;
}

const ClientsView: React.FC<ClientsViewProps> = ({ title, onToggleSidebar, onOpenClient, onOpenApiKeyModal }) => {
  const { t } = useTranslation();
  const { clients, projects, addClient } = useProject();
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);

  const projectCountByClient = useMemo(() => {
    return clients.reduce<Record<string, number>>((acc, client) => {
      acc[client.id] = projects.filter((project) => project.clientId === client.id).length;
      return acc;
    }, {});
  }, [clients, projects]);

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar">
      <Header title={title} onToggleSidebar={onToggleSidebar} onOpenApiKeyModal={onOpenApiKeyModal} />

      <div className="p-6 lg:p-12 max-w-7xl mx-auto w-full space-y-8 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black text-white">{t.crm_clients_title}</h2>
            <p className="text-sm text-text-secondary">{t.crm_clients_desc}</p>
          </div>
          <button
            onClick={() => setIsClientModalOpen(true)}
            className="px-5 py-2.5 border border-accent bg-accent text-sm font-semibold text-void transition-none"
          >
            {t.crm_new_client}
          </button>
        </div>

        {clients.length === 0 ? (
          <div className="bg-surface/40 border border-border-subtle rounded-3xl p-12 text-center text-text-secondary">
            {t.crm_no_clients}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                projectCount={projectCountByClient[client.id] || 0}
                onOpen={() => onOpenClient(client.id)}
              />
            ))}
          </div>
        )}
      </div>

      <ClientModal
        isOpen={isClientModalOpen}
        onClose={() => setIsClientModalOpen(false)}
        onCreate={(client) => addClient(client)}
      />
    </div>
  );
};

export default ClientsView;

