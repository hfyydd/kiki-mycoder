import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/webview',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/webview/index.tsx'),
      },
      output: {
        entryFileNames: 'static/js/[name].js',
        chunkFileNames: 'static/js/[name].[hash].js',
        assetFileNames: 'static/[ext]/[name].[hash].[ext]',
      },
    },
    sourcemap: true,
    // Prevent splitting into multiple chunks
    target: 'esnext',
    minify: 'esbuild'
  },
});
