import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // Module-level code (src/config/env.ts) reads these at import time, before
    // any test can mock anything. They are inert placeholders; real values
    // never reach tests.
    env: {
      VITE_SUPABASE_URL: 'https://test-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
