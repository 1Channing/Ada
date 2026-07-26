/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette MC Export (dégradé marine → azur du logo). Le bleu Tailwind
        // est recalibré sur la marque : les ~270 usages existants de blue-*
        // deviennent des bleus MC Export sans toucher chaque page.
        blue: {
          50: '#EEF5FB',
          100: '#DCEBF7',
          200: '#BCD9F0',
          300: '#8FD0F0', // ciel
          400: '#5B9BD0',
          500: '#4FA8DC', // atlantique — accent, focus
          600: '#2C5F9E', // océan — actions primaires
          700: '#22346E', // encre — hover, titres
          800: '#1B2A58',
          900: '#141F42',
          950: '#0B0F1D', // nuit bleutée
        },
        brand: {
          encre: '#22346E',
          ocean: '#2C5F9E',
          atlantique: '#4FA8DC',
          ciel: '#8FD0F0',
        },
      },
    },
  },
  plugins: [],
};
