import type { Config } from 'tailwindcss';

// Shopfloor-first theme: generous touch targets, high-contrast status colors.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#dc2626', // first-aid red
          dark: '#b91c1c',
        },
      },
      minHeight: {
        14: '3.5rem',
        touch: '3rem',
      },
    },
  },
  plugins: [],
};

export default config;
