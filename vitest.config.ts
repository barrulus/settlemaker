import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Fix round 1 of the R20 debt (2026-08-21): MAX_FEEDBACK_ROUNDS went
    // 3 -> 4 to restore full-census village housing after the
    // seatEfficiency fix. That is real extra work across every village
    // fixture, and under full parallel test-file contention it was
    // enough to occasionally tip an UNRELATED, tightly-timed test (the
    // old engine's harbour seed sweep) past the 5s default. Bumped once,
    // globally, rather than chasing individual timeouts file by file.
    testTimeout: 15000,
  },
});
