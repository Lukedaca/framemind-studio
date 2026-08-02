
import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { SparklesIcon, XIcon, KeyIcon } from './icons';

interface CreditPurchaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPurchase: (amount: number) => void;
}

const CreditPurchaseModal: React.FC<CreditPurchaseModalProps> = ({ isOpen, onClose, onPurchase }) => {
    const { t } = useTranslation();

    if (!isOpen) return null;

    // Demo režim: žádné ceny, žádná platba — jen přidání demo kreditů.
    // Skutečné balíčky a platba přijdou až se serverovým billingem.
    const packages = [
        { name: t.store_pack_basic, amount: 50, popular: false },
        { name: t.store_pack_pro, amount: 150, popular: true },
        { name: t.store_pack_ultra, amount: 500, popular: false },
    ];

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4 animate-fade-in">
            <div className="w-full max-w-4xl bg-surface border border-border-subtle rounded-3xl overflow-hidden shadow-2xl relative">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-text-secondary hover:text-text-primary border border-border-subtle transition-none z-10"
                >
                    <XIcon className="w-5 h-5" />
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2">
                    {/* Left: Info */}
                    <div className="p-8 md:p-12 flex flex-col justify-center bg-elevated/30">
                        <div className="w-16 h-16 bg-warning/10 rounded-2xl flex items-center justify-center mb-6">
                            <SparklesIcon className="w-8 h-8 text-warning" />
                        </div>
                        <h2 className="text-3xl font-black text-white mb-4">{t.store_title}</h2>
                        <p className="text-text-secondary leading-relaxed mb-4">
                            {t.store_desc}
                        </p>
                        <div className="mb-6 p-3 border border-warning/40 bg-warning/10 text-warning text-xs font-semibold rounded-lg">
                            {t.store_demo_notice}
                        </div>
                        <ul className="space-y-3 text-sm text-text-primary">
                            <li className="flex items-center gap-2">
                                <span className="text-success">✓</span> Gemini 3 Pro Quality
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="text-success">✓</span> Veo Video Generation
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="text-success">✓</span> YouTube Thumbnails
                            </li>
                        </ul>
                    </div>

                    {/* Right: Packages */}
                    <div className="p-8 bg-surface flex flex-col gap-4 justify-center">
                        {packages.map((pkg, idx) => (
                            <div 
                                key={idx} 
                                onClick={() => onPurchase(pkg.amount)}
                                className={`relative group cursor-pointer p-4 rounded-xl border border-border-subtle bg-elevated/50 hover:bg-elevated transition-all transform hover:scale-[1.02] ${pkg.popular ? 'ring-2 ring-accent border-transparent' : ''}`}
                            >
                                {pkg.popular && (
                                    <span className="absolute -top-3 right-4 bg-accent text-[10px] font-bold px-2 py-0.5 text-void uppercase tracking-wider border border-accent">
                                        {t.store_best_value}
                                    </span>
                                )}
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 border border-border-subtle bg-elevated flex items-center justify-center">
                                            <SparklesIcon className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-white">{pkg.name}</h3>
                                            <p className="text-xs text-text-secondary font-bold">{pkg.amount} demo</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="block font-black text-white text-lg">DEMO</span>
                                        <span className="text-[10px] text-accent opacity-0 group-hover:opacity-100 transition-opacity uppercase font-bold">{t.store_btn_buy}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CreditPurchaseModal;


