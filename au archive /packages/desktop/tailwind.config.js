import { skeleton } from '@skeletonlabs/tw-plugin';

export default {
  content: [
    './index.html',
    './src/**/*.{svelte,js,ts}',
    './node_modules/@skeletonlabs/skeleton/**/*.{html,js,svelte,ts}'
  ],
  theme: {
    extend: {
      colors: {
        // Braun neutral scale
        braun: {
          50: '#FAFAF8',   // Background
          100: '#F4F4F2',  // Background alt
          200: '#EEEEED',  // Border muted
          300: '#E2E1DE',  // Border
          400: '#C0BFBC',  // Text disabled
          500: '#8A8A86',  // Text muted
          600: '#5C5C58',  // Text secondary
          900: '#1C1C1A',  // Text primary
        },

        // Functional colors only (color = information)
        // Braun/Ulm School muted functional palette
        gps: {
          verified: '#4A8C5E',  // Muted sage green - map confirmed
          high: '#5A7A94',      // Muted steel blue - EXIF high accuracy
          medium: '#C9A227',    // Muted ochre - reverse geocoded
          low: '#B85C4A',       // Muted terracotta - manual/estimate
          none: '#8A8A86',      // Warm gray - no GPS
        },

        // Status colors (matching GPS muted palette)
        success: '#4A8C5E',
        error: '#B85C4A',
        warning: '#C9A227',

        // Legacy aliases (for gradual migration)
        accent: '#1C1C1A',       // Now near-black, was gold
        background: '#FAFAF8',   // Cool paper, was warm cream
        foreground: '#1C1C1A',   // Near-black, was gunmetal
        primary: '#1C1C1A',      // Near-black primary actions
        secondary: '#5C5C58',    // Secondary text/elements
        danger: '#B85C4A',       // Muted terracotta
        verified: '#4A8C5E',     // Muted sage green
        unverified: '#8A8A86',   // Warm gray

        // Blue (REFERENCE PINS ONLY - preserved from original)
        blue: {
          DEFAULT: '#3B82F6',
          light: '#60A5FA',
          dark: '#1D4ED8',
        },
      },
      fontFamily: {
        sans: ['Braun Linear', 'system-ui', '-apple-system', 'sans-serif'],
        heading: ['Braun Linear', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Braun Linear', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',  // Override md to match default (max 4px)
        lg: '4px',  // Override lg to match default (max 4px)
        xl: '4px',  // Override xl to match default (max 4px)
        '2xl': '4px', // Override 2xl to match default (max 4px)
        '3xl': '4px', // Override 3xl to match default (max 4px)
        full: '9999px', // Keep full for specific circular use cases
      },
      letterSpacing: {
        tighter: '-0.02em',
        tight: '-0.01em',
        normal: '0',
        wide: '0.05em',
        wider: '0.1em',
      },
      boxShadow: {
        // Remove decorative shadows - use borders instead
        none: 'none',
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
        '2xl': 'none',
      },
    },
  },
  plugins: [skeleton],
};
