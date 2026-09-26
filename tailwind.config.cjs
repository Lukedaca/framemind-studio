/** @type {import('tailwindcss').Config} */

// Inkoustová škála: skoro černá s nádechem fialovomodré z loga. Na fotku se
// v editoru díváme přes neutrální tmu — barevné pozadí by klamalo oko při
// posuzování barev, proto jen nepatrný odstín, žádné barevné mlhoviny.
const ink = {
  50: '#f5f5f8',
  100: '#e6e6ee',
  200: '#c8c8d6',
  300: '#a0a0b4',
  400: '#76768c',
  500: '#56566a',
  600: '#3a3a4a',
  700: '#262632',
  800: '#1a1a23',
  850: '#14141c',
  900: '#0f0f15',
  950: '#09090d',
};

module.exports = {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink,
        hairline: 'rgba(255, 255, 255, 0.07)',
        // Starší sémantické tokeny, které používají zbylé obrazovky (culling,
        // projekty, klienti) — mapované na novou škálu, ať celá appka drží jeden tón.
        void: ink[950],
        surface: ink[900],
        elevated: ink[800],
        // FrameMind brand — paleta z loga (magenta → modrá → zelená)
        fm: {
          magenta: '#b01ecb',
          blue: '#2f6fe0',
          green: '#1fc06b',
          red: '#ff5470',
          violet: '#cf8cff',
        },
        accent: {
          DEFAULT: '#6f8dff',
          hover: '#8ea6ff',
          muted: '#2f4a9e',
        },
        indigo: {
          50: '#eef2ff', 100: '#dde4ff', 200: '#bccaff', 300: '#94a9ff', 400: '#6f8dff',
          500: '#4f6ff0', 600: '#3d57cc', 700: '#3044a3', 800: '#26367f', 900: '#1e2b63', 950: '#131a3b',
        },
        emerald: {
          50: '#e9fbf1', 100: '#c9f5dd', 200: '#94ebbc', 300: '#5cdd97', 400: '#3fd585',
          500: '#1fc06b', 600: '#17a058', 700: '#128047', 800: '#0f6539', 900: '#0c522f', 950: '#062e1a',
        },
        gray: {
          100: ink[100],
          400: ink[400],
          500: ink[500],
          600: ink[600],
          800: ink[800],
        },
        success: '#1fc06b',
        warning: '#e8a33d',
        error: '#ff5470',
        text: {
          primary: ink[50],
          secondary: ink[300],
        },
        border: {
          subtle: ink[700],
        },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        glow: '0 0 24px rgba(111, 141, 255, 0.25)',
      },
    },
  },
  plugins: [],
};
