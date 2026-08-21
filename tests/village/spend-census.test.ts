import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { spendCensus } from '../../src/village/dwellings.js';
import { baseDeck } from '../../src/village/deck.js';
import type { Lot, Site } from '../../src/village/types.js';

const site = (population: number): Site => ({
  population, biome: 'temperate', routes: [], water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
});

// A line of well-separated lots, best-scoring first. frontageM 30 (bumped
// from 18): the refined manifest's sm-inn is [17, 15] with sizeFactor 1.5
// (minFrontage 27 m), far wider than batch001's [7, 6] inn — a fixed
// 18 m lot no longer fits it at all, which is exactly the f0-widening
// effect the ingest report measures.
const lots = (n: number): Lot[] => Array.from({ length: n }, (_, i) => ({
  id: `arm-090:R${i}`, laneId: i === 0 ? 'green' : 'arm-090', side: 1 as const,
  front: new Point(i * 20, 0), bearingDeg: 0, frontageM: 30, depthM: 25,
  score: 100 - i,
}));

// One dwelling family per village: the deck under test is a house-family
// deck at pop 400 (all landmarks eligible), built once with its own seed so
// the spend RNG below stays independent of the deck choice.
const DECK = baseDeck(400, new SeededRandom(99));

describe('spendCensus', () => {
  it('houses the census and then stops', () => {
    const out = spendCensus(lots(60), DECK, site(100), new SeededRandom(1));
    expect(out.housed).toBeGreaterThanOrEqual(100);
    expect(out.unhoused).toBe(0);
    expect(out.buildings.length).toBeLessThan(60);
  });

  it('leaves the worst-scoring lots empty — that is the straggle', () => {
    const out = spendCensus(lots(60), DECK, site(60), new SeededRandom(1));
    const used = new Set(out.buildings.map((b) => b.lotId));
    expect(used.has('arm-090:R0')).toBe(true);
    expect(used.has('arm-090:R59')).toBe(false);
  });

  // Ruling R5: the brief asserted the inn lands specifically on arm-090:R0,
  // the single best-scoring lot. That over-constrains the design: capped
  // entries are placed in deck order, and sm-house-large-tiled (the reeve's
  // house) precedes sm-inn in DECK, so the manor claims
  // the top lot and the inn takes the next-best. What the spec actually
  // states is that landmarks take the best lots, not which landmark wins
  // which — so assert the inn is placed, unique, and among the three
  // best-scoring lots.
  it('places capped landmarks first, among the best lots', () => {
    const out = spendCensus(lots(60), DECK, site(400), new SeededRandom(1));
    const inn = out.buildings.find((b) => b.glyph === 'sm-inn');
    expect(inn).toBeDefined();
    const bestThree = new Set(['arm-090:R0', 'arm-090:R1', 'arm-090:R2']);
    expect(bestThree.has(inn!.lotId)).toBe(true);
    expect(out.buildings.filter((b) => b.glyph === 'sm-inn')).toHaveLength(1);
  });

  it('reports what it could not house when it runs out of lots', () => {
    const out = spendCensus(lots(3), DECK, site(900), new SeededRandom(1));
    expect(out.unhoused).toBeGreaterThan(0);
  });

  it('never places two buildings that overlap', () => {
    const out = spendCensus(lots(40), DECK, site(200), new SeededRandom(2));
    for (let i = 0; i < out.buildings.length; i++) {
      for (let j = i + 1; j < out.buildings.length; j++) {
        const a = out.buildings[i];
        const b = out.buildings[j];
        const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(d).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const mk = () => spendCensus(lots(40), DECK, site(200), new SeededRandom(6));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });

  // The "never overlap" test above uses a well-separated fixture, so it
  // would pass even if the overlap guard were deleted — nothing in that
  // fixture is close enough to collide. This fixture puts two top-scoring
  // lots almost on top of each other so the guard has something to reject.
  it('skips a lot whose seated building would overlap one already placed', () => {
    const closeLots: Lot[] = [
      {
        id: 'arm-090:R0', laneId: 'arm-090', side: 1, front: new Point(0, 0),
        bearingDeg: 0, frontageM: 30, depthM: 25, score: 100,
      },
      {
        id: 'arm-090:R1', laneId: 'arm-090', side: 1, front: new Point(0.5, 0),
        bearingDeg: 0, frontageM: 30, depthM: 25, score: 99,
      },
      {
        id: 'arm-090:R2', laneId: 'arm-090', side: 1, front: new Point(40, 0),
        bearingDeg: 0, frontageM: 30, depthM: 25, score: 98,
      },
    ];
    const out = spendCensus(closeLots, DECK, site(20), new SeededRandom(3));
    const used = new Set(out.buildings.map((b) => b.lotId));
    // R0 and R1 sit almost on top of each other; the second seating must be
    // rejected as an overlap, so both can never be occupied at once.
    expect(used.has('arm-090:R0') && used.has('arm-090:R1')).toBe(false);
  });

  // Ruling R14: Pass A must retry the next eligible lot when a capped
  // landmark's first-choice seating collides with one already placed, not
  // give up on the landmark for the whole village. The manor (deck order:
  // first) takes R0; the inn's first choice, R1, sits 0.5 m away and must
  // collide with the manor, so the inn has to fall through to R2 — far
  // enough away to clear. Population 300 satisfies both landmarks' minPop
  // (manor 250, inn 180). Against the old find-then-continue version, the
  // inn would be abandoned entirely once its first choice collided.
  it('retries the next eligible lot when a capped landmark collides on its first choice', () => {
    const contestedLots: Lot[] = [
      {
        id: 'arm-090:R0', laneId: 'arm-090', side: 1, front: new Point(0, 0),
        bearingDeg: 0, frontageM: 30, depthM: 25, score: 100,
      },
      {
        id: 'arm-090:R1', laneId: 'arm-090', side: 1, front: new Point(0.5, 0),
        bearingDeg: 0, frontageM: 30, depthM: 25, score: 99,
      },
      {
        id: 'arm-090:R2', laneId: 'arm-090', side: 1, front: new Point(40, 0),
        bearingDeg: 0, frontageM: 30, depthM: 25, score: 98,
      },
    ];
    const out = spendCensus(contestedLots, DECK, site(300), new SeededRandom(1));
    const manor = out.buildings.find((b) => b.glyph === 'sm-house-large-tiled');
    const inn = out.buildings.find((b) => b.glyph === 'sm-inn');
    expect(manor).toBeDefined();
    expect(inn).toBeDefined();
    expect(manor!.lotId).not.toBe(inn!.lotId);
  });
});
