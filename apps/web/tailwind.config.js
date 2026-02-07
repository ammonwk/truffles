/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        severity: {
          red: '#EF4444',
          yellow: '#F59E0B',
          green: '#22C55E',
          grey: '#6B7280',
        },
      },
    },
  },
  plugins: [],
};
