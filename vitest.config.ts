import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Fix round 1 of the R20 debt (2026-08-21): MAX_FEEDBACK_ROUNDS went
    // 3 -> 4 to restore full-census village housing after the
    // seatEfficiency fix. That is real extra work across every village
    // fixture, and under full parallel test-file contention it was
    // enough to occasionally tip an UNRELATED, tightly-timed test (the
    // old engine's harbour seed sweep) past the 5s default. Bumped once,
    // globally, rather than chasing individual timeouts file by file.
    // Bumped again, same reasoning, 2026-09-06 (trunk networks). The village
    // engine now draws FMG's routes as a synthesized trunk network sampled at
    // 6 m out to 2.75x the closed-form radius, which is more geometry through
    // every O(n^2) crossing, weld and block pass than the old straight arms
    // were; and the `SeededRandom` seed scramble changed which meshes each
    // seed builds, so several heavy end-to-end sweeps moved. Measured: the
    // worst city sweep runs ~36 s alone and ~15 s inside the full suite
    // (earlier files warm the module and glyph caches), and the village
    // structural sweeps generate twelve villages apiece. Two unrelated tests
    // tipped 15 s on consecutive full runs -- different ones each time, which
    // is the signature of scheduling rather than of any one test.
    //
    // This is a wall-clock allowance. It weakens no assertion, and a genuine
    // hang still fails, just later.
    testTimeout: 60000,
  },
});
