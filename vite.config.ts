import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vitest/config';

// One id per deploy: the world data is fetched with ?v=<id> and dist/version.json carries it, so a page
// cached by GitHub Pages (max-age=600, not configurable) notices a newer deploy and reloads.
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 10);
  try {
    return execSync('git rev-parse --short=10 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() + `-${Date.now().toString(36)}`;
  } catch {
    return `dev-${Date.now().toString(36)}`;
  }
}
const BUILD_ID = buildId();

const versionFile: Plugin = {
  name: 'version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
  },
};

export default defineConfig({
  base: '/kherson/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile],
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
