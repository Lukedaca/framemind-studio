import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Client, EditorWorkspace, Project } from '../types';
import { projectStorage } from '../services/projectStorage';

interface ProjectContextType {
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  clients: Client[];
  projects: Project[];
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addClient: (client: Omit<Client, 'id' | 'createdAt'>) => void;
  workspace: EditorWorkspace | null;
  saveWorkspace: (workspace: EditorWorkspace) => void;
  storageReady: boolean;
  storageStatus: 'loading' | 'saving' | 'saved' | 'error';
  storageError: string | null;
  retryStorage: () => void;
}

const LEGACY_DEMO_IDS = new Set(['c1', 'c2', 'c3', 'p1', 'p2', 'p3']);

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [workspace, setWorkspace] = useState<EditorWorkspace | null>(null);
  const [storageStatus, setStorageStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    setStorageStatus('loading');
    projectStorage.load().then((data) => {
      if (cancelled) return;
      // Dřívější verze při prvním spuštění vkládala ukázkové zakázky (c1–c3, p1–p3).
      // Skutečné záznamy mají id s časovou značkou, takže ty ukázkové jde bezpečně odfiltrovat.
      setClients((data?.clients ?? []).filter((client) => !LEGACY_DEMO_IDS.has(client.id)));
      setProjects((data?.projects ?? []).filter((project) => !LEGACY_DEMO_IDS.has(project.id)));
      setWorkspace(data?.workspace ?? null);
      setStorageError(null);
      setHydrated(true);
    }).catch((error) => {
      if (cancelled) return;
      setStorageError(error instanceof Error ? error.message : String(error));
      setStorageStatus('error');
    });
    return () => { cancelled = true; };
  }, [hydrated, retry]);

  // Ukládat až po hydrataci — jinak první render přepíše storage prázdnými poli.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setStorageStatus('saving');
    projectStorage.save({ clients, projects, workspace }).then(() => {
      if (!cancelled) { setStorageStatus('saved'); setStorageError(null); }
    }).catch((error) => {
      console.error('Failed to save CRM storage.', error);
      if (!cancelled) {
        setStorageStatus('error');
        setStorageError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { cancelled = true; };
  }, [clients, projects, workspace, hydrated, retry]);

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

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
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
  }, []);

  const setCurrentProject = useCallback((project: Project | null) => {
    setCurrentProjectId(project ? project.id : null);
  }, []);

  const saveWorkspace = useCallback((next: EditorWorkspace) => {
    setWorkspace(previous => previous?.history === next.history && previous.activeFileId === next.activeFileId && previous.projectId === next.projectId ? previous : next);
    if (!next.projectId) return;
    setProjects(previous => previous.map(project => {
      if (project.id !== next.projectId || (project.editorHistory === next.history && project.editorActiveFileId === next.activeFileId)) return project;
      return { ...project, files: next.history.present.state, editorHistory: next.history, editorActiveFileId: next.activeFileId, updatedAt: new Date().toISOString() };
    }));
  }, []);
  const retryStorage = useCallback(() => setRetry(value => value + 1), []);

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
        workspace,
        saveWorkspace,
        storageReady: hydrated,
        storageStatus,
        storageError,
        retryStorage,
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
