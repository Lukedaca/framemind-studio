/** @type {import('tailwindcss').Config} */
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
        void: '#050505',      // Softer black
        surface: '#0f0f0f',   // Rich dark grey
        elevated: '#1a1a1a',  // Card bg
        // FrameMind brand — paleta přesně z loga (magenta → modrá → zelená)
        fm: {
          magenta: '#b01ecb',
          blue: '#2f6fe0',
          green: '#1fc06b',
          red: '#ff5470',
          violet: '#cf8cff',
        },
        accent: {
          DEFAULT: '#2f6fe0', // FrameMind blue
          hover: '#5b8fee',
          muted: '#1f479e',
        },
        // Tailwind indigo/emerald přemapované na FrameMind tóny — všechny stávající
        // komponenty (bg-indigo-500, text-emerald-500…) tím přejdou na brand barvy
        // bez zásahu do každého souboru.
        indigo: {
          50: '#eef4fe',
          100: '#d9e6fc',
          200: '#b3cdf9',
          300: '#85adf4',
          400: '#5b8fee',
          500: '#2f6fe0',
          600: '#2558c4',
          700: '#1f479e',
          800: '#1c3c80',
          900: '#19346a',
          950: '#111f42',
        },
        emerald: {
          50: '#e9fbf1',
          100: '#c9f5dd',
          200: '#94ebbc',
          300: '#5cdd97',
          400: '#3fd585',
          500: '#1fc06b',
          600: '#17a058',
          700: '#128047',
          800: '#0f6539',
          900: '#0c522f',
          950: '#062e1a',
        },
        white: '#FAFAFA',
        gray: {
          100: '#F3F4F6',
          400: '#9CA3AF',
          600: '#4B5563',
          800: '#1F2937',
        },
        success: '#1fc06b',   // FrameMind green
        warning: '#F59E0B',   // Amber
        error: '#EF4444',     // Red
        text: {
          primary: '#F9FAFB',
          secondary: '#9CA3AF',
        },
        border: {
          subtle: '#27272a', // Gray 800
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'], // Modern tech mono
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(47, 111, 224, 0.3)',
      }
    },
  },
  plugins: [],
};
