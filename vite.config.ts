import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/kherson/',
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  test: {
    // CI runners are ~3× slower than a laptop; voxel and flocking tests run for seconds there
    testTimeout: 30_000,
  },
});
