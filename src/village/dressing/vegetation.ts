import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  closestPointOnSegment, dist, greenDrawnRadius, inAnyWater, withinLaneCorridor,
} from '../geometry.js';
import { lotObb, pointInObb } from '../parcels/overlap.js';
import {
  CLUMP_RADIUS_M, SHOREFRONT_BAND_M, VEG_BAND_DEPTH_M, VEG_CELL_M,
  VEG_CLUMP_INTERIOR, VEG_GLYPHS, VEG_INTERIOR_DENSITY, VEG_LANE_CLEAR_M,
  VEG_PATCH_CELL_M, VEG_PATCH_CHANCE, VEG_PATCH_RADIUS_M, VEG_PATCH_TREES,
  VEG_SCALE_MAX, VEG_SCALE_MIN,
} from '../constants.js';
import type { RadialExtent } from './extent.js';
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
 * Survival chance for an INTERIOR cell. Gate 5.3 reduced this to one zone:
 * everything inside `groveEdge` (the measured fabric radius) is grove
 * country at VEG_INTERIOR_DENSITY, and everything outside it is no longer
 * a per-cell dice roll at all -- it is woodland patches, seeded on their
 * own coarse grid by `seedWoodlandPatches`.
 *
 * The rejection tests (lanes, lot claims, croft claims, field blocks, the
 * green, water) are what confine this to genuinely open ground, so a high
 * number here fills the gaps between the houses rather than burying them.
 */
function interiorDensityAt(d: number, groveEdge: number): number {
  return d < groveEdge ? VEG_INTERIOR_DENSITY : 0;
}

/**
 * Gate 5.3: how likely a patch cell is to seed a wood at distance `d` --
 * VEG_PATCH_CHANCE at the fabric edge, thinning linearly to nothing at the
 * rim, so the country opens out rather than ending in a wall of trees.
 */
function patchChanceAt(d: number, groveEdge: number, rim: number): number {
  if (d < groveEdge || d > rim || !(rim > groveEdge)) return 0;
  return VEG_PATCH_CHANCE * Math.max(0, 1 - (d - groveEdge) / (rim - groveEdge));
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
 * `groveEdge` is the MEASURED built-up edge, per bearing -- where the
 * houses stop and grove country ends. `innerEdge` is the field ring's own
 * outer edge, likewise per bearing (the built-up edge where a bearing has
 * no fields at all): beyond it the scatter thins to the rim. Both measured, never predicted --
 * see the fix-wave rule: after pass 3 nothing keys off `predictedBuiltRadius`.
 * The scatter rim, and with it the grid's own extent, is
 * `innerEdge + VEG_BAND_DEPTH_M` at every bearing, so the grid always reaches past the
 * fields it is supposed to thin out beyond -- by a fixed depth, so the
 * scatter (and with it the renderer's bounds, which include every tree)
 * cannot outgrow the village it surrounds (W1).
 *
 * `shorefrontReachM` is §8.4's suppression reach, likewise measured
 * (fabric radius x SHOREFRONT_REACH_FACTOR), passed in rather than derived.
 */
export function buildVegetation(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldBlock[],
  groveEdge: RadialExtent, innerEdge: RadialExtent, shorefrontReachM: number, rng: SeededRandom,
): Vegetation[] {
  // GATE 8: both edges are PER BEARING. They used to be two scalars, and a
  // fixed band beyond a scalar is a circle: an irregular village ringed by
  // a perfectly round tree line reads worse than a round one, because the
  // circle is right there to compare the blob against.
  const rimExtent = innerEdge.plus(VEG_BAND_DEPTH_M);
  const rimMaxM = rimExtent.maxM;
  if (!(rimMaxM > 0)) return [];

  const trees: Vegetation[] = [];

  // --- Pass 1: grove country, inside the fabric. One rng.float decides
  // every cell's survival, so the draw count never depends on how many
  // trees land. The grid only spans the interior now: outside it, pass 2
  // does the placing.
  const halfCells = Math.max(0, Math.ceil(groveEdge.maxM / VEG_CELL_M));
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
      const density = interiorDensityAt(
        dist(cellCentre, green.centre), groveEdge.at(cellCentre),
      );

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

      // Clumps are what make a GROVE rather than a lone tree.
      const [clumpMin, clumpMaxExcl] = VEG_CLUMP_INTERIOR;
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

  // --- Pass 2: WOODLAND MASSES, outside the fabric. Gate 5.3 replaced the
  // old per-cell scatter out here, which read as lonely specks, with woods:
  // a coarse grid of patch seeds, each becoming one overlapping mass of
  // 8-20 trees. VEG_PATCH_CELL_M is comfortably more than twice
  // VEG_PATCH_RADIUS_M, so neighbouring woods keep open ground between
  // them instead of merging into a continuous belt.
  //
  // DRAW ORDER: this pass runs entirely AFTER pass 1, and walks its own
  // grid in the same sorted (cellX, then cellY) order. Per patch cell:
  // one survival float ALWAYS; then, only if it survived, two centre
  // offsets, one rng.int tree count, and per tree two offsets plus a glyph
  // and a scale float. A tree rejected by the geometry tests discards the
  // tree, never the draws already spent on it -- the same rule pass 1 uses.
  const patchHalf = Math.max(0, Math.ceil(rimMaxM / VEG_PATCH_CELL_M));
  for (let cellX = -patchHalf; cellX <= patchHalf; cellX++) {
    for (let cellY = -patchHalf; cellY <= patchHalf; cellY++) {
      const cellOrigin = new Point(
        green.centre.x + cellX * VEG_PATCH_CELL_M,
        green.centre.y + cellY * VEG_PATCH_CELL_M,
      );
      const cellCentre = new Point(
        cellOrigin.x + VEG_PATCH_CELL_M / 2,
        cellOrigin.y + VEG_PATCH_CELL_M / 2,
      );
      const chance = patchChanceAt(
        dist(cellCentre, green.centre), groveEdge.at(cellCentre), rimExtent.at(cellCentre),
      );
      if (!(rng.float() < chance)) continue;

      const seed = new Point(
        cellOrigin.x + rng.float() * VEG_PATCH_CELL_M,
        cellOrigin.y + rng.float() * VEG_PATCH_CELL_M,
      );
      const [treeMin, treeMaxExcl] = VEG_PATCH_TREES;
      const count = rng.int(treeMin, treeMaxExcl);
      const patchId = `wood:${cellX}x${cellY}`;
      for (let j = 0; j < count; j++) {
        // Same deliberate bias toward the centre pass 1's clumps use: r is
        // NOT sqrt-scaled, so trees crowd the middle of the wood and thin
        // at its edge, which is what makes a canopy mass rather than a ring.
        const r = rng.float() * VEG_PATCH_RADIUS_M;
        const theta = rng.float() * 2 * Math.PI;
        const position = new Point(
          seed.x + r * Math.sin(theta),
          seed.y - r * Math.cos(theta),
        );
        const glyph = pickGlyph(site.biome, rng);
        const scale = VEG_SCALE_MIN + rng.float() * (VEG_SCALE_MAX - VEG_SCALE_MIN);
        // Every rejection still applies out here -- a wood may abut a field
        // block but never stands on one, nor on a lane, claim or water.
        if (isRejected(position, green, lanes, lots, crofts, fields, site.water, shorefrontReachM)) {
          continue;
        }
        trees.push({
          id: `${patchId}:${j}`, glyph, position, scale,
        });
      }
    }
  }

  return trees;
}
