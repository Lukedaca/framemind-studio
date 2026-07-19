
import React, { useState, useEffect } from 'react';
import { generateImage } from '../services/geminiService';
import { base64ToFile } from '../utils/imageProcessor';
import { getImageDimensionsFromBlob, saveAIGalleryAsset } from '../utils/aiGallery';
import type { AIGalleryType } from '../types';
import { GenerateImageIcon, UploadIcon, XIcon, SparklesIcon, ExportIcon } from './icons';
import Header from './Header';
import { useTranslation } from '../contexts/LanguageContext';

const getApiErrorMessage = (error: unknown, defaultMessage: string = 'Error'): string => {
    if (error instanceof Error) {
        if (error.message.toLowerCase().includes('api key') || error.message.toLowerCase().includes('auth')) {
            return 'API Key Error';
        }
        return error.message;
    }
    return defaultMessage;
};

interface GenerateImageViewProps {
    title: string;
    onOpenApiKeyModal: () => void;
    onToggleSidebar: () => void;
    onImageGenerated: (file: File) => void;
    credits: number;
    onDeductCredits: (amount: number) => Promise<boolean>;
    currentProjectId?: string | null;
}

const GenerateImageView: React.FC<GenerateImageViewProps> = ({ 
    title, onOpenApiKeyModal, onToggleSidebar, onImageGenerated, credits, onDeductCredits, currentProjectId
}) => {
    const { t } = useTranslation();
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsLightboxOpen(false);
            }
        };

        if (isLightboxOpen) {
            window.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isLightboxOpen]);

    const handleGenerate = async () => {
        if (!prompt.trim()) return;

        const COST = 5;
        if (!await onDeductCredits(COST)) {
             setError(`${t.credits_low}. ${t.credits_cost}: ${COST}`);
             return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedImage(null);
        try {
            const base64Image = await generateImage(prompt);
            setGeneratedImage(`data:image/jpeg;base64,${base64Image}`);
            try {
                const file = await base64ToFile(base64Image, `${prompt.substring(0, 30).replace(/\s/g, '_') || 'generated'}.jpeg`, 'image/jpeg');
                const { width, height } = await getImageDimensionsFromBlob(file);
                await saveAIGalleryAsset({
                    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                    createdAt: new Date().toISOString(),
                    type: 'generate' as AIGalleryType,
                    prompt,
                    projectId: currentProjectId || null,
                    fileName: file.name,
                    mimeType: file.type,
                    size: file.size,
                    width,
                    height,
                    blob: file,
                });
            } catch (e) {
                console.error('Failed to save AI gallery item', e);
            }
        } catch (err) {
            const msg = getApiErrorMessage(err, t.msg_error);
            if (msg.toLowerCase().includes('api key') || msg.includes('API_KEY_MISSING')) {
                onOpenApiKeyModal();
            }
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = () => {
        if (!generatedImage) return;
        const link = document.createElement('a');
        link.href = generatedImage;
        link.download = `${prompt.substring(0, 30).replace(/\s/g, '_') || 'generated'}.jpeg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAddToProject = async () => {
        if (!generatedImage) return;
        try {
            const file = await base64ToFile(generatedImage.split(',')[1], `${prompt.substring(0, 30).replace(/\s/g, '_') || 'generated'}.jpeg`, 'image/jpeg');
            onImageGenerated(file);
        } catch (err) {
            setError(t.msg_error);
        }
    };

    return (
        <>
            <div className="h-full w-full flex flex-col text-text-primary">
                <Header title={title} onOpenApiKeyModal={onOpenApiKeyModal} onToggleSidebar={onToggleSidebar} credits={credits}/>
                <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
                    <div className="w-full max-w-5xl">
                        <div className="text-center mb-10">
                            <h1 className="text-4xl font-extrabold tracking-tight text-text-primary">{t.gen_title}</h1>
                            <p className="mt-3 text-xl text-text-secondary max-w-3xl mx-auto">
                                {t.gen_subtitle}
                            </p>
                        </div>
                        
                        <div className="p-8 border border-border-subtle bg-surface">
                            <div className="flex flex-col md:flex-row gap-8">
                                <div className="flex-1">
                                    <label htmlFor="prompt" className="block text-sm font-semibold text-text-secondary mb-2">
                                        {t.gen_prompt}
                                    </label>
                                    <textarea
                                        id="prompt"
                                        rows={5}
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder={t.gen_placeholder}
                                        className="block w-full border border-border-subtle bg-elevated sm:text-sm text-base p-3 outline-none"
                                    />
                                    
                                    <div className="flex items-center justify-between mt-4 mb-2 text-xs text-text-secondary">
                                        <span>{t.credits_cost}:</span>
                                        <span className="font-bold text-accent flex items-center gap-1">5 <SparklesIcon className="w-3 h-3"/></span>
                                     </div>

                                    <button
                                        onClick={handleGenerate}
                                        disabled={isLoading || !prompt.trim()}
                                        className="w-full inline-flex items-center justify-center px-6 py-3 border border-accent text-base font-semibold text-void bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-none"
                                    >
                                        <GenerateImageIcon className="-ml-1 mr-3 h-5 w-5" />
                                        {isLoading ? t.gen_generating : t.gen_btn}
                                    </button>
                                    {error && <p className="mt-3 text-sm text-error bg-void p-3 border border-error">{error}</p>}
                                </div>

                                <div className="md:w-96 flex-shrink-0 flex flex-col items-center justify-center bg-elevated border border-border-subtle p-4 aspect-square">
                                    {isLoading && (
                                        <div className="flex flex-col items-center justify-center text-text-secondary">
                                            <svg className="animate-spin h-12 w-12 text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <p className="mt-4 text-lg font-semibold">{t.gen_generating}</p>
                                        </div>
                                    )}
                                    {!isLoading && generatedImage && (
                                        <div className="w-full h-full flex flex-col animate-fade-in">
                                            <button onClick={() => setIsLightboxOpen(true)} className="flex-1 w-full h-full cursor-pointer group focus:outline-none">
                                                <img src={generatedImage} alt="Vygenerovaný" className="w-full h-full object-contain transition-none" />
                                            </button>
                                            <div className="mt-4 flex gap-2">
                                                <button
                                                    onClick={handleDownload}
                                                    className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-accent text-sm font-semibold text-void bg-accent transition-none"
                                                >
                                                    <ExportIcon className="-ml-1 mr-2 h-5 w-5" />
                                                    {t.export_btn || 'Export'}
                                                </button>
                                                <button
                                                    onClick={handleAddToProject}
                                                    className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-border-subtle text-sm font-medium text-text-primary bg-surface transition-none"
                                                >
                                                    <UploadIcon className="-ml-1 mr-2 h-5 w-5" />
                                                    {t.gen_add}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {!isLoading && !generatedImage && (
                                        <div className="text-center text-text-secondary">
                                            <GenerateImageIcon className="mx-auto h-16 w-16 mb-4" />
                                            <p className="text-lg">{t.gen_canvas}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {isLightboxOpen && generatedImage && (
                <div 
                    className="fixed inset-0 bg-black/80 z-[101] flex items-center justify-center p-4 animate-fade-in"
                    onClick={() => setIsLightboxOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t.gen_preview_label}
                >
                    <div className="relative max-w-5xl max-h-[90vh] transition-none" onClick={(e) => e.stopPropagation()}>
                        <img src={generatedImage} alt="Plný náhled" className="max-w-full max-h-[90vh] object-contain border border-border-subtle" />
                        <button 
                            onClick={() => setIsLightboxOpen(false)}
                            className="absolute -top-3 -right-3 bg-elevated border border-border-subtle p-2 text-text-secondary focus:outline-none"
                            aria-label="Close"
                        >
                            <XIcon className="w-6 h-6" />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default GenerateImageView;
