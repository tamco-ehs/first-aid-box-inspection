import type { Config } from 'tailwindcss';

// Shopfloor-first theme: generous touch targets, high-contrast status colors.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#16a34a', // ESH green
          dark: '#15803d',
          light: '#dcfce7',
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
