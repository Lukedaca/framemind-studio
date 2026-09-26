
import React, { useEffect, useRef } from 'react';
import { calculateHistogram } from '../utils/imageProcessor';

interface HistogramProps {
    imageUrl: string | null;
}

const Histogram: React.FC<HistogramProps> = ({ imageUrl }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!imageUrl || !canvasRef.current) return;

        const render = async () => {
            try {
                const { r, g, b, l } = await calculateHistogram(imageUrl);
                const ctx = canvasRef.current!.getContext('2d');
                if (!ctx) return;

                const w = canvasRef.current!.width;
                const h = canvasRef.current!.height;
                ctx.clearRect(0, 0, w, h);

                // Find max value to normalize height
                const max = Math.max(
                    ...r, ...g, ...b, ...l
                );

                const drawChannel = (data: number[], color: string, fill: boolean = false) => {
                    ctx.beginPath();
                    ctx.moveTo(0, h);
                    for (let i = 0; i < 256; i++) {
                        const x = (i / 255) * w;
                        const y = h - (data[i] / max) * h;
                        ctx.lineTo(x, y);
                    }
                    if (fill) {
                        ctx.lineTo(w, h);
                        ctx.closePath();
                        ctx.fillStyle = color;
                        ctx.fill();
                    } else {
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                    }
                };

                // Blend mode for overlapping colors
                ctx.globalCompositeOperation = 'screen';
                
                drawChannel(r, 'rgba(239, 68, 68, 0.6)', true); // Red
                drawChannel(g, 'rgba(34, 197, 94, 0.6)', true); // Green
                drawChannel(b, 'rgba(59, 130, 246, 0.6)', true); // Blue
                
                ctx.globalCompositeOperation = 'source-over';
                drawChannel(l, 'rgba(255, 255, 255, 0.8)', false); // Luma (Line only)
            } catch (e) {
                console.error("Histogram error", e);
            }
        };

        // Simple debounce to prevent crashing on rapid slider moves
        const t = setTimeout(render, 100);
        return () => clearTimeout(t);

    }, [imageUrl]);

    if (!imageUrl) return null;

    return (
        <div className="w-full bg-black/40 rounded-lg p-2 border border-border-subtle/50 mb-4">
            <canvas ref={canvasRef} width={280} height={100} className="w-full h-24" />
            <div className="flex justify-between text-[11px] text-text-secondary font-mono mt-1 px-1">
                <span>0 (Black)</span>
                <span>Histogram (RGB+L)</span>
                <span>255 (White)</span>
            </div>
        </div>
    );
};

export default Histogram;

