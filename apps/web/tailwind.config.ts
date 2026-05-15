import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0ea5e9',
          dark: '#0369a1',
        },
      },
      minHeight: { touch: '56px' },
      minWidth: { touch: '56px' },
    },
  },
  plugins: [],
} satisfies Config;
