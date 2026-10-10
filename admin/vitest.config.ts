import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['tests/db/global-setup.ts'],
          // The database tests share one database, so they run one file at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
