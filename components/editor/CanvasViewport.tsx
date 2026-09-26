import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

// Plátno editoru: zobrazení fotky se zoomem a posunem + štětec na masku retuše.
// Maska se kreslí do vlastního canvasu s omezeným rozlišením (delší strana
// MAX_MASK_SIDE) — u 24MP fotky by maska v plném rozlišení zbytečně žrala
// paměť; do plného rozlišení ji převádí až services/localInpaint.ts.

export type RetouchTool = 'none' | 'brush';

export interface CanvasViewportHandle {
  fitToScreen: () => void;
  getMaskCanvas: () => HTMLCanvasElement | null;
  hasMask: () => boolean;
  clearMask: () => void;
  /** Fotka v plném rozlišení jako plátno — zdroj pro další tah retuše. */
  getSourceCanvas: () => HTMLCanvasElement | null;
  /**
   * Vloží doplněný výřez rovnou do zobrazené fotky a smaže masku. Vrací verzi
   * obsahu, nebo -1, když se mezitím zobrazila jiná fotka (výřez patří ke `source`).
   */
  applyPatch: (source: HTMLCanvasElement, layer: HTMLCanvasElement, x: number, y: number) => number;
  /** Soubor uložený z verze `version` je totéž, co už je vidět — nenačítat ho znovu. */
  commitSource: (url: string, version: number) => void;
}

type Source = HTMLImageElement | HTMLCanvasElement;
const widthOf = (s: Source) => (s instanceof HTMLImageElement ? s.naturalWidth : s.width);
const heightOf = (s: Source) => (s instanceof HTMLImageElement ? s.naturalHeight : s.height);

interface CanvasViewportProps {
  imageSrc: string;
  activeTool: RetouchTool;
  /** Průměr štětce v pixelech obrazovky — při zoomu zůstává stejně velký pod rukou. */
  brushSize: number;
  onStrokeEnd?: () => void;
  /** Maska zůstane vidět a pulzuje, dokud model počítá. */
  processing?: boolean;
  className?: string;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.12;
const MAX_MASK_SIDE = 2048;
const MASK_COLOR = 'rgb(214, 92, 255)';

const CanvasViewport = forwardRef<CanvasViewportHandle, CanvasViewportProps>(
  ({ imageSrc, activeTool, brushSize, onStrokeEnd, processing = false, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const imageRef = useRef<Source | null>(null);
    // Co je právě vidět: URL načteného souboru, nebo null po vložení retuše,
    // dokud se nový soubor neuloží (verze roste s každým vloženým výřezem).
    const shownSrcRef = useRef<string | null>(null);
    const versionRef = useRef(0);

    const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
    const [displayScale, setDisplayScale] = useState(1);
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
    const [pulse, setPulse] = useState(0);
    const maskDirtyRef = useRef(false);
    const drawingRef = useRef<{ pointerId: number; last: { x: number; y: number } } | null>(null);
    const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const spaceHeldRef = useRef(false);

    const maskScale = () => {
      const img = imageRef.current;
      if (!img) return 1;
      return Math.min(1, MAX_MASK_SIDE / Math.max(widthOf(img), heightOf(img)));
    };

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const img = imageRef.current;
      const container = containerRef.current;
      if (!canvas || !ctx || !container) return;

      const dpr = window.devicePixelRatio || 1;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (!img) return;

      const t = transformRef.current;
      ctx.save();
      ctx.translate(t.offsetX, t.offsetY);
      ctx.scale(t.scale, t.scale);
      ctx.imageSmoothingQuality = 'high';
      // Stín vrhá levný obdélník, ne fotka — stín pod 24MP obrázkem by se
      // přepočítával v každém snímku pulzování masky.
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 40 / t.scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, widthOf(img), heightOf(img));
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.drawImage(img, 0, 0);

      const mask = maskCanvasRef.current;
      if (mask && maskDirtyRef.current) {
        ctx.globalAlpha = processing ? 0.35 + 0.25 * Math.sin(pulse) : 0.55;
        ctx.drawImage(mask, 0, 0, widthOf(img), heightOf(img));
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }, [processing, pulse]);

    // Pulzování masky během výpočtu.
    useEffect(() => {
      if (!processing) return;
      let raf = 0;
      const tick = () => {
        setPulse((p) => p + 0.12);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [processing]);

    useEffect(() => {
      render();
    }, [render]);

    const fitToScreen = useCallback(() => {
      const container = containerRef.current;
      const img = imageRef.current;
      if (!container || !img) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scale = Math.min(cw / widthOf(img), ch / heightOf(img)) * 0.9;
      transformRef.current = {
        scale,
        offsetX: (cw - widthOf(img) * scale) / 2,
        offsetY: (ch - heightOf(img) * scale) / 2,
      };
      setDisplayScale(scale);
      render();
    }, [render]);

    // Nová fotka: nový obrázek i prázdná maska. Když se jen vyměnil soubor
    // stejné velikosti (po retuši), zoom a posun zůstanou, kde byly.
    useEffect(() => {
      // Soubor uložený z retuše, která už je na plátně: znovu nenačítat.
      if (imageSrc === shownSrcRef.current) return;
      let cancelled = false;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        shownSrcRef.current = imageSrc;
        const prev = imageRef.current;
        const sameSize = prev && widthOf(prev) === widthOf(img) && heightOf(prev) === heightOf(img);
        imageRef.current = img;
        const s = maskScale();
        const mask = document.createElement('canvas');
        mask.width = Math.max(1, Math.round(widthOf(img) * s));
        mask.height = Math.max(1, Math.round(heightOf(img) * s));
        maskCanvasRef.current = mask;
        maskDirtyRef.current = false;
        if (sameSize) render();
        else fitToScreen();
      };
      img.src = imageSrc;
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageSrc]);

    const screenToImage = (sx: number, sy: number) => {
      const t = transformRef.current;
      return { x: (sx - t.offsetX) / t.scale, y: (sy - t.offsetY) / t.scale };
    };

    const localPoint = (e: React.PointerEvent | PointerEvent | WheelEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
      const t = transformRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.scale * factor));
      const ix = (cx - t.offsetX) / t.scale;
      const iy = (cy - t.offsetY) / t.scale;
      t.scale = next;
      t.offsetX = cx - ix * next;
      t.offsetY = cy - iy * next;
      setDisplayScale(next);
      render();
    }, [render]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const p = localPoint(e);
        zoomAt(e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP), p.x, p.y);
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [zoomAt]);

    useEffect(() => {
      const down = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.code === 'Space') {
          spaceHeldRef.current = true;
          e.preventDefault();
        }
        if (e.code === 'Digit0') fitToScreen();
      };
      const up = (e: KeyboardEvent) => {
        if (e.code === 'Space') spaceHeldRef.current = false;
      };
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      return () => {
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
      };
    }, [fitToScreen]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const observer = new ResizeObserver(() => render());
      observer.observe(container);
      return () => observer.disconnect();
    }, [render]);

    const paintSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const mask = maskCanvasRef.current;
      const ctx = mask?.getContext('2d');
      if (!mask || !ctx) return;
      const s = maskScale();
      ctx.strokeStyle = MASK_COLOR;
      ctx.fillStyle = MASK_COLOR;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = (brushSize / transformRef.current.scale) * s;
      ctx.beginPath();
      ctx.moveTo(from.x * s, from.y * s);
      ctx.lineTo(to.x * s, to.y * s);
      ctx.stroke();
      maskDirtyRef.current = true;
    };

    const onPointerDown = (e: React.PointerEvent) => {
      const p = localPoint(e);
      const wantsPan = e.button === 1 || spaceHeldRef.current || activeTool === 'none' || processing;
      (e.target as Element).setPointerCapture(e.pointerId);
      if (wantsPan) {
        panRef.current = { pointerId: e.pointerId, ...p };
        return;
      }
      if (e.button !== 0) return;
      const ip = screenToImage(p.x, p.y);
      drawingRef.current = { pointerId: e.pointerId, last: ip };
      paintSegment(ip, ip);
      render();
    };

    const onPointerMove = (e: React.PointerEvent) => {
      const p = localPoint(e);
      if (activeTool === 'brush') setCursor(p);
      if (panRef.current?.pointerId === e.pointerId) {
        transformRef.current.offsetX += p.x - panRef.current.x;
        transformRef.current.offsetY += p.y - panRef.current.y;
        panRef.current = { pointerId: e.pointerId, ...p };
        render();
        return;
      }
      const drawing = drawingRef.current;
      if (drawing?.pointerId === e.pointerId) {
        const ip = screenToImage(p.x, p.y);
        paintSegment(drawing.last, ip);
        drawing.last = ip;
        render();
      }
    };

    const onPointerUp = (e: React.PointerEvent) => {
      if (panRef.current?.pointerId === e.pointerId) {
        panRef.current = null;
        return;
      }
      if (drawingRef.current?.pointerId === e.pointerId) {
        drawingRef.current = null;
        onStrokeEnd?.();
      }
    };

    useImperativeHandle(ref, () => ({
      fitToScreen,
      getMaskCanvas: () => maskCanvasRef.current,
      hasMask: () => maskDirtyRef.current,
      clearMask: () => {
        const mask = maskCanvasRef.current;
        mask?.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
        maskDirtyRef.current = false;
        render();
      },
      getSourceCanvas: () => {
        const img = imageRef.current;
        if (!img) return null;
        if (img instanceof HTMLCanvasElement) return img;
        // Poprvé z obrázku udělat plátno (jednou za fotku), dál se kreslí do něj.
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        imageRef.current = c;
        return c;
      },
      applyPatch: (source, layer, x, y) => {
        if (imageRef.current !== source) return -1;
        source.getContext('2d')!.drawImage(layer, x, y);
        const mask = maskCanvasRef.current;
        mask?.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
        maskDirtyRef.current = false;
        shownSrcRef.current = null;
        versionRef.current += 1;
        render();
        return versionRef.current;
      },
      commitSource: (url, version) => {
        if (version === versionRef.current && shownSrcRef.current === null) shownSrcRef.current = url;
      },
    }), [fitToScreen, render]);

    const cursorStyle = processing ? 'progress' : activeTool === 'brush' ? 'none' : 'grab';

    return (
      <div ref={containerRef} className={`relative w-full h-full overflow-hidden touch-none select-none ${className || ''}`}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: cursorStyle }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={() => activeTool === 'none' && fitToScreen()}
        />

        {activeTool === 'brush' && cursor && !processing && (
          <div
            className="pointer-events-none absolute rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ width: brushSize, height: brushSize, left: cursor.x, top: cursor.y, transform: 'translate(-50%, -50%)' }}
          />
        )}

        <div className="absolute bottom-4 left-4 z-30 flex items-center gap-1 rounded-full border border-hairline bg-ink-900/80 px-1.5 py-1 text-[11px] font-medium text-ink-300 backdrop-blur-md">
          <button
            onClick={() => {
              const c = containerRef.current;
              if (c) zoomAt(1 / 1.25, c.clientWidth / 2, c.clientHeight / 2);
            }}
            className="h-6 w-6 rounded-full hover:bg-white/5 hover:text-ink-50"
            aria-label="Oddálit"
          >
            −
          </button>
          <button onClick={fitToScreen} className="min-w-[3.25rem] tabular-nums hover:text-ink-50" title="Přizpůsobit (0)">
            {Math.round(displayScale * 100)} %
          </button>
          <button
            onClick={() => {
              const c = containerRef.current;
              if (c) zoomAt(1.25, c.clientWidth / 2, c.clientHeight / 2);
            }}
            className="h-6 w-6 rounded-full hover:bg-white/5 hover:text-ink-50"
            aria-label="Přiblížit"
          >
            +
          </button>
        </div>
      </div>
    );
  },
);

CanvasViewport.displayName = 'CanvasViewport';
export default CanvasViewport;
