/**
 * Task 8: the spec's structural invariants (5.6), asserted on the FINISHED
 * model rather than on the network in isolation.
 *
 * `trunks-structure.test.ts` pins what `synthesizeTrunks` hands over. These
 * are the properties that must survive everything that happens afterwards --
 * growth, relaxation, trimming, connectors, the block chase -- because G3
 * and Phase 4's GeoJSON both rely on them holding of the SHIPPED model.
 */
import { describe, expect, it } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { isTrunk } from '../../src/village/skeleton/trunks.js';
import { segmentIntersection, dist } from '../../src/village/geometry.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type { VillageModel } from '../../src/village/types.js';

const flags = {
  port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false,
};

const PANEL_CROSS: AzgaarBurgInput['roadBearings'] = [
  { bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
  { bearing_deg: 130, kind: 'town', route_id: 'r-town' },
  { bearing_deg: 225, kind: 'local', route_id: 'r-local' },
  { bearing_deg: 305, kind: 'trail', route_id: 'r-trail' },
];

const FAN: AzgaarBurgInput['roadBearings'] = [
  { bearing_deg: 90.0, kind: 'main', route_id: 'a' },
  { bearing_deg: 90.5, kind: 'main', route_id: 'b' },
  { bearing_deg: 91.2, kind: 'town', route_id: 'c' },
  { bearing_deg: 130, kind: 'local', route_id: 'd' },
  { bearing_deg: 170, kind: 'trail', route_id: 'e' },
  { bearing_deg: 210, kind: 'footpath', route_id: 'f' },
  { bearing_deg: 250, kind: 'main', through: true, route_id: 'g' },
  { bearing_deg: 330, kind: 'royal', route_id: 'h' },
];

const SCENARIOS: Array<{ name: string; roads: AzgaarBurgInput['roadBearings'] }> = [
  { name: 'panel-cross', roads: PANEL_CROSS },
  { name: 'fan', roads: FAN },
];
const POPS = [300, 900];
const SEEDS = [1, 2, 3];

const input = (roads: AzgaarBurgInput['roadBearings'], population: number): AzgaarBurgInput =>
  ({ name: 'Struct', population, ...flags, roadBearings: roads } as AzgaarBurgInput);

function each(fn: (m: VillageModel, label: string, roads: AzgaarBurgInput['roadBearings']) => void): void {
  for (const { name, roads } of SCENARIOS) {
    for (const pop of POPS) {
      for (const seed of SEEDS) {
        fn(generateVillage(input(roads, pop), seed), `${name} pop ${pop} seed ${seed}`, roads);
      }
    }
  }
}

/**
 * The proper-crossing predicate, copied from `scripts/metrics-lib.ts`'s
 * `crossings` (scripts sit outside the test tsconfig, so it cannot be
 * imported). `segmentIntersection` already excludes shared endpoints, so a
 * junction is not a crossing.
 */
function crosses(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

// Each bar below generates TWELVE villages end to end (2 scenarios x 2
// populations x 3 seeds), so they are slow by construction -- 4-8 s each,
// and the first also pays module and glyph-manifest warm-up. They rely on
// the global `testTimeout` in `vitest.config.ts`, which carries the
// measurement and the reasoning.
describe('spec 5.6 structural invariants, on the shipped model', () => {
  it('(a) every FMG route is carried by the network, matched on whole ids', () => {
    // Was a SUBSTRING test (`t.id.includes(id)`), which in the `fan`
    // scenario -- whose route ids are single letters -- passed route 'a'
    // against `trunk-trail-e` and `trunk-local-d`. Several routes were
    // "represented" by lanes that had nothing to do with them.
    //
    // Matched on whole id segments now. The plan's wording was "exactly
    // once"; the honest bar is "at least once", because `resolveCrossings`
    // legitimately splits one road into `<id>` and `<id>~x<other>` halves,
    // and a merged road reports its several routes on `sourceRouteIds`.
    // Uniqueness of the CARRIER is asserted by the id-uniqueness bar.
    each((m, label, roads) => {
      const trunks = m.lanes.filter((l) => isTrunk(l.id));
      for (const road of roads as Array<{ route_id?: string }>) {
        const id = road.route_id!;
        const carriers = trunks.filter((t) => {
          if ((t.sourceRouteIds ?? []).includes(id)) return true;
          // `trunk-<class>-<routeId>` optionally followed by `~far`, a
          // crossing-split `~x...`, or a `/b` branch suffix — never a bare
          // substring.
          return new RegExp(`^trunk-[a-z]+-${id}(~|/|$)`).test(t.id);
        });
        expect(carriers.length, `${label}: route ${id} is carried by no lane`)
          .toBeGreaterThan(0);
      }
    });
  });

  it('(b) every route still meets the contract circle at its exact bearing', () => {
    each((m, label, roads) => {
      const trunks = m.lanes.filter((l) => isTrunk(l.id) && l.points.length >= 2);
      for (const road of roads as Array<{ bearing_deg: number; route_id?: string; through?: boolean }>) {
        const wanted = road.through
          ? [road.bearing_deg, (road.bearing_deg + 180) % 360]
          : [road.bearing_deg];
        for (const bearingDeg of wanted) {
          const rad = (bearingDeg * Math.PI) / 180;
          const at = new Point(
            Math.sin(rad) * m.contractRadiusM, -Math.cos(rad) * m.contractRadiusM,
          );
          const reach = Math.min(...trunks.flatMap(
            (t) => t.points.map((p) => dist(p, at)),
          ));
          // Within one sample step of the entry point: the boundary contract
          // is what lets a consumer line our tile up with FMG's own routes.
          expect(reach, `${label}: nothing reaches ${road.route_id} at ${bearingDeg} deg`)
            .toBeLessThanOrEqual(8);
        }
      }
    });
  });

  it('(c) no two lanes cross without a junction', () => {
    each((m, label) => {
      const lanes = m.lanes.filter((l) => l.points.length >= 2);
      let found = '';
      for (let i = 0; i < lanes.length && !found; i++) {
        for (let j = i + 1; j < lanes.length; j++) {
          if (crosses(lanes[i].points, lanes[j].points)) {
            found = `${lanes[i].id} x ${lanes[j].id}`;
            break;
          }
        }
      }
      expect(found, `${label}: ${found}`).toBe('');
    });
  });

  it('(d) a trail terminates ON the network, never on its own in the middle', () => {
    // Ruling 4: "trail-class entries terminate on the network between houses
    // or on the route -- they never demand their own line to the centre."
    //
    // Stated as "ends on another road", not as "keeps away from the green".
    // The first draft asserted the latter and failed on panel-cross pop 300
    // seed 2, where a trail merges onto the main road at a point that
    // happens to sit inside an ASTRIDE green -- the trail is terminating on
    // the main road exactly as ruling 4 wants, and the green being there is
    // Task 7 doing its job. What ruling 4 forbids is a trail running to the
    // middle and stopping with nothing to stop against.
    each((m, label) => {
      if (m.greenRelation === 'terminal') return;
      const lanes = m.lanes.filter((l) => l.points.length >= 2);
      const trails = lanes.filter(
        (l) => isTrunk(l.id) && (l.type === 'trail' || l.type === 'footpath'),
      );
      for (const t of trails) {
        const inner = t.points[0];
        // Within a sample step of some other lane's drawn line.
        const onAnother = lanes.some(
          (o) => o.id !== t.id && o.points.some((p) => dist(p, inner) <= 8),
        );
        expect(onAnother, `${label}: ${t.id} ends in open ground`).toBe(true);
      }
    });
  });

  it('(e) the same seed gives the same village, end to end', () => {
    for (const { name, roads } of SCENARIOS) {
      for (const pop of POPS) {
        const a = generateVillage(input(roads, pop), 2);
        const b = generateVillage(input(roads, pop), 2);
        expect(JSON.stringify(a.lanes), `${name} pop ${pop}: lanes`).toBe(JSON.stringify(b.lanes));
        expect(JSON.stringify(a.buildings), `${name} pop ${pop}: buildings`)
          .toBe(JSON.stringify(b.buildings));
        expect(a.greenRelation).toBe(b.greenRelation);
      }
    }
  });
});
