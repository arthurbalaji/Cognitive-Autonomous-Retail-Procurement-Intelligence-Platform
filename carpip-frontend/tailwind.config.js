/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ink: { DEFAULT: '#0f172a', soft: '#475569', mute: '#94a3b8' }, brand: { 50: '#eff6ff', 100: '#dbeafe', 500: '#2a78d6', 600: '#1f66bd', 700: '#1a5299' } },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
