import React, { useMemo, useState, useEffect } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useTranslation } from '../contexts/LanguageContext';
import { ThumbsUpIcon, XIcon, ChevronDoubleLeftIcon, UploadIcon } from './icons';
import { AnimatePresence, motion } from 'framer-motion';

interface GalleryPreviewViewProps {
  projectId: string;
}

const GalleryPreviewView: React.FC<GalleryPreviewViewProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const { projects, updateProject } = useProject();
  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Load favorites from project if available (mocking persistency)
  useEffect(() => {
     // In a real app, this would sync with backend
  }, [projectId]);

  const toggleFavorite = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setFavorites(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  if (!project) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-gray-500">
        {t.crm_gallery_missing}
      </div>
    );
  }

  const selectedIds = project.gallery.selectedFileIds.length > 0 ? project.gallery.selectedFileIds : project.files.map((file) => file.id);
  const visibleFiles = project.files.filter((file) => selectedIds.includes(file.id));

  const selectedImageIndex = visibleFiles.findIndex(f => f.id === selectedImageId);

  const navigateImage = (direction: 'next' | 'prev') => {
      if (selectedImageIndex === -1) return;
      let newIndex = direction === 'next' ? selectedImageIndex + 1 : selectedImageIndex - 1;
      if (newIndex >= visibleFiles.length) newIndex = 0;
      if (newIndex < 0) newIndex = visibleFiles.length - 1;
      setSelectedImageId(visibleFiles[newIndex].id);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedImageId) return;
      if (e.key === 'ArrowRight') navigateImage('next');
      if (e.key === 'ArrowLeft') navigateImage('prev');
      if (e.key === 'Escape') setSelectedImageId(null);
  };

  useEffect(() => {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageId]);

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-pink-500 selection:text-white">
      
      {/* Header */}
      <header className="fixed top-0 w-full z-40 bg-gradient-to-b from-black/80 to-transparent p-6 flex justify-between items-center backdrop-blur-sm">
          <div>
              <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
              <p className="text-xs text-gray-400 mt-0.5">{visibleFiles.length} photos • {new Date().toLocaleDateString()}</p>
          </div>
          <div className="flex gap-4">
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full backdrop-blur-md border border-white/10">
                  <ThumbsUpIcon className="w-4 h-4 text-pink-500" />
                  <span className="text-sm font-bold">{favorites.size}</span>
              </div>
              {project.gallery.allowDownload && (
                <button className="px-5 py-2 bg-white text-black rounded-full text-xs font-bold hover:bg-gray-200 transition-colors">
                  Download All
                </button>
              )}
          </div>
      </header>

      {/* Masonry Grid */}
      <main className="fm-page pt-24 pb-20">
          <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 gap-4 space-y-4">
              {visibleFiles.map((file) => (
                  <div 
                    key={file.id} 
                    className="relative group break-inside-avoid cursor-zoom-in rounded-lg overflow-hidden"
                    onClick={() => setSelectedImageId(file.id)}
                  >
                      <img 
                        src={file.previewUrl} 
                        className="w-full h-auto transform transition-transform duration-700 group-hover:scale-105" 
                        loading="lazy"
                      />
                      
                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                          <div className="flex justify-between items-end">
                              <span className="text-xs font-mono text-gray-300">{file.file.name}</span>
                              <button 
                                onClick={(e) => toggleFavorite(e, file.id)}
                                className={`p-2 rounded-full backdrop-blur-md transition-all ${favorites.has(file.id) ? 'bg-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.6)]' : 'bg-white/10 text-white hover:bg-white/20'}`}
                              >
                                  <ThumbsUpIcon className="w-5 h-5" />
                              </button>
                          </div>
                      </div>
                      
                      {/* Persistent Favorite Indicator */}
                      {favorites.has(file.id) && (
                          <div className="absolute top-3 right-3 p-1.5 bg-pink-500 rounded-full shadow-lg z-10 pointer-events-none">
                              <ThumbsUpIcon className="w-3 h-3 text-white" />
                          </div>
                      )}
                  </div>
              ))}
          </div>
      </main>

      {/* Lightbox */}
      <AnimatePresence>
          {selectedImageId && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center"
                onClick={() => setSelectedImageId(null)}
              >
                  {/* Close Button */}
                  <button onClick={() => setSelectedImageId(null)} className="absolute top-6 right-6 p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors z-50">
                      <XIcon className="w-6 h-6 text-white" />
                  </button>

                  {/* Navigation */}
                  <button onClick={(e) => { e.stopPropagation(); navigateImage('prev'); }} className="absolute left-6 top-1/2 -translate-y-1/2 p-4 text-white/50 hover:text-white transition-colors z-50">
                      <ChevronDoubleLeftIcon className="w-10 h-10" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); navigateImage('next'); }} className="absolute right-6 top-1/2 -translate-y-1/2 p-4 text-white/50 hover:text-white transition-colors z-50">
                      <ChevronDoubleLeftIcon className="w-10 h-10 rotate-180" />
                  </button>

                  {/* Main Image */}
                  <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                      <motion.img 
                        key={selectedImageId}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        src={visibleFiles[selectedImageIndex].previewUrl} 
                        className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded-sm"
                      />
                      
                      {/* Lightbox Footer */}
                      <div className="absolute -bottom-16 left-0 right-0 flex justify-center items-center gap-6">
                          <button 
                            onClick={(e) => toggleFavorite(e, visibleFiles[selectedImageIndex].id)}
                            className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold transition-all ${
                                favorites.has(visibleFiles[selectedImageIndex].id) 
                                ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30' 
                                : 'bg-white/10 text-white hover:bg-white/20'
                            }`}
                          >
                              <ThumbsUpIcon className="w-5 h-5" />
                              {favorites.has(visibleFiles[selectedImageIndex].id) ? 'Liked' : 'Like'}
                          </button>
                      </div>
                  </div>

              </motion.div>
          )}
      </AnimatePresence>

    </div>
  );
};

export default GalleryPreviewView;