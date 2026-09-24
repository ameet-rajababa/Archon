import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Throwaway config: builds packages/web/mock into a self-contained static page. */
export default defineConfig({
  root: path.resolve(__dirname, 'mock'),
  base: '/assets/files-mock/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: '/app/packages/web/dist/assets/files-mock',
    emptyOutDir: true,
  },
});
