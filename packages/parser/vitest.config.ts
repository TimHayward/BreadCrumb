import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'parser',
    include: ['test/**/*.test.ts'],
  },
});
