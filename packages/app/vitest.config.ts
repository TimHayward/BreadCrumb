import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'app',
    include: ['test/**/*.test.ts'],
    // Server startup under parallel workers (jsdom, axe) can pass 5 s on slow runners.
    testTimeout: 20000,
  },
});
