import { defineConfig } from 'vite';

export default defineConfig({
  base: '/kherson/',
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
