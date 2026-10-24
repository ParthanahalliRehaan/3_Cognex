// Plain-Node vitest config for the security tests + agent tests.
// (The default vitest.config.js runs the Cloudflare Workers pool and is left untouched.)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/node/**/*.test.js'],
    testTimeout: 20000,
  },
});
