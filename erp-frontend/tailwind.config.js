/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { erp: { 50: '#fff7ed', 100: '#ffedd5', 500: '#c2410c', 600: '#9a3412' } } } },
  plugins: [],
};
