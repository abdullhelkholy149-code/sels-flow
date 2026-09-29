import type { Config } from 'tailwindcss';

/**
 * Design tokens live here so that light/dark and future themes stay consistent.
 * Direction-aware spacing is used everywhere (ms/me/ps/pe) so a single set of
 * styles works for both Arabic (RTL) and English (LTR).
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f1',
          100: '#d6ecdf',
          200: '#aed9c1',
          300: '#7dc09e',
          400: '#4da47c',
          500: '#2f8862',
          600: '#216d4f',
          700: '#1b5741',
          800: '#164535',
          900: '#11392c',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f6f7f9',
          sunken: '#eceef2',
          border: '#dfe3e9',
        },
        ink: {
          DEFAULT: '#111827',
          muted: '#5b6472',
          subtle: '#8b93a1',
          inverse: '#ffffff',
        },
        danger: {
          DEFAULT: '#c0392b',
          soft: '#fdeceb',
        },
        warning: {
          DEFAULT: '#b26a00',
          soft: '#fdf3e3',
        },
        success: {
          DEFAULT: '#1f7a4d',
          soft: '#e9f6ef',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '0.75rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(17 24 39 / 0.06), 0 1px 3px 0 rgb(17 24 39 / 0.1)',
        pop: '0 8px 24px 0 rgb(17 24 39 / 0.12)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
