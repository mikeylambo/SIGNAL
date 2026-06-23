import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    // Three.js + postprocessing is large by design; suppress the warning
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: { manualChunks: undefined }
    }
  }
});
