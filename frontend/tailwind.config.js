/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'green-deep': '#1A3A1C',
        'green-mid': '#2D6A27',
        'green-bright': '#4A9E40',
        'green-light': '#7FD472',
        'gold': '#C8A84B',
        'bg': '#0C150D',
        'bg2': '#111B12',
        'card': 'rgba(255,255,255,0.055)',
        'card-border': 'rgba(255,255,255,0.08)',
        'text': '#F0F4F0',
        'text-muted': '#7A9C7A',
        'text-dim': '#5E7E5E',
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
