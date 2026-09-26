import React, { useState, useEffect, useCallback, useReducer, useRef, Suspense, lazy } from 'react';

// Views (lazy-loaded for faster initial startup)
const DashboardView = lazy(() => import('./components/DashboardView'));
const UploadView = lazy(() => import('./components/UploadView'));
const EditorView = lazy(() => import('./components/EditorView'));
const CullingView = lazy(() => import('./components/CullingView'));
const ProjectsView = lazy(() => import('./components/ProjectsView'));
const ProjectDetailView = lazy(() => import('./components/ProjectDetailView'));
const ClientsView = lazy(() => import('./components/ClientsView'));
const ClientDetailView = lazy(() => import('./components/ClientDetailView'));
const GalleryPreviewView = lazy(() => import('./components/GalleryPreviewView'));

import Sidebar from './components/Sidebar';
import ApiKeyModal from './components/ApiKeyModal';

import type { UploadedFile, View, EditorAction, History, HistoryEntry } from './types';
import { initApiKeyStorage } from './utils/apiKey';
import { normalizeImageFile } from './utils/imageProcessor';
import { useTranslation } from './contexts/LanguageContext';
import { useProject } from './contexts/ProjectContext';

// --- History Reducer ---
const initialHistoryState: History = {
  past: [],
  present: { state: [], actionName: 'Initial State' },
  future: [],
};

function historyReducer(state: History, action: { type: 'SET'; payload: HistoryEntry } | { type: 'UNDO' } | { type: 'REDO' }) {
  const { past, present, future } = state;
  switch (action.type) {
    case 'SET':
      if (action.payload.state === present.state) return state;
      return { past: [...past, present], present: action.payload, future: [] };
    case 'UNDO': {
      if (past.length === 0) return state;
      return { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] };
    }
    case 'REDO': {
      if (future.length === 0) return state;
      return { past: [...past, present], present: future[0], future: future.slice(1) };
    }
    default:
      return state;
  }
}

interface Notification {
  id: number;
  message: string;
  type: 'info' | 'error';
}

const Loading = () => (
  <div className="flex flex-1 items-center justify-center">
    <span className="fm-spinner" />
  </div>
);

function App() {
  const { t } = useTranslation();
  const { projects, currentProject, setCurrentProject, updateProject } = useProject();
  const [view, setView] = useState<View>('dashboard');
  const [history, dispatchHistory] = useReducer(historyReducer, initialHistoryState);
  const { present: { state: files } } = history;

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<EditorAction>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [currentClientId, setCurrentClientId] = useState<string | null>(null);
  const [galleryProjectId, setGalleryProjectId] = useState<string | null>(null);
  const filesRef = useRef(files);
  const activeFileIdRef = useRef(activeFileId);
  filesRef.current = files;
  activeFileIdRef.current = activeFileId;

  useEffect(() => {
    initApiKeyStorage();
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const syncFromLocation = () => {
      const path = window.location.pathname;
      if (path.startsWith('/projects/')) {
        const id = path.split('/')[2];
        const project = projects.find((item) => item.id === id);
        if (project) setCurrentProject(project);
        setGalleryProjectId(null);
        setView('project-detail');
      } else if (path === '/projects') {
        setCurrentProject(null);
        setGalleryProjectId(null);
        setView('projects');
      } else if (path.startsWith('/clients/')) {
        setCurrentClientId(path.split('/')[2] || null);
        setGalleryProjectId(null);
        setView('client-detail');
      } else if (path === '/clients') {
        setCurrentProject(null);
        setGalleryProjectId(null);
        setView('clients');
      } else if (path.startsWith('/gallery/')) {
        setGalleryProjectId(path.split('/')[2] || null);
        setView('gallery-preview');
      }
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [projects, setCurrentProject]);

  const setFiles = useCallback((newState: UploadedFile[] | ((prevState: UploadedFile[]) => UploadedFile[]), actionName: string) => {
    const newFiles = typeof newState === 'function' ? newState(filesRef.current) : newState;
    dispatchHistory({ type: 'SET', payload: { state: newFiles, actionName } });
    const currentActive = activeFileIdRef.current;
    if (newFiles.length > 0 && (!currentActive || !newFiles.find((f) => f.id === currentActive))) {
      setActiveFileId(newFiles[0].id);
    }
    if (newFiles.length === 0) setActiveFileId(null);
  }, []);

  const addNotification = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setNotifications((n) => [...n, { id, message, type }]);
    setTimeout(() => setNotifications((n) => n.filter((item) => item.id !== id)), 5000);
  }, []);

  const prepareUploadedFiles = useCallback(async (selectedFiles: File[]) => {
    // U formátů, které skutečně vyžadují převod, držíme nízký souběh.
    // JPEG má v normalizeImageFile rychlou bezztrátovou cestu a canvas vůbec nepoužije.
    const results: Array<UploadedFile | null> = new Array(selectedFiles.length).fill(null);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(2, selectedFiles.length) }, async () => {
      while (nextIndex < selectedFiles.length) {
        const index = nextIndex++;
        const file = selectedFiles[index];
        if (file.size === 0) {
          addNotification(`${file.name}: ${t.upload_empty_file}`, 'error');
          continue;
        }
        try {
          const normalizedFile = await normalizeImageFile(file);
          const previewUrl = URL.createObjectURL(normalizedFile);
          results[index] = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            file: normalizedFile,
            previewUrl,
            originalPreviewUrl: previewUrl,
          };
        } catch (error) {
          console.error('File processing error:', error);
          addNotification(`${t.msg_error}: ${file.name}`, 'error');
        }
      }
    });
    await Promise.all(workers);
    return results.filter((result): result is UploadedFile => result !== null);
  }, [addNotification, t.msg_error, t.upload_empty_file]);

  const syncFilesToCurrentProject = useCallback((newFiles: UploadedFile[], description: string) => {
    if (!currentProject || newFiles.length === 0) return;
    updateProject(currentProject.id, {
      files: [...currentProject.files, ...newFiles],
      status: 'editing',
      activity: [
        ...currentProject.activity,
        { id: `a-${Date.now()}`, type: 'uploaded', timestamp: new Date().toISOString(), description },
      ],
    });
  }, [currentProject, updateProject]);

  const handleNavigate = useCallback(({ view: newView, action, id }: { view: View; action?: string; id?: string }) => {
    if ((newView === 'editor' || newView === 'culling') && filesRef.current.length === 0) {
      addNotification(t.editor_no_image, 'error');
      return;
    }
    const push = (path: string) => window.history.pushState({}, '', path);
    if (newView === 'projects' || newView === 'clients') {
      setCurrentProject(null);
      setCurrentClientId(null);
      setGalleryProjectId(null);
      push(`/${newView}`);
    }
    if (newView === 'project-detail' && id) {
      const project = projects.find((item) => item.id === id);
      if (project) {
        setCurrentProject(project);
        setFiles(project.files, 'Loaded project files');
      }
      push(`/projects/${id}`);
    }
    if (newView === 'client-detail' && id) {
      setCurrentClientId(id);
      push(`/clients/${id}`);
    }
    if (newView === 'gallery-preview' && id) {
      setGalleryProjectId(id);
      push(`/gallery/${id}`);
    }
    if (newView === 'dashboard' || newView === 'upload' || newView === 'editor' || newView === 'culling') {
      if (window.location.pathname !== '/') push('/');
    }
    setView(newView);
    setActiveAction(action ? { action, timestamp: Date.now() } : null);
  }, [addNotification, t.editor_no_image, projects, setCurrentProject, setFiles]);

  // Po importu: víc fotek → nejdřív výběr, jedna fotka → rovnou úpravy.
  const handleFilesSelected = useCallback(async (selectedFiles: File[]) => {
    const validFiles = await prepareUploadedFiles(selectedFiles);
    if (validFiles.length === 0) return;
    const total = filesRef.current.length + validFiles.length;
    setFiles((current) => [...current, ...validFiles], `Import ${validFiles.length}`);
    addNotification(`${validFiles.length} ${t.notify_upload_success}`, 'info');
    syncFilesToCurrentProject(validFiles, `${validFiles.length} ${t.notify_upload_success}`);
    if (total > 1) {
      setView('culling');
      setActiveAction(null);
    } else {
      setActiveFileId(validFiles[0].id);
      setView('editor');
      setActiveAction({ action: 'base-edit', timestamp: Date.now() });
    }
  }, [addNotification, prepareUploadedFiles, setFiles, syncFilesToCurrentProject, t.notify_upload_success]);

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);
  const openApiKey = () => setShowApiKeyModal(true);

  const renderView = () => {
    switch (view) {
      case 'upload':
        return <UploadView title={t.nav_upload} onToggleSidebar={toggleSidebar} onFilesSelected={handleFilesSelected} addNotification={addNotification} projectName={currentProject?.name} />;
      case 'editor':
        return (
          <EditorView
            files={files}
            activeFileId={activeFileId}
            onSetFiles={setFiles}
            onSetActiveFileId={setActiveFileId}
            activeAction={activeAction}
            addNotification={addNotification}
            history={history}
            onUndo={() => dispatchHistory({ type: 'UNDO' })}
            onRedo={() => dispatchHistory({ type: 'REDO' })}
            onNavigate={handleNavigate}
            onOpenApiKeyModal={openApiKey}
            onToggleSidebar={toggleSidebar}
          />
        );
      case 'culling':
        return (
          <CullingView
            title={t.pipeline_step_culling}
            onToggleSidebar={toggleSidebar}
            onOpenApiKeyModal={openApiKey}
            files={files}
            onSetFiles={setFiles}
            addNotification={addNotification}
            onDone={() => {
              setView('editor');
              setActiveAction({ action: 'base-edit', timestamp: Date.now() });
            }}
          />
        );
      case 'projects':
      case 'project-detail': {
        const openUploadFor = (id: string) => {
          const project = projects.find((item) => item.id === id);
          if (project) setCurrentProject(project);
          handleNavigate({ view: 'upload' });
        };
        return view === 'project-detail' && currentProject ? (
          <ProjectDetailView
            title={t.nav_projects}
            onToggleSidebar={toggleSidebar}
            projectId={currentProject.id}
            onStartUpload={() => handleNavigate({ view: 'upload' })}
            onOpenEditor={(fileId) => {
              setActiveFileId(fileId);
              setView('editor');
            }}
            onOpenGalleryPreview={() => handleNavigate({ view: 'gallery-preview', id: currentProject.id })}
          />
        ) : (
          <ProjectsView
            title={t.nav_projects}
            onToggleSidebar={toggleSidebar}
            onOpenProject={(id) => handleNavigate({ view: 'project-detail', id })}
            onStartUploadForProject={openUploadFor}
          />
        );
      }
      case 'clients':
      case 'client-detail':
        return view === 'client-detail' && currentClientId ? (
          <ClientDetailView
            title={t.nav_clients}
            onToggleSidebar={toggleSidebar}
            clientId={currentClientId}
            onOpenProject={(id) => handleNavigate({ view: 'project-detail', id })}
          />
        ) : (
          <ClientsView title={t.nav_clients} onToggleSidebar={toggleSidebar} onOpenClient={(id) => handleNavigate({ view: 'client-detail', id })} />
        );
      default:
        return <DashboardView onNavigate={handleNavigate} onToggleSidebar={toggleSidebar} fileCount={files.length} />;
    }
  };

  if (view === 'gallery-preview' && galleryProjectId) {
    return (
      <Suspense fallback={<Loading />}>
        <GalleryPreviewView projectId={galleryProjectId} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden font-sans">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNavigate={handleNavigate}
        onOpenApiKeyModal={openApiKey}
        currentView={view}
        activeAction={activeAction}
        fileCount={files.length}
      />
      <main className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <Suspense fallback={<Loading />}>{renderView()}</Suspense>
      </main>

      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />

      <div className="fixed right-4 top-4 z-[250] w-[calc(100%-2rem)] max-w-sm space-y-2" aria-live="polite">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`fm-surface flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] animate-fade-in ${
              n.type === 'error' ? 'text-[#ffb3c0]' : 'text-ink-100'
            }`}
          >
            <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${n.type === 'error' ? 'bg-fm-red' : 'bg-fm-green'}`} />
            <span className="flex-1 leading-relaxed">{n.message}</span>
            <button
              onClick={() => setNotifications((current) => current.filter((item) => item.id !== n.id))}
              className="-mr-1 text-ink-500 hover:text-ink-100"
              aria-label="×"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
