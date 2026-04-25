import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // Component tests need a DOM environment + jest-dom matchers.
        test: {
          name: 'dom',
          include: ['src/components/**/*.test.tsx'],
          environment: 'happy-dom',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
        },
      },
      {
        // Pure store/solver/data tests run in Node.
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
        },
      },
      {
        // Build-script tests (icon compositing, etc.) — plain Node, no DOM.
        test: {
          name: 'scripts',
          include: ['scripts/__tests__/**/*.test.{js,ts}'],
          environment: 'node',
          globals: true,
        },
      },
    ],
  },
})
