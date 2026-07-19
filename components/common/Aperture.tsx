import React, { useId } from 'react';

// Clona z FrameMind loga — 6 čepelí, brand gradient. Nosný vizuální motiv appky:
// loader, průběh AI analýzy, dekorace hero sekcí.
const Aperture: React.FC<{ className?: string; spinning?: boolean }> = ({ className = 'w-8 h-8', spinning = false }) => {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 120 120" className={`${className} ${spinning ? 'fm-aperture-spin' : ''}`} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#b01ecb" />
          <stop offset="50%" stopColor="#2f6fe0" />
          <stop offset="100%" stopColor="#1fc06b" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        <path d="M60.0 5.0 L107.6 32.5 L60.0 41.0 Z" />
        <path d="M107.6 32.5 L107.6 87.5 L76.5 50.5 Z" />
        <path d="M107.6 87.5 L60.0 115.0 L76.5 69.5 Z" />
        <path d="M60.0 115.0 L12.4 87.5 L60.0 79.0 Z" />
        <path d="M12.4 87.5 L12.4 32.5 L43.5 69.5 Z" />
        <path d="M12.4 32.5 L60.0 5.0 L43.5 50.5 Z" />
      </g>
    </svg>
  );
};

export default Aperture;
