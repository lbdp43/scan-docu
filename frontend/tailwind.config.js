/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Tokens -> variables CSS (voir index.css) : permet le thème clair/sombre.
      // Triplets RGB pour garder les modificateurs d'opacité (ex. green-mid/20).
      colors: {
        'green-deep': 'rgb(var(--green-deep) / <alpha-value>)',
        'green-mid': 'rgb(var(--green-mid) / <alpha-value>)',
        'green-bright': 'rgb(var(--green-bright) / <alpha-value>)',
        'green-light': 'rgb(var(--green-light) / <alpha-value>)',
        'gold': 'rgb(var(--gold) / <alpha-value>)',
        'bg': 'rgb(var(--bg) / <alpha-value>)',
        'bg2': 'rgb(var(--bg2) / <alpha-value>)',
        'card': 'rgb(var(--card) / <alpha-value>)',
        'card-border': 'rgb(var(--card-border) / <alpha-value>)',
        'text': 'rgb(var(--tx) / <alpha-value>)',
        'text-muted': 'rgb(var(--tx-muted) / <alpha-value>)',
        'text-dim': 'rgb(var(--tx-dim) / <alpha-value>)',
      },
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'Courier New', 'monospace'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
        '4xl': '28px',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        logoPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(77,158,64,0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(77,158,64,0.6)' },
        },
        toastIn: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease forwards',
        'logo-pulse': 'logoPulse 3s ease-in-out infinite',
        'toast-in': 'toastIn 0.4s ease forwards',
      },
    },
  },
  plugins: [],
};
