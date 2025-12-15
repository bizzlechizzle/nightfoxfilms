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

        // Functional colors (Braun/Ulm muted palette)
        success: '#4A8C5E',
        error: '#B85C4A',
        warning: '#C9A227',
        info: '#5A7A94',

        // Medium-specific accent colors
        medium: {
          dadcam: '#8B7355',   // Warm brown for vintage dad cam footage
          super8: '#C9A227',   // Golden amber for Super8 film
          modern: '#5A7A94',   // Steel blue for modern digital
        },

        // Status colors for import/export
        status: {
          pending: '#8A8A86',
          processing: '#5A7A94',
          complete: '#4A8C5E',
          error: '#B85C4A',
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
        // Remove decorative shadows - use borders instead (Braun principle)
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
