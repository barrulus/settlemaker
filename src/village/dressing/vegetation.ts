import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  closestPointOnSegment, dist, greenDrawnRadius, inAnyWater, withinLaneCorridor,
} from '../geometry.js';
import { lotObb, pointInObb } from '../parcels/overlap.js';
import {
  CLUMP_RADIUS_M, SHOREFRONT_BAND_M, VEG_BASE_DENSITY, VEG_CELL_M,
  VEG_GLYPHS, VEG_INFILL_SHARE, VEG_LANE_CLEAR_M, VEG_RADIUS_FACTOR, VEG_RAMP_PEAK_SHARE,
  VEG_SCALE_MAX, VEG_SCALE_MIN,
} from '../constants.js';
import type {
  Croft, FieldStrip, Green, Lane, Lot, Site, Vegetation,
} from '../types.js';

/**
 * §7.3: vegetation scatter, the last dressing stage. A deterministic square
 * grid (VEG_CELL_M) stands in for Poisson dart-throwing -- one rng.float()
 * decides EVERY cell's survival, so the draw count never depends on how
 * many darts land. A surviving cell draws its position (2 floats), glyph
 * (1 float) and scale jitter (1 float) regardless of whether the resulting
 * tree is later rejected by a geometry test -- rejection discards the
 * tree, never the draws already spent on it. Only a tree that also clears
 * every rejection test may spawn clump neighbours (1 rng.int + 2 floats
 * per neighbour).
 *
 * Draw order per cell, cells walked in sorted (cellX, then cellY) order:
 *   1. survival float
 *   2-3. (if survived) x/y offset floats, placing the tree within the cell
 *   4. glyph pick float (biome-weighted)
 *   5. scale jitter float
 *   6. (if the tree clears rejection) rng.int(0,3) clump-count draw
 *   7-8. per clump neighbour: 2 offset floats (glyph/scale reused from parent)
 */

/** Closest distance from `p` to any edge of any water ring -- used only by
 * the shorefront band test (§8.4); ordinary water avoidance uses
 * `inAnyWater` (point-in-polygon), not this. */
function distToWaterEdge(p: Point, water: Point[][]): number {
  let best = Infinity;
  for (const ring of water) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const q = closestPointOnSegment(p, a, b);
      best = Math.min(best, dist(p, q));
    }
  }
  return best;
}

/**
 * The rejection tests §7.3/§8.4 specify: lane corridors, lot claims, croft
 * polygons, field strip polygons, the green's drawn turf, water surfaces,
 * and (near the green) the shorefront band. Water BANKS beyond that band
 * are neutral -- no bonus, no extra avoidance.
 */
function isRejected(
  p: Point, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldStrip[],
  water: Point[][], shorefrontReachM: number,
): boolean {
  if (dist(p, green.centre) < greenDrawnRadius(green)) return true;
  if (inAnyWater(p, water)) return true;
  for (const lane of lanes) if (withinLaneCorridor(p, lane, VEG_LANE_CLEAR_M)) return true;
  for (const lot of lots) if (pointInObb(p, lotObb(lot))) return true;
  for (const croft of crofts) if (pointInPolygon(p, croft.polygon)) return true;
  for (const field of fields) if (pointInPolygon(p, field.polygon)) return true;
  if (water.length > 0 && dist(p, green.centre) <= shorefrontReachM) {
    if (distToWaterEdge(p, water) <= SHOREFRONT_BAND_M) return true;
  }
  return false;
}

/**
 * Density(d): 0 beyond `rim`; a flat "leftover ground" share inside
 * `innerEdge` (VEG_INFILL_SHARE -- the rejection tests above are what
 * actually confine this to genuinely unclaimed ground); and, per §7.3's
 * "thinning outward from the fabric", a full-strength PLATEAU just outside
 * `innerEdge` (the first VEG_RAMP_PEAK_SHARE of the band, where a real
 * village's scrub and copses crowd the field backs) that then thins
 * linearly to 0 at `rim`.
 *
 * Fix wave (2026-08-21, C2): `rim` used to be `builtRadius x
 * VEG_RADIUS_FACTOR`, which -- once fields were re-keyed off the MEASURED
 * fabric -- was always BELOW `innerEdge`, so this function collapsed to its
 * first line and the whole ramp was dead code: not one tree could land
 * beyond the field band. `rim` is now keyed off `innerEdge` itself.
 */
function densityAt(d: number, innerEdge: number, rim: number): number {
  if (d < innerEdge) return VEG_BASE_DENSITY * VEG_INFILL_SHARE;
  if (!(rim > innerEdge)) return 0;
  if (d > rim) return 0;
  const band = rim - innerEdge;
  const peakEnd = innerEdge + band * VEG_RAMP_PEAK_SHARE;
  if (d <= peakEnd) return VEG_BASE_DENSITY;
  const t = (d - peakEnd) / (rim - peakEnd);
  return VEG_BASE_DENSITY * Math.max(0, 1 - t);
}

function pickGlyph(biome: string, rng: SeededRandom): string {
  const entries = VEG_GLYPHS[biome] ?? VEG_GLYPHS.temperate;
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rng.float() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.glyph;
  }
  return entries[entries.length - 1].glyph;
}

/**
 * §7.3: the whole vegetation scatter for one village. Called LAST among
 * dressing stages (after edgeStyle/crofts/fields), so every rng draw here
 * comes after all of theirs -- never reordered or interleaved.
 *
 * `innerEdgeM` is the MEASURED fabric edge the density ramp starts at: the
 * field system's own outer radius when fields exist, or the measured fabric
 * radius (lot claims + crofts) when there are none. Never a prediction --
 * see the fix-wave rule: after pass 3 nothing keys off `predictedBuiltRadius`.
 * The scatter rim, and with it the grid's own extent, is
 * `innerEdgeM x VEG_RADIUS_FACTOR`, so the grid always reaches past the
 * fields it is supposed to thin out beyond.
 *
 * `shorefrontReachM` is §8.4's suppression reach, likewise measured
 * (fabric radius x SHOREFRONT_REACH_FACTOR), passed in rather than derived.
 */
export function buildVegetation(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldStrip[],
  innerEdgeM: number, shorefrontReachM: number, rng: SeededRandom,
): Vegetation[] {
  const rim = innerEdgeM * VEG_RADIUS_FACTOR;
  if (!(rim > 0)) return [];

  const halfCells = Math.max(0, Math.ceil(rim / VEG_CELL_M));
  const trees: Vegetation[] = [];

  for (let cellX = -halfCells; cellX <= halfCells; cellX++) {
    for (let cellY = -halfCells; cellY <= halfCells; cellY++) {
      const cellOrigin = new Point(
        green.centre.x + cellX * VEG_CELL_M,
        green.centre.y + cellY * VEG_CELL_M,
      );
      const cellCentre = new Point(
        cellOrigin.x + VEG_CELL_M / 2,
        cellOrigin.y + VEG_CELL_M / 2,
      );
      const density = densityAt(dist(cellCentre, green.centre), innerEdgeM, rim);

      const survives = rng.float() < density;
      if (!survives) continue;

      const offsetX = rng.float();
      const offsetY = rng.float();
      const position = new Point(
        cellOrigin.x + offsetX * VEG_CELL_M,
        cellOrigin.y + offsetY * VEG_CELL_M,
      );
      const glyph = pickGlyph(site.biome, rng);
      const scale = VEG_SCALE_MIN + rng.float() * (VEG_SCALE_MAX - VEG_SCALE_MIN);

      const id = `veg:${cellX}x${cellY}`;
      if (isRejected(position, green, lanes, lots, crofts, fields, site.water, shorefrontReachM)) {
        continue;
      }
      trees.push({
        id, glyph, position, scale,
      });

      const clumpCount = rng.int(0, 3);
      for (let j = 1; j <= clumpCount; j++) {
        // r is NOT scaled by sqrt(rng.float()), so this is NOT uniform in
        // the disc -- it is deliberately biased toward the parent, which is
        // what a "clustered neighbours" effect wants, and it keeps the
        // two-draw budget exact. theta uses the
        // bearingVector convention (0 = north, clockwise) purely for
        // consistency with the rest of the module; any orientation is
        // equally valid since the offset is isotropic.
        const r = rng.float() * CLUMP_RADIUS_M;
        const theta = rng.float() * 2 * Math.PI;
        const dx = r * Math.sin(theta);
        const dy = -r * Math.cos(theta);
        const neighbourPos = new Point(position.x + dx, position.y + dy);
        if (isRejected(neighbourPos, green, lanes, lots, crofts, fields, site.water, shorefrontReachM)) {
          continue;
        }
        trees.push({
          id: `${id}:${j}`, glyph, position: neighbourPos, scale,
        });
      }
    }
  }

  return trees;
}
