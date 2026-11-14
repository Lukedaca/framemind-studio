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
      <Header title={title} onToggleSidebar={onToggleSidebar} />

      <div className="fm-page w-full space-y-8 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl text-ink-50">{t.crm_clients_title}</h2>
            <p className="text-sm text-text-secondary">{t.crm_clients_desc}</p>
          </div>
          <button
            onClick={() => setIsClientModalOpen(true)}
            className="fm-btn-primary px-5"
          >
            {t.crm_new_client}
          </button>
        </div>

        {clients.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/20 bg-ink-900/40 px-6 py-16 text-center">
            <h3 className="font-display text-2xl text-ink-100">{t.crm_no_clients}</h3>
            <button onClick={() => setIsClientModalOpen(true)} className="fm-btn-primary mt-6 px-6">{t.crm_new_client}</button>
          </div>
        ) : (
          <div className="fm-grid-cards">
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

