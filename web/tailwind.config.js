/** @type {import('tailwindcss').Config} */
// Palet: #000000 · #14213d (lacivert) · #fca311 (amber) · #e5e5e5 (sis) · #ffffff
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef1f7',
          100: '#d4dced',
          200: '#a9b8db',
          300: '#7d92c6',
          400: '#4f6aa6',
          500: '#2b4680',
          600: '#1b2f57',
          700: '#14213d', // ana marka rengi (lacivert)
          800: '#0e1729',
          900: '#080d18',
          DEFAULT: '#14213d',
        },
        accent: {
          50: '#fff7e8',
          100: '#fdeac2',
          200: '#fbd88a',
          300: '#fbc551',
          400: '#fcb42f',
          500: '#fca311', // vurgu (amber) — eylem butonları
          600: '#e08a00',
          700: '#b36a02',
          800: '#8c530a',
          900: '#73450d',
          DEFAULT: '#fca311',
        },
        ink: '#000000',
        mist: '#e5e5e5',
        paper: '#ffffff',
        // Yüzey tonları (paletten türetilmiş nötrler)
        canvas: '#f1f2f4', // uygulama arka planı (mist'in açık tonu)
        line: '#e2e4e8', // ince kenarlıklar
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(20,33,61,0.08), 0 1px 2px rgba(20,33,61,0.06)',
        pop: '0 10px 30px -10px rgba(20,33,61,0.35)',
      },
      minHeight: {
        touch: '48px', // tek elle kullanım — dokunma hedefi ≥48px (PRD §5.2)
      },
      minWidth: {
        touch: '48px',
      },
    },
  },
  plugins: [],
}
