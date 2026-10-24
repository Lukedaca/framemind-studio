import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

// Plátno editoru: zobrazení fotky se zoomem a posunem + štětec na masku retuše.
// Maska se kreslí do vlastního canvasu s omezeným rozlišením (delší strana
// MAX_MASK_SIDE) — u 24MP fotky by maska v plném rozlišení zbytečně žrala
// paměť; do plného rozlišení ji převádí až services/localInpaint.ts.

import type { SampleStroke } from '../../services/sampleRetouch';
export type RetouchTool = 'none' | 'brush' | 'lasso' | 'clone' | 'heal';

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
  /** Nahradí masku výběrem z lasa (stejné rozlišení jako maska), null = smazat. */
  setMask: (mask: HTMLCanvasElement | null) => void;
  /** Mění se s každou změnou obsahu plátna (načtení, vložená retuš). */
  getContentVersion: () => number;
  getImageSize: () => { width: number; height: number } | null;
}

type Source = HTMLImageElement | HTMLCanvasElement;
const widthOf = (s: Source) => (s instanceof HTMLImageElement ? s.naturalWidth : s.width);
const heightOf = (s: Source) => (s instanceof HTMLImageElement ? s.naturalHeight : s.height);

interface CanvasViewportProps {
  imageSrc: string;
  activeTool: RetouchTool;
  /** Průměr štětce v pixelech obrazovky — při zoomu zůstává stejně velký pod rukou. */
  brushSize: number;
  /** 0 = zcela měkký okraj, 1 = tvrdý. Alfa masky pak nese váhu retuše. */
  brushHardness?: number;
  onStrokeEnd?: (sample?: SampleStroke) => void;
  /** Klik chytrým lasem v souřadnicích fotky; `subtract` = s Alt. */
  onLassoClick?: (point: { x: number; y: number }, subtract: boolean) => void;
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
  ({ imageSrc, activeTool, brushSize, brushHardness = 1, onStrokeEnd, onLassoClick, processing = false, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const photoCanvasRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef(0);
    const lastPhotoRef = useRef<{ source: Source; version: number; transform: string } | null>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    // Rozpracovaný tah: kreslí se tvrdě sem a do masky se sloučí až rozmazaný,
    // jinak by se měkké okraje překrývajících se kousků tahu sčítaly do tvrda.
    const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const softStrokeRef = useRef<HTMLCanvasElement | null>(null);
    const strokeBlurRef = useRef(0);
    const strokeBoundsRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
    const softDirtyRef = useRef(false);
    const imageRef = useRef<Source | null>(null);
    // Co je právě vidět: URL načteného souboru, nebo null po vložení retuše,
    // dokud se nový soubor neuloží (verze roste s každým vloženým výřezem).
    const shownSrcRef = useRef<string | null>(null);
    const versionRef = useRef(0);

    const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
    const [displayScale, setDisplayScale] = useState(1);
    const maskDirtyRef = useRef(false);
    const drawingRef = useRef<{ pointerId: number; last: { x: number; y: number } } | null>(null);
    const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const spaceHeldRef = useRef(false);
    const sampleSourceRef = useRef<{ x: number; y: number } | null>(null);
    const sampleStrokeRef = useRef<SampleStroke | undefined>(undefined);

    const maskScale = () => {
      const img = imageRef.current;
      if (!img) return 1;
      return Math.min(1, MAX_MASK_SIDE / Math.max(widthOf(img), heightOf(img)));
    };

    const updateSoftStroke = useCallback(() => {
      const stroke = strokeCanvasRef.current;
      const soft = softStrokeRef.current;
      const bounds = strokeBoundsRef.current;
      if (!softDirtyRef.current || !stroke || !soft || !bounds) return;
      const padding = Math.ceil(strokeBlurRef.current * 4) + 2;
      const x = Math.max(0, Math.floor(bounds.left) - padding);
      const y = Math.max(0, Math.floor(bounds.top) - padding);
      const width = Math.min(stroke.width, Math.ceil(bounds.right) + padding) - x;
      const height = Math.min(stroke.height, Math.ceil(bounds.bottom) + padding) - y;
      if (width > 0 && height > 0) {
        const ctx = soft.getContext('2d')!;
        ctx.clearRect(x, y, width, height);
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
        ctx.filter = `blur(${strokeBlurRef.current}px)`;
        ctx.drawImage(stroke, x, y, width, height, x, y, width, height);
        ctx.restore();
      }
      softDirtyRef.current = false;
    }, []);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const photo = photoCanvasRef.current;
      const photoCtx = photo?.getContext('2d');
      const img = imageRef.current;
      const container = containerRef.current;
      if (!canvas || !ctx || !photo || !photoCtx || !container) return;

      const dpr = window.devicePixelRatio || 1;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        photo.width = canvas.width;
        photo.height = canvas.height;
        lastPhotoRef.current = null;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (!img) return;

      const t = transformRef.current;
      const transform = `${cw},${ch},${dpr},${t.scale},${t.offsetX},${t.offsetY}`;
      const previous = lastPhotoRef.current;
      // Keep the full-resolution photo on its own surface. Brush feedback and
      // processing indicators must not repeatedly rescale the entire original.
      if (previous?.source !== img || previous.version !== versionRef.current || previous.transform !== transform) {
        photoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        photoCtx.clearRect(0, 0, cw, ch);
        photoCtx.save();
        photoCtx.translate(t.offsetX, t.offsetY);
        photoCtx.scale(t.scale, t.scale);
        photoCtx.imageSmoothingQuality = 'high';
        photoCtx.shadowColor = 'rgba(0,0,0,0.55)';
        photoCtx.shadowBlur = 40 / t.scale;
        photoCtx.fillStyle = '#000';
        photoCtx.fillRect(0, 0, widthOf(img), heightOf(img));
        photoCtx.shadowColor = 'transparent'; photoCtx.shadowBlur = 0;
        photoCtx.drawImage(img, 0, 0);
        photoCtx.restore();
        lastPhotoRef.current = { source: img, version: versionRef.current, transform };
      }
      updateSoftStroke();
      ctx.save();
      ctx.translate(t.offsetX, t.offsetY);
      ctx.scale(t.scale, t.scale);
      if ((activeTool === 'clone' || activeTool === 'heal') && sampleSourceRef.current) {
        const point = sampleSourceRef.current, radius = 9 / t.scale;
        ctx.strokeStyle = '#35df95'; ctx.lineWidth = 1.5 / t.scale;
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.moveTo(point.x - radius * 1.5, point.y); ctx.lineTo(point.x + radius * 1.5, point.y);
        ctx.moveTo(point.x, point.y - radius * 1.5); ctx.lineTo(point.x, point.y + radius * 1.5); ctx.stroke();
      }

      const mask = maskCanvasRef.current;
      const stroke = drawingRef.current ? softStrokeRef.current ?? strokeCanvasRef.current : null;
      if (mask && (maskDirtyRef.current || stroke)) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(mask, 0, 0, widthOf(img), heightOf(img));
        if (stroke) ctx.drawImage(stroke, 0, 0, widthOf(img), heightOf(img));
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }, [activeTool, updateSoftStroke]);

    const drawRef = useRef(draw);
    drawRef.current = draw;
    const render = useCallback(() => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        drawRef.current();
      });
    }, []);

    useEffect(() => {
      render();
    }, [render, activeTool]);

    useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

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
        versionRef.current += 1;
        const prev = imageRef.current;
        const sameSize = prev && widthOf(prev) === widthOf(img) && heightOf(prev) === heightOf(img);
        imageRef.current = img;
        sampleSourceRef.current = null;
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

    const startStroke = () => {
      const mask = maskCanvasRef.current;
      if (!mask) return;
      const make = () => {
        const c = document.createElement('canvas');
        c.width = mask.width;
        c.height = mask.height;
        return c;
      };
      strokeCanvasRef.current = make();
      strokeBoundsRef.current = null;
      softDirtyRef.current = false;
      const h = Math.min(1, Math.max(0, brushHardness));
      // Poloměr rozmazání v pixelech masky: u nulové tvrdosti přes půl štětce.
      const radius = ((brushSize / transformRef.current.scale) * maskScale()) / 2;
      strokeBlurRef.current = h >= 0.99 ? 0 : radius * (1 - h) * 0.55;
      softStrokeRef.current = strokeBlurRef.current > 0 ? make() : null;
    };

    const paintSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const stroke = strokeCanvasRef.current;
      const ctx = stroke?.getContext('2d');
      if (!stroke || !ctx) return;
      const s = maskScale();
      const h = Math.min(1, Math.max(0, brushHardness));
      ctx.strokeStyle = MASK_COLOR;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Měkký štětec má tvrdé jádro menší, zbytek poloměru dělá rozmazání.
      ctx.lineWidth = (brushSize / transformRef.current.scale) * s * (0.55 + 0.45 * h);
      ctx.beginPath();
      if (from.x === to.x && from.y === to.y) {
        // A zero-length line is not painted consistently by native WebView2.
        ctx.fillStyle = MASK_COLOR;
        ctx.arc(from.x * s, from.y * s, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(from.x * s, from.y * s);
        ctx.lineTo(to.x * s, to.y * s);
        ctx.stroke();
      }
      const radius = ctx.lineWidth / 2;
      const previous = strokeBoundsRef.current;
      strokeBoundsRef.current = {
        left: Math.min(previous?.left ?? Infinity, Math.min(from.x, to.x) * s - radius),
        top: Math.min(previous?.top ?? Infinity, Math.min(from.y, to.y) * s - radius),
        right: Math.max(previous?.right ?? -Infinity, Math.max(from.x, to.x) * s + radius),
        bottom: Math.max(previous?.bottom ?? -Infinity, Math.max(from.y, to.y) * s + radius),
      };
      softDirtyRef.current = true;
    };

    const commitStroke = () => {
      updateSoftStroke();
      const mask = maskCanvasRef.current;
      const stroke = softStrokeRef.current ?? strokeCanvasRef.current;
      if (mask && stroke) {
        mask.getContext('2d')!.drawImage(stroke, 0, 0);
        maskDirtyRef.current = true;
      }
      strokeCanvasRef.current = null;
      softStrokeRef.current = null;
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
      if (activeTool === 'clone' || activeTool === 'heal') {
        const image = imageRef.current;
        if (!image || ip.x < 0 || ip.y < 0 || ip.x >= widthOf(image) || ip.y >= heightOf(image)) return;
        if (e.altKey) { sampleSourceRef.current = ip; render(); return; }
        if (!sampleSourceRef.current) return;
        sampleStrokeRef.current = { source: sampleSourceRef.current, target: ip };
      } else sampleStrokeRef.current = undefined;
      if (activeTool === 'lasso') {
        const img = imageRef.current;
        if (img && ip.x >= 0 && ip.y >= 0 && ip.x < widthOf(img) && ip.y < heightOf(img)) onLassoClick?.(ip, e.altKey);
        return;
      }
      startStroke();
      drawingRef.current = { pointerId: e.pointerId, last: ip };
      paintSegment(ip, ip);
      render();
    };

    const onPointerMove = (e: React.PointerEvent) => {
      const p = localPoint(e);
      if ((activeTool === 'brush' || activeTool === 'clone' || activeTool === 'heal') && cursorRef.current) {
        cursorRef.current.style.display = 'block';
        cursorRef.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
      }
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
        commitStroke();
        render();
        onStrokeEnd?.(sampleStrokeRef.current);
        sampleStrokeRef.current = undefined;
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
      setMask: (selection) => {
        const mask = maskCanvasRef.current;
        const ctx = mask?.getContext('2d');
        if (!mask || !ctx) return;
        ctx.clearRect(0, 0, mask.width, mask.height);
        if (selection) ctx.drawImage(selection, 0, 0, mask.width, mask.height);
        maskDirtyRef.current = !!selection;
        render();
      },
      getContentVersion: () => versionRef.current,
      getImageSize: () => {
        const img = imageRef.current;
        return img ? { width: widthOf(img), height: heightOf(img) } : null;
      },
    }), [fitToScreen, render]);

    const isBrush = activeTool === 'brush' || activeTool === 'clone' || activeTool === 'heal';
    const cursorStyle = processing ? 'progress' : isBrush ? 'none' : activeTool === 'lasso' ? 'crosshair' : 'grab';

    return (
      <div ref={containerRef} className={`relative w-full h-full overflow-hidden touch-none select-none ${className || ''}`}>
        <canvas ref={photoCanvasRef} data-testid="retouch-photo" className="pointer-events-none absolute inset-0 w-full h-full" />
        <canvas
          ref={canvasRef}
          data-testid="retouch-mask"
          className={`absolute inset-0 w-full h-full ${processing ? 'animate-pulse' : ''}`}
          style={{ cursor: cursorStyle }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.display = 'none'; }}
          onDoubleClick={() => activeTool === 'none' && fitToScreen()}
        />

        {isBrush && !processing && (
          <div
            ref={cursorRef}
            className="pointer-events-none absolute left-0 top-0 rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ display: 'none', width: brushSize, height: brushSize }}
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
