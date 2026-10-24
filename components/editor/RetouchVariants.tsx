import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../contexts/LanguageContext';
import type { InpaintPatch } from '../../services/localInpaint';
import type { InpaintContext } from '../../utils/inpaintMath';

export interface RetouchVariant {
  context: InpaintContext;
  patch: InpaintPatch;
}

interface Props {
  source: HTMLCanvasElement;
  variants: RetouchVariant[];
  onApply: (patch: InpaintPatch) => void;
  onCancel: () => void;
}

/** Preview only: inference layers never touch the working photograph before Apply. */
const RetouchVariants: React.FC<Props> = ({ source, variants, onApply, onCancel }) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(0);
  const [before, setBefore] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const variant = variants[selected];
  const labels = { auto: t.retouch_context_auto, detail: t.retouch_context_detail, wide: t.retouch_context_wide };
  const x = Math.max(0, Math.min(...variants.map(item => item.patch.x)));
  const y = Math.max(0, Math.min(...variants.map(item => item.patch.y)));
  const width = Math.min(source.width, Math.max(...variants.map(item => item.patch.x + item.patch.layer.width))) - x;
  const height = Math.min(source.height, Math.max(...variants.map(item => item.patch.y + item.patch.layer.height))) - y;

  useEffect(() => {
    const dialog = dialogRef.current;
    const canvas = canvasRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (canvas) canvas.width = canvas.height = 1;
    };
  }, []);

  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${dpr}dppx)`) : null;
    window.addEventListener('resize', update);
    media?.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      media?.removeEventListener('change', update);
    };
  }, [dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !variant) return;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
    if (!before) ctx.drawImage(variant.patch.layer, variant.patch.x - x, variant.patch.y - y);
  }, [source, variant, before, x, y, width, height]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="retouch-variants-title"
      aria-describedby="retouch-variants-description"
      onCancel={event => { event.preventDefault(); onCancel(); }}
      onKeyDown={event => event.stopPropagation()}
      className="m-auto max-h-[95vh] w-[min(1100px,95vw)] overflow-y-auto rounded-2xl border border-hairline bg-ink-950 p-5 text-ink-100 shadow-2xl backdrop:bg-black/75 sm:p-6"
    >
      <h2 id="retouch-variants-title" className="font-display text-2xl">{t.retouch_variants_title}</h2>
      <p id="retouch-variants-description" className="mt-2 text-[13px] leading-relaxed text-ink-300">{t.retouch_variants_description}</p>
      {variants.length === 1 && <p className="mt-2 text-[12px] text-ink-400">{t.retouch_variants_single}</p>}
      <div className="my-4 flex flex-wrap items-center justify-between gap-3">
        <div className="fm-seg" role="radiogroup" aria-label={t.retouch_context}>
          {variants.map((item, index) => (
            <button key={item.context} role="radio" aria-checked={selected === index} onClick={() => setSelected(index)} className={selected === index ? 'is-active' : ''}>
              {labels[item.context]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setBefore(value => !value)} aria-pressed={before} className={`fm-chip ${before ? 'is-active' : ''}`}>{t.retouch_variants_before}</button>
          <button onClick={() => setActualSize(value => !value)} aria-pressed={actualSize} className={`fm-chip ${actualSize ? 'is-active' : ''}`}>{actualSize ? t.retouch_variants_fit : '100 %'}</button>
        </div>
      </div>
      <div className="max-h-[58vh] overflow-auto rounded-lg border border-hairline bg-black/50 p-2 custom-scrollbar">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={before ? t.retouch_variants_before : labels[variant.context]}
          style={actualSize
            ? { display: 'block', maxWidth: 'none', width: width / dpr, height: height / dpr }
            : { display: 'block', maxWidth: '100%', maxHeight: '55vh', width: 'auto', height: 'auto', margin: 'auto' }}
        />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onCancel} className="fm-btn-ghost">{t.editor_cancel}</button>
        <button onClick={() => onApply(variant.patch)} className="fm-btn-primary">{t.retouch_variants_apply}</button>
      </div>
    </dialog>
  );
};

export default RetouchVariants;
