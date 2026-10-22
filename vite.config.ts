import { publicEnvironmentNames } from './scripts/public-environment.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// Windows can temporarily lock newly copied documentation. Poll only app sources.
export default defineConfig({
  envPrefix: [...publicEnvironmentNames],
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('lucide')) return 'icons';
          }
        },
      },
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: [
        '**/.private/**',
        '**/.vercel/**',
        '**/context/**',
        '**/docs/**',
        '**/handover/**',
        '**/backend/**',
        '**/supabase/**',
        '**/source-archives/**',
      ],
    },
  },
});
