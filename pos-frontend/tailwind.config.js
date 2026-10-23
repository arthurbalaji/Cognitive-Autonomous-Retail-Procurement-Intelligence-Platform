/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { pos: { 500: '#0f766e', 600: '#0d5f59', 50: '#f0fdfa', 100: '#ccfbf1' } } } },
  plugins: [],
};
