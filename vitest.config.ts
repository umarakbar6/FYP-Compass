import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// Regression tests must never use the supplied live backend configuration.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_BACKEND_API': JSON.stringify('legacy'),
    'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true'),
  },
  test: {
    env: { VITE_TURNSTILE_SITE_KEY: '' },
    include: ['src/test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    pool: 'forks',
    teardownTimeout: 30000,
    globals: true,
    fileParallelism: false,
    testTimeout: 20000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
