import React, { useId } from 'react';

// FrameMind ikonová sada — duotone: hlavní glyf v currentColor (stroke 1.7),
// jeden akcent v brand gradientu (magenta → modrá → zelená). Fotografická DNA:
// rámečky, clona, hledáček. Nepoužívat generické icon fonty vedle téhle sady.

interface IconProps {
  className?: string;
}

const GradDefs: React.FC<{ id: string }> = ({ id }) => (
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
      <stop stopColor="#b01ecb" />
      <stop offset="0.5" stopColor="#2f6fe0" />
      <stop offset="1" stopColor="#1fc06b" />
    </linearGradient>
  </defs>
);

const base = {
  fill: 'none',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const FmStudioIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" />
      <g stroke={`url(#${g})`}>
        <path d="M12 3.5v6" />
        <path d="M19.4 7.8 14.2 10.7" />
        <path d="M19.4 16.2 14.2 13.3" />
        <path d="M12 20.5v-6" />
        <path d="M4.6 16.2 9.8 13.3" />
        <path d="M4.6 7.8 9.8 10.7" />
      </g>
    </svg>
  );
};

export const FmProjectsIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M7 7.5h13a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19.5H7A1.5 1.5 0 0 1 5.5 18V9A1.5 1.5 0 0 1 7 7.5Z" stroke="currentColor" />
      <path d="M3 15.5v-10A1.5 1.5 0 0 1 4.5 4H17" stroke={`url(#${g})`} />
      <path d="m5.5 16.5 3.6-3.8a1 1 0 0 1 1.45 0l2.2 2.3 1.7-1.5a1 1 0 0 1 1.35.03L21.5 18" stroke="currentColor" />
    </svg>
  );
};

export const FmClientsIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M3.5 7.5v-2a2 2 0 0 1 2-2h2" stroke="currentColor" />
      <path d="M20.5 7.5v-2a2 2 0 0 0-2-2h-2" stroke="currentColor" />
      <path d="M3.5 16.5v2a2 2 0 0 0 2 2h2" stroke="currentColor" />
      <path d="M20.5 16.5v2a2 2 0 0 1-2 2h-2" stroke="currentColor" />
      <circle cx="12" cy="10" r="2.6" stroke={`url(#${g})`} />
      <path d="M7.5 17.5c.9-2.3 2.5-3.4 4.5-3.4s3.6 1.1 4.5 3.4" stroke={`url(#${g})`} />
    </svg>
  );
};

export const FmImportIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5" stroke="currentColor" />
      <path d="M12 3.5V14" stroke={`url(#${g})`} />
      <path d="m8 10.5 4 4 4-4" stroke={`url(#${g})`} />
    </svg>
  );
};

export const FmCullingIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M4 8.5v-2a2 2 0 0 1 2-2h2" stroke="currentColor" />
      <path d="M20 8.5v-2a2 2 0 0 0-2-2h-2" stroke="currentColor" />
      <path d="M4 15.5v2a2 2 0 0 0 2 2h2" stroke="currentColor" />
      <path d="M20 15.5v2a2 2 0 0 1-2 2h-2" stroke="currentColor" />
      <path d="m8.2 12.2 2.6 2.6 5-5.3" stroke={`url(#${g})`} strokeWidth="2" />
    </svg>
  );
};

export const FmEditIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" />
      <circle cx="9" cy="7" r="2" fill={`url(#${g})`} stroke="none" />
      <circle cx="15.5" cy="12" r="2" fill={`url(#${g})`} stroke="none" />
      <circle cx="7" cy="17" r="2" fill={`url(#${g})`} stroke="none" />
    </svg>
  );
};

export const FmRetouchIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M13.5 10.5 4.8 19.2a1.9 1.9 0 0 0 2.7 2.7l8.7-8.7" stroke="currentColor" />
      <path d="M16.5 2.8 17.4 5l2.3.9-2.3.9-.9 2.2-.9-2.2L13.3 5.9l2.3-.9Z" fill={`url(#${g})`} stroke="none" />
      <path d="M20.7 10.2l.55 1.35 1.4.55-1.4.55-.55 1.35-.55-1.35-1.4-.55 1.4-.55Z" fill={`url(#${g})`} stroke="none" />
    </svg>
  );
};

export const FmExportIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5" stroke="currentColor" />
      <path d="M12 14V3.5" stroke={`url(#${g})`} />
      <path d="m8 7.5 4-4 4 4" stroke={`url(#${g})`} />
    </svg>
  );
};

export const FmAiCenterIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M11 4.5 12.8 9.2 17.5 11 12.8 12.8 11 17.5 9.2 12.8 4.5 11 9.2 9.2Z" fill={`url(#${g})`} stroke="none" />
      <path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
};

export const FmYoutubeIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <rect x="3" y="5.5" width="18" height="13" rx="3.5" stroke="currentColor" />
      <path d="M10.2 9.3v5.4l4.8-2.7Z" fill={`url(#${g})`} stroke="none" />
    </svg>
  );
};

export const FmSocialIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="m9.6 10.8 5-2.9M9.6 13.2l5 2.9" stroke="currentColor" />
      <circle cx="6.8" cy="12" r="2.8" stroke={`url(#${g})`} />
      <circle cx="17.2" cy="6.5" r="2.4" stroke="currentColor" />
      <circle cx="17.2" cy="17.5" r="2.4" stroke="currentColor" />
    </svg>
  );
};

export const FmVideoIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" />
      <path d="M7 4.5v15M17 4.5v15" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.2 8.5H7M3.2 12H7M3.2 15.5H7M17 8.5h3.8M17 12h3.8M17 15.5h3.8" stroke="currentColor" strokeWidth="1.1" />
      <path d="M10.8 9.8v4.4l3.7-2.2Z" fill={`url(#${g})`} stroke="none" />
    </svg>
  );
};

export const FmGenerateIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M13.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.5" stroke="currentColor" />
      <path d="M18 2.5 18.9 5.1 21.5 6 18.9 6.9 18 9.5 17.1 6.9 14.5 6 17.1 5.1Z" fill={`url(#${g})`} stroke="none" />
      <path d="m4.5 16.5 3.4-3.6a1 1 0 0 1 1.45 0l2.05 2.15 1.6-1.4a1 1 0 0 1 1.35.03L19.5 18" stroke="currentColor" />
    </svg>
  );
};

export const FmStyleIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <rect x="8" y="8" width="12.5" height="12.5" rx="2.5" stroke="currentColor" />
      <path d="M16 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h.5" stroke={`url(#${g})`} />
    </svg>
  );
};

export const FmGalleryIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8" stroke="currentColor" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" stroke="currentColor" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" stroke="currentColor" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.8" fill={`url(#${g})`} stroke="none" opacity="0.9" />
    </svg>
  );
};

export const FmPresetsIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="m12 3 8.5 4.8L12 12.6 3.5 7.8Z" stroke={`url(#${g})`} />
      <path d="M20.5 12.3 12 17.1l-8.5-4.8" stroke="currentColor" />
      <path d="M20.5 16.6 12 21.4l-8.5-4.8" stroke="currentColor" opacity="0.55" />
    </svg>
  );
};

export const FmHistoryIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M4.4 9.5A8 8 0 1 1 4 12" stroke="currentColor" />
      <path d="M4 5.5V9.5H8" stroke="currentColor" />
      <path d="M12 7.5V12l3.2 2" stroke={`url(#${g})`} />
    </svg>
  );
};

export const FmRawIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z" stroke="currentColor" />
      <path d="M13.5 3v5.5H19" stroke="currentColor" />
      <circle cx="12" cy="14.5" r="3.2" stroke={`url(#${g})`} />
      <circle cx="12" cy="14.5" r="0.9" fill={`url(#${g})`} stroke="none" />
    </svg>
  );
};

export const FmAutopilotIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => {
  const g = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <GradDefs id={g} />
      <path d="M12 3.5c-4.2 3-6.5 6.2-6.5 9.7A6.5 6.5 0 0 0 12 19.7a6.5 6.5 0 0 0 6.5-6.5c0-3.5-2.3-6.7-6.5-9.7Z" stroke="currentColor" />
      <path d="M12 20v1.5" stroke="currentColor" />
      <path d="M9.4 13.4 11.3 15.3 15 10.9" stroke={`url(#${g})`} strokeWidth="2" />
    </svg>
  );
};
