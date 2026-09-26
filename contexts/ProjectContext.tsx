import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Client, Project } from '../types';
import { projectStorage } from '../services/projectStorage';

interface ProjectContextType {
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  clients: Client[];
  projects: Project[];
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addClient: (client: Omit<Client, 'id' | 'createdAt'>) => void;
}

const LEGACY_DEMO_IDS = new Set(['c1', 'c2', 'c3', 'p1', 'p2', 'p3']);

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectStorage.load().then((data) => {
      if (cancelled) return;
      // Dřívější verze při prvním spuštění vkládala ukázkové zakázky (c1–c3, p1–p3).
      // Skutečné záznamy mají id s časovou značkou, takže ty ukázkové jde bezpečně odfiltrovat.
      setClients((data?.clients ?? []).filter((client) => !LEGACY_DEMO_IDS.has(client.id)));
      setProjects((data?.projects ?? []).filter((project) => !LEGACY_DEMO_IDS.has(project.id)));
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Ukládat až po hydrataci — jinak první render přepíše storage prázdnými poli.
  useEffect(() => {
    if (!hydrated) return;
    projectStorage.save({ clients, projects }).catch((error) => {
      console.error('Failed to save CRM storage.', error);
    });
  }, [clients, projects, hydrated]);

  const currentProject = useMemo(() => {
    if (!currentProjectId) return null;
    return projects.find((project) => project.id === currentProjectId) || null;
  }, [currentProjectId, projects]);

  const addClient = (client: Omit<Client, 'id' | 'createdAt'>) => {
    const newClient: Client = {
      ...client,
      id: `c-${Date.now()}-${Math.random()}`,
      createdAt: new Date().toISOString(),
    };
    setClients((prev) => [newClient, ...prev]);
  };

  const addProject = (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newProject: Project = {
      ...project,
      id: `p-${Date.now()}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    };
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(newProject.id);
    return newProject;
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === id
          ? {
              ...project,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : project
      )
    );
  };

  const setCurrentProject = (project: Project | null) => {
    setCurrentProjectId(project ? project.id : null);
  };

  return (
    <ProjectContext.Provider
      value={{
        currentProject,
        setCurrentProject,
        clients,
        projects,
        addProject,
        updateProject,
        addClient,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used within ProjectProvider');
  return context;
};
