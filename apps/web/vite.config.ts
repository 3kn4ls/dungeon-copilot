import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, la API la sirve apps/server.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
