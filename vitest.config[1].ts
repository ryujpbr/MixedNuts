import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@mixednuts/engine': r('./packages/engine/src/index.ts'),
      '@mixednuts/protocol': r('./packages/protocol/src/index.ts'),
    },
  },
  test: { include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'] },
});
