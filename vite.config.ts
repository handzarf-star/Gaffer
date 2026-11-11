import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { buildIdFromFiles } from './scripts/build-id.mjs';

/** Writes the build id into index.html. Under `vite dev` there is no bundle, so the id is "dev" and nothing ever looks out of date. */
function buildIdPlugin(): Plugin {
  return {
    name: 'gaffer-build-id',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const files = ctx.bundle ? Object.keys(ctx.bundle).filter((f) => f.startsWith('assets/')) : [];
        const id = files.length ? buildIdFromFiles(files) : 'dev';
        return html.replace('</head>', `    <meta name="gaffer-build" content="${id}" />\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), buildIdPlugin()],
  build: { outDir: 'dist/client', emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
