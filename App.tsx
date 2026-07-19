
import React, { useState, useEffect, useCallback, useReducer, useRef, Suspense, lazy } from 'react';

// Views (lazy-loaded for faster initial startup)
const HomeView = lazy(() => import('./components/HomeView'));
const DashboardView = lazy(() => import('./components/DashboardView'));
const UploadView = lazy(() => import('./components/UploadView'));
const EditorView = lazy(() => import('./components/EditorView'));
const BatchView = lazy(() => import('./components/BatchView'));
const CullingView = lazy(() => import('./components/CullingView'));
const AICommandCenter = lazy(() => import('./components/ai/AICommandCenter'));
const GenerateImageView = lazy(() => import('./components/GenerateImageView'));
const RAWConverterView = lazy(() => import('./components/RAWConverterView'));
const ProjectsView = lazy(() => import('./components/ProjectsView'));
const ProjectDetailView = lazy(() => import('./components/ProjectDetailView'));
const ClientsView = lazy(() => import('./components/ClientsView'));
const ClientDetailView = lazy(() => import('./components/ClientDetailView'));
const GalleryPreviewView = lazy(() => import('./components/GalleryPreviewView'));
const AIGalleryView = lazy(() => import('./components/AIGalleryView'));

// Components
import Sidebar from './components/Sidebar';
import OnboardingModal from './components/OnboardingModal';
import CreditPurchaseModal from './components/CreditPurchaseModal';
import JobTemplateModal from './components/JobTemplateModal';
import WorkflowStepper from './components/WorkflowStepper';
import ApiKeyModal from './components/ApiKeyModal';
import { XCircleIcon } from './components/icons';

// Types
import type { UploadedFile, View, EditorAction, History, HistoryEntry, Preset, JobTemplate, WorkflowStep } from './types';

// Utils & Services
import { clearLegacyKeys, enableSessionOnlyAutoClear } from './utils/apiKey';
import { normalizeImageFile } from './utils/imageProcessor';
import { getPresets, getUserProfile, updateCredits, markOnboardingSeen } from './services/userProfileService';
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
            if (action.payload.state === present.state) {
                return state;
            }
            return {
                past: [...past, present],
                present: action.payload,
                future: [],
            };
        case 'UNDO':
            if (past.length === 0) return state;
            const previous = past[past.length - 1];
            const newPast = past.slice(0, past.length - 1);
            return {
                past: newPast,
                present: previous,
                future: [present, ...future],
            };
        case 'REDO':
            if (future.length === 0) return state;
            const next = future[0];
            const newFuture = future.slice(1);
            return {
                past: [...past, present],
                present: next,
                future: newFuture,
            };
        default:
            return state;
    }
}

interface Notification {
  id: number;
  message: string;
  type: 'info' | 'error';
}

function App() {
  const { t } = useTranslation();
  const { projects, currentProject, setCurrentProject, updateProject } = useProject();
  const [view, setView] = useState<View>('home');
  const [history, dispatchHistory] = useReducer(historyReducer, initialHistoryState);
  const { present: { state: files } } = history;

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<EditorAction>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  
  // Pipeline Logic
  const [credits, setCredits] = useState(50);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [currentJobTemplate, setCurrentJobTemplate] = useState<JobTemplate>('none');
  const [currentClientId, setCurrentClientId] = useState<string | null>(null);
  const [galleryProjectId, setGalleryProjectId] = useState<string | null>(null);
  const creditOperationInProgress = useRef(false);
  const filesRef = useRef(files);
  const activeFileIdRef = useRef(activeFileId);

  filesRef.current = files;
  activeFileIdRef.current = activeFileId;

  // --- Effects ---

  useEffect(() => {
    clearLegacyKeys();
    enableSessionOnlyAutoClear();
  }, []);

  useEffect(() => {
      const profile = getUserProfile();
      setUserPresets(profile.presets);
      setCredits(profile.credits);
      setIsAdmin(profile.isAdmin);

      if (!profile.hasSeenOnboarding) {
          setShowOnboarding(true);
      }
      
      if (profile.isAdmin) {
         setTimeout(() => addNotification("Admin Mode Activated: Unlimited Credits & Master Key Access", "info"), 1000);
      }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const syncFromLocation = () => {
      if (typeof window === 'undefined') return;
      const path = window.location.pathname;
      if (path.startsWith('/projects/')) {
        const id = path.split('/')[2];
        const project = projects.find((item) => item.id === id);
        if (project) {
          setCurrentProject(project);
        }
        setGalleryProjectId(null);
        setView('project-detail');
        return;
      }
      if (path === '/projects') {
        setCurrentProject(null);
        setGalleryProjectId(null);
        setView('projects');
        return;
      }
      if (path.startsWith('/clients/')) {
        const id = path.split('/')[2];
        setCurrentClientId(id || null);
        setGalleryProjectId(null);
        setView('client-detail');
        return;
      }
      if (path === '/clients') {
        setCurrentProject(null);
        setGalleryProjectId(null);
        setView('clients');
        return;
      }
      if (path.startsWith('/gallery/')) {
        const id = path.split('/')[2];
        setGalleryProjectId(id || null);
        setView('gallery-preview');
        return;
      }
    };

    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [projects, setCurrentProject]);

  // --- Handlers ---

  const handleDeductCredits = useCallback(async (amount: number): Promise<boolean> => {
      if (isAdmin) return true;
      if (creditOperationInProgress.current) {
        console.warn('Credit operation already in progress');
        return false;
      }

      creditOperationInProgress.current = true;
      try {
        const currentProfile = getUserProfile();
        const currentCredits = currentProfile.credits;
        if (currentCredits >= amount) {
            const newTotal = updateCredits(-amount);
            setCredits(newTotal);
            return true;
        }
        setShowPurchaseModal(true);
        return false;
      } finally {
        creditOperationInProgress.current = false;
      }
  }, [isAdmin]);

  const handlePurchaseCredits = (amount: number) => {
      const newTotal = updateCredits(amount);
      setCredits(newTotal);
      setShowPurchaseModal(false);
      addNotification(`${t.store_success} +${amount} credits`, 'info');
  };
  
  const handleOnboardingComplete = () => {
      setShowOnboarding(false);
      markOnboardingSeen();
  };

  const setFiles = useCallback((newState: UploadedFile[] | ((prevState: UploadedFile[]) => UploadedFile[]), actionName: string) => {
    const previousFiles = filesRef.current;
    const newFiles = typeof newState === 'function' ? newState(previousFiles) : newState;
    dispatchHistory({ type: 'SET', payload: { state: newFiles, actionName } });
    const currentActiveFileId = activeFileIdRef.current;
    if (newFiles.length > 0 && (!currentActiveFileId || !newFiles.find(f => f.id === currentActiveFileId))) {
      setActiveFileId(newFiles[0].id);
    }
    if (newFiles.length === 0) {
      setActiveFileId(null);
    }
  }, []);

  const addNotification = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    const id = Date.now();
    setNotifications(n => [...n, { id, message, type }]);
    setTimeout(() => {
      setNotifications(n => n.filter(notif => notif.id !== id));
    }, 5000);
  }, []);

  const prepareUploadedFiles = useCallback(async (selectedFiles: File[]) => {
    const results = await Promise.allSettled(
      selectedFiles.map(async (file): Promise<UploadedFile | null> => {
        if (file.size === 0) {
          addNotification(`Soubor ${file.name} je prázdný (0 bajtů). Zkontrolujte, zda je stažen offline.`, 'error');
          return null;
        }

        try {
          const normalizedFile = await normalizeImageFile(file);
          const previewUrl = URL.createObjectURL(normalizedFile);
          return {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: normalizedFile,
            previewUrl,
            originalPreviewUrl: previewUrl,
          };
        } catch (error) {
          console.error('File processing error:', error);
          addNotification(`${t.msg_error}: ${file.name}`, 'error');
          return null;
        }
      })
    );

    return results
      .filter((result): result is PromiseFulfilledResult<UploadedFile> => result.status === 'fulfilled' && result.value !== null)
      .map((result) => result.value);
  }, [addNotification, t.msg_error]);

  const syncFilesToCurrentProject = useCallback((newFiles: UploadedFile[], description: string) => {
    if (!currentProject || newFiles.length === 0) return;

    updateProject(currentProject.id, {
      files: [...currentProject.files, ...newFiles],
      status: 'editing',
      activity: [
        ...currentProject.activity,
        {
          id: `a-${Date.now()}`,
          type: 'uploaded',
          timestamp: new Date().toISOString(),
          description,
        },
      ],
    });
  }, [currentProject, updateProject]);

  const cleanupFileUrls = useCallback((filesToClean: UploadedFile[]) => {
    filesToClean.forEach(file => {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      if (file.originalPreviewUrl && file.originalPreviewUrl !== file.previewUrl) {
        URL.revokeObjectURL(file.originalPreviewUrl);
      }
    });
  }, []);
  
  const handleToggleSidebar = () => {
    setIsSidebarOpen(prev => !prev);
  };

  const handleNavigate = useCallback(({ view: newView, action, id }: { view: View; action?: string; id?: string }) => {
    if (newView === 'editor' && files.length === 0 && action && action !== 'youtube-thumbnail') {
        addNotification(t.editor_no_image, 'error');
        return;
    }
    if (newView === 'projects') {
      setCurrentProject(null);
      setCurrentClientId(null);
      setGalleryProjectId(null);
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', '/projects');
      }
    }
    if (newView === 'clients') {
      setCurrentProject(null);
      setCurrentClientId(null);
      setGalleryProjectId(null);
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', '/clients');
      }
    }
    if (newView === 'project-detail' && id) {
      const project = projects.find((item) => item.id === id);
      if (project) {
        setCurrentProject(project);
        setFiles(project.files, 'Loaded project files');
      }
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', `/projects/${id}`);
      }
    }
    if (newView === 'client-detail' && id) {
      setCurrentClientId(id);
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', `/clients/${id}`);
      }
    }
    if (newView === 'gallery-preview' && id) {
      setGalleryProjectId(id);
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', `/gallery/${id}`);
      }
    }
    setView(newView);
    if (action) {
      setActiveAction({ action, timestamp: Date.now() });
    } else {
      setActiveAction(null);
    }
  }, [files.length, addNotification, t.editor_no_image, projects, setCurrentProject, setFiles]);

  const handleFilesSelected = useCallback(async (selectedFiles: File[]) => {
    const validFiles = await prepareUploadedFiles(selectedFiles);

    if (validFiles.length > 0) {
      setFiles(
        currentFiles => [...currentFiles, ...validFiles],
        `Uploaded ${validFiles.length} files`
      );
      setShowTemplateModal(true); // Open Pipeline context selector
      addNotification(`${validFiles.length} ${t.notify_upload_success}`, 'info');
      syncFilesToCurrentProject(validFiles, `${validFiles.length} ${t.notify_upload_success}`);
    }
  }, [addNotification, prepareUploadedFiles, setFiles, syncFilesToCurrentProject, t.notify_upload_success]);

  const handleTemplateSelect = (template: JobTemplate) => {
    setCurrentJobTemplate(template);
    setShowTemplateModal(false);
    setView('batch'); // Start with culling after choosing template
    setActiveAction({ action: 'culling', timestamp: Date.now() });
  };

  const handleImageGenerated = useCallback((file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const newFile: UploadedFile = {
      id: `${Date.now()}-${Math.random()}`,
      file: file,
      previewUrl: previewUrl,
      originalPreviewUrl: previewUrl,
    };
    setFiles(currentFiles => [...currentFiles, newFile], 'Generated Image');
    setView('editor');
    addNotification(t.notify_gen_success, 'info');
  }, [addNotification, setFiles, t.notify_gen_success]);

  const handleBatchComplete = useCallback((updatedFiles: { id: string; file: File }[]) => {
    const updatedFilesMap = new Map(updatedFiles.map(f => [f.id, f]));
    setFiles(
      currentFiles => currentFiles.map(cf => {
        if (updatedFilesMap.has(cf.id)) {
          cleanupFileUrls([cf]);
          const newFile = updatedFilesMap.get(cf.id)!;
          return { ...cf, file: newFile.file, previewUrl: URL.createObjectURL(newFile.file) };
        }
        return cf;
      }),
      'Batch Edit'
    );
    setView('editor');
    setActiveAction({ action: 'base-edit', timestamp: Date.now() });
  }, [cleanupFileUrls, setFiles]);
  
  const handleRawFilesConverted = useCallback(async (convertedRawFiles: File[]) => {
      const validFiles = await prepareUploadedFiles(convertedRawFiles);

      if (validFiles.length === 0) return;

      setFiles(
        currentFiles => [...currentFiles, ...validFiles],
        `RAW converted ${validFiles.length} files`
      );
      setActiveFileId(validFiles[0].id);
      setActiveAction({ action: 'base-edit', timestamp: Date.now() });
      setShowTemplateModal(false);
      setView('editor');
      addNotification(t.raw_opened_editor, 'info');
      syncFilesToCurrentProject(validFiles, t.raw_opened_editor);
  }, [addNotification, prepareUploadedFiles, setFiles, syncFilesToCurrentProject, t.raw_opened_editor]);

  const getPipelineStep = (): WorkflowStep => {
    if (view === 'upload' || view === 'raw-converter') return 'import';
    if (view === 'batch' && activeAction?.action === 'culling') return 'culling';
    if (view === 'editor') {
        if (activeAction?.action === 'export') return 'export';
        if (activeAction?.action === 'retouch' || activeAction?.action === 'remove-object') return 'retouch';
        return 'edit';
    }
    return 'import';
  };

  const getPageTitle = () => {
      if (view === 'dashboard') return t.nav_studio;
      if (view === 'upload') return t.nav_upload;
      if (view === 'editor') return t.nav_studio;
      if (view === 'batch') return t.nav_batch;
      if (view === 'generate') return t.gen_title;
      if (view === 'ai-command') return t.nav_ai_command;
      if (view === 'raw-converter') return t.raw_title;
      if (view === 'ai-gallery') return t.nav_ai_gallery;
      if (view === 'projects' || view === 'project-detail') return t.nav_projects;
      if (view === 'clients' || view === 'client-detail') return t.nav_clients;
      return t.app_title;
  }

  const renderView = () => {
    const headerProps = {
        title: getPageTitle(),
        onToggleSidebar: handleToggleSidebar,
        credits: isAdmin ? 9999 : credits,
        onBuyCredits: () => setShowPurchaseModal(true),
        onOpenApiKeyModal: () => setShowApiKeyModal(true),
    };

    const stepper = <WorkflowStepper currentStep={getPipelineStep()} />;

    switch (view) {
      case 'home':
        return <HomeView onEnterApp={() => setView('dashboard')} />;
      case 'dashboard':
        return (
          <DashboardView 
            {...headerProps} 
            onNavigate={handleNavigate} 
            credits={credits} 
            recentHistory={history.past}
            onBuyCredits={() => setShowPurchaseModal(true)}
          />
        );
      case 'upload':
        return (
          <div className="flex-1 flex flex-col h-full">
            <UploadView {...headerProps} onFilesSelected={handleFilesSelected} addNotification={addNotification} projectName={currentProject?.name} />
            {files.length > 0 && stepper}
          </div>
        );
      case 'editor':
        return (
          <div className="flex-1 flex flex-col h-full">
            <EditorView {...headerProps} files={files} activeFileId={activeFileId} onSetFiles={setFiles} onSetActiveFileId={setActiveFileId} activeAction={activeAction} addNotification={addNotification} userPresets={userPresets} onPresetsChange={setUserPresets} history={history} onUndo={() => dispatchHistory({type: 'UNDO'})} onRedo={() => dispatchHistory({type: 'REDO'})} onNavigate={handleNavigate} onOpenApiKeyModal={() => setShowApiKeyModal(true)} credits={credits} onDeductCredits={handleDeductCredits} currentProjectId={currentProject?.id} />
            {stepper}
          </div>
        );
      case 'batch':
        return (
          <div className="flex-1 flex flex-col h-full">
            {activeAction?.action === 'culling' ? (
              <CullingView
                {...headerProps}
                files={files}
                onSetFiles={setFiles}
                addNotification={addNotification}
                onDone={() => {
                  setView('editor');
                  setActiveAction({ action: 'base-edit', timestamp: Date.now() });
                }}
              />
            ) : (
              <BatchView {...headerProps} files={files} onBatchComplete={handleBatchComplete} addNotification={addNotification} onSetFiles={setFiles} mode="batch" />
            )}
            {stepper}
          </div>
        );
      case 'ai-command':
        return (
          <div className="flex-1 flex flex-col h-full">
            <AICommandCenter
              {...headerProps}
              files={files}
              activeFileId={activeFileId}
              onSetFiles={setFiles}
              onSetActiveFileId={setActiveFileId}
              onDeductCredits={handleDeductCredits}
              addNotification={addNotification}
            />
          </div>
        );
      case 'generate':
        return <GenerateImageView {...headerProps} onImageGenerated={handleImageGenerated} onOpenApiKeyModal={() => setShowApiKeyModal(true)} credits={credits} onDeductCredits={handleDeductCredits} currentProjectId={currentProject?.id} />;
      case 'raw-converter':
        return <RAWConverterView {...headerProps} addNotification={addNotification} onFilesConverted={handleRawFilesConverted} />;
      case 'ai-gallery':
        return <AIGalleryView {...headerProps} />;
      case 'projects':
        return (
          <ProjectsView
            title={getPageTitle()}
            onToggleSidebar={handleToggleSidebar}
            onOpenProject={(id) => handleNavigate({ view: 'project-detail', id })}
            onStartUploadForProject={(id) => {
              const project = projects.find((item) => item.id === id);
              if (project) {
                setCurrentProject(project);
              }
              handleNavigate({ view: 'upload' });
            }}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          />
        );
      case 'project-detail':
        return currentProject ? (
          <ProjectDetailView
            title={getPageTitle()}
            onToggleSidebar={handleToggleSidebar}
            projectId={currentProject.id}
            onStartUpload={() => handleNavigate({ view: 'upload' })}
            onOpenEditor={(fileId) => {
              setActiveFileId(fileId);
              setView('editor');
            }}
            onOpenGalleryPreview={() => handleNavigate({ view: 'gallery-preview', id: currentProject.id })}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          />
        ) : (
          <ProjectsView
            title={getPageTitle()}
            onToggleSidebar={handleToggleSidebar}
            onOpenProject={(id) => handleNavigate({ view: 'project-detail', id })}
            onStartUploadForProject={(id) => {
              const project = projects.find((item) => item.id === id);
              if (project) {
                setCurrentProject(project);
              }
              handleNavigate({ view: 'upload' });
            }}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          />
        );
      case 'clients':
        return (
          <ClientsView
            title={getPageTitle()}
            onToggleSidebar={handleToggleSidebar}
            onOpenClient={(id) => handleNavigate({ view: 'client-detail', id })}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          />
        );
      case 'client-detail':
        return currentClientId ? (
          <ClientDetailView
            title={getPageTitle()}
            onToggleSidebar={handleToggleSidebar}
            clientId={currentClientId}
            onOpenProject={(id) => handleNavigate({ view: 'project-detail', id })}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          />
        ) : (
          <ClientsView
            title={getPageTitle()}
            onToggleSidebar={handleToggleSidebar}
            onOpenClient={(id) => handleNavigate({ view: 'client-detail', id })}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          />
        );
      default:
        return <DashboardView {...headerProps} onNavigate={handleNavigate} credits={credits} recentHistory={history.past} onBuyCredits={() => setShowPurchaseModal(true)} />;
    }
  };

  if (view === 'gallery-preview' && galleryProjectId) {
    return (
      <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-400">Načítání...</div>}>
        <GalleryPreviewView projectId={galleryProjectId} />
      </Suspense>
    );
  }

  if (view === 'home') {
    return (
      <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-400">Načítání...</div>}>
        <HomeView onEnterApp={() => setView('dashboard')} />
      </Suspense>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex font-sans">
        <Sidebar 
            isOpen={isSidebarOpen}
            isCollapsed={isSidebarCollapsed}
            onClose={() => setIsSidebarOpen(false)}
            onNavigate={handleNavigate}
            onToggleCollapse={() => setIsSidebarCollapsed(p => !p)}
            currentView={view}
            activeAction={activeAction}
        />
        <main className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarCollapsed ? 'lg:pl-24' : 'lg:pl-64'}`}>
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-400">Načítání...</div>}>
              {renderView()}
            </Suspense>
        </main>
        
        {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
        
        <CreditPurchaseModal 
            isOpen={showPurchaseModal} 
            onClose={() => setShowPurchaseModal(false)}
            onPurchase={handlePurchaseCredits}
        />

        {showTemplateModal && (
          <JobTemplateModal 
            onSelect={handleTemplateSelect} 
            onClose={() => setShowTemplateModal(false)} 
          />
        )}

        <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
        
        <div className="fixed top-5 right-5 z-[250] w-full max-w-sm space-y-3">
            {notifications.map(n => (
                <div key={n.id} className={`flex items-start p-4 rounded-lg shadow-lg text-sm font-medium border animate-fade-in-right ${n.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-200'}`}>
                    <span className="flex-1">{n.message}</span>
                    <button onClick={() => setNotifications(current => current.filter(notif => notif.id !== n.id))} className="ml-4 -mr-1 p-1 rounded-full hover:bg-black/10">
                        <XCircleIcon className="w-5 h-5" />
                    </button>
                </div>
            ))}
        </div>
    </div>
  );
}

export default App;
