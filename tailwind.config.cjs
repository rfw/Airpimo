/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        destructive: 'hsl(var(--destructive))',
        card: 'hsl(var(--card))'
      },
      borderRadius: { lg: '12px', md: '9px' },
      boxShadow: { soft: '0 6px 22px rgba(15,23,42,.035)' },
      keyframes: {
        'airpimo-water-ripple': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '50%': { opacity: '0.5' },
          '85%': { opacity: '0.25' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
