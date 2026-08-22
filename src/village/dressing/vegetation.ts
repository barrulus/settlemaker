import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  closestPointOnSegment, dist, greenDrawnRadius, inAnyWater, withinLaneCorridor,
} from '../geometry.js';
import { lotObb, pointInObb } from '../parcels/overlap.js';
import {
  CLUMP_RADIUS_M, SHOREFRONT_BAND_M, VEG_BAND_DEPTH_M, VEG_CELL_M,
  VEG_CLUMP_INTERIOR, VEG_CLUMP_OUTER, VEG_GLYPHS,
  VEG_INTERIOR_DENSITY, VEG_LANE_CLEAR_M, VEG_OUTER_DENSITY,
  VEG_SCALE_MAX, VEG_SCALE_MIN,
} from '../constants.js';
import type {
  Croft, FieldBlock, Green, Lane, Lot, Site, Vegetation,
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
  p: Point, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldBlock[],
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
 * Density(d), in the three zones the owner's reference map actually has:
 *
 *  1. `d < groveEdge` -- INSIDE the fabric, among the houses:
 *     VEG_INTERIOR_DENSITY. Grove country. The rejection tests above
 *     (lanes, lot claims, croft claims, field blocks, the green, water) are
 *     what confine this to genuinely open ground, so a high number here
 *     fills the gaps between the houses rather than burying them.
 *  2. `groveEdge <= d < innerEdge` -- the OPEN GREEN BELT between the last
 *     houses and the field ring: VEG_OUTER_DENSITY, flat. It is common, and
 *     common is open; a few trees, not a wood.
 *  3. `innerEdge <= d <= rim` -- the ring and the country beyond: the same
 *     low level, thinning linearly to nothing at the rim. Specks.
 *
 * Gate 5 (2026-08-22) both flipped the emphasis and split zone 1 from
 * zone 2. The old profile put a thin infill inside and a full-strength
 * plateau outside -- a sparse village inside a forest fringe, the exact
 * reverse of the reference. Keying "interior" to the FIELD radius rather
 * than the fabric was the second half of the mistake: on a hamlet the field
 * ring stands well clear of the houses, so grove density was being applied
 * to a wide belt of empty ground and a 14-building hamlet grew ~700 trees.
 */
function densityAt(d: number, groveEdge: number, innerEdge: number, rim: number): number {
  if (d < groveEdge) return VEG_INTERIOR_DENSITY;
  if (d < innerEdge) return VEG_OUTER_DENSITY;
  if (!(rim > innerEdge)) return 0;
  if (d > rim) return 0;
  const t = (d - innerEdge) / (rim - innerEdge);
  return VEG_OUTER_DENSITY * Math.max(0, 1 - t);
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
 * `groveEdgeM` is the MEASURED fabric radius -- where the houses stop and
 * grove country ends. `innerEdgeM` is the field ring's own outer radius
 * (or the fabric radius when there are no fields at all): beyond it the
 * scatter thins to the rim. Both measured, never predicted --
 * see the fix-wave rule: after pass 3 nothing keys off `predictedBuiltRadius`.
 * The scatter rim, and with it the grid's own extent, is
 * `innerEdgeM + VEG_BAND_DEPTH_M`, so the grid always reaches past the
 * fields it is supposed to thin out beyond -- by a fixed depth, so the
 * scatter (and with it the renderer's bounds, which include every tree)
 * cannot outgrow the village it surrounds (W1).
 *
 * `shorefrontReachM` is §8.4's suppression reach, likewise measured
 * (fabric radius x SHOREFRONT_REACH_FACTOR), passed in rather than derived.
 */
export function buildVegetation(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldBlock[],
  groveEdgeM: number, innerEdgeM: number, shorefrontReachM: number, rng: SeededRandom,
): Vegetation[] {
  const rim = innerEdgeM + VEG_BAND_DEPTH_M;
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
      const density = densityAt(dist(cellCentre, green.centre), groveEdgeM, innerEdgeM, rim);

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

      // Interior clumps are bigger -- that is what makes a GROVE rather
      // than a lone tree. Exactly one rng.int is drawn either way, so the
      // draw budget never depends on which side of the edge this landed.
      const [clumpMin, clumpMaxExcl] = dist(position, green.centre) < groveEdgeM
        ? VEG_CLUMP_INTERIOR
        : VEG_CLUMP_OUTER;
      const clumpCount = rng.int(clumpMin, clumpMaxExcl);
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
