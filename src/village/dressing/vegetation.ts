import { selectFlora, floraKinds, ARTWORK_MANIFEST, ARTWORK_INK } from '../../assets/artwork.js';
import { waterBoundarySegments } from '../water-boundary.js';
import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { closestPointOnSegment, dist } from '../geometry.js';
import {
  CLUMP_RADIUS_M, VEG_BAND_DEPTH_M, VEG_CELL_M, VEG_CLUMP_INTERIOR,
  VEG_INTERIOR_DENSITY, VEG_SCALE_MAX, VEG_SCALE_MIN,
} from '../constants.js';
import { floraClearance } from './flora-clearance.js';
import type { RadialExtent } from './extent.js';
import type { Croft, FieldBlock, Green, Lane, Lot, Site, Vegetation } from '../types.js';

function interiorDensityAt(d: number, groveEdge: number): number {
  return d < groveEdge ? VEG_INTERIOR_DENSITY : 0;
}

function plantRadius(glyph: string, scale: number): number {
  const fp = ARTWORK_MANIFEST[glyph]?.footprint?.[0] ?? 1;
  const b = ARTWORK_INK[glyph]?.bounds ?? [8, 8, 56, 56];
  return Math.max(32-b[0], 32-b[1], b[2]-32, b[3]-32) * fp/64 * scale;
}

/** Smooth, seeded canopy cover: adjacent cells share woodland or clearing,
 * rather than each tree making an independent scatter decision. */
function woodlandNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const hash = (a: number, b: number): number => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const u = smooth(x - ix), v = smooth(y - iy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v)
    + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}

/** Groves within the fabric, connected woodland across unused field ground,
 * then a thinning fringe beyond the measured farmland boundary. Occupied
 * geometry, not a radial exclusion band, determines where trees can grow. */
export function buildVegetation(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldBlock[],
  groveEdge: RadialExtent, innerEdge: RadialExtent, shorefrontReachM: number, rng: SeededRandom,
  reservations: Point[][] = [],
): Vegetation[] {
  const rimExtent = innerEdge.plus(VEG_BAND_DEPTH_M);
  const rimMaxM = rimExtent.maxM;
  if (!(rimMaxM > 0)) return [];
  const maxRadius = Math.max(...floraKinds(site.biome, true).map(id => plantRadius(id, VEG_SCALE_MAX)));
  const rejected = floraClearance(green, lanes, lots, crofts, fields, site.water, shorefrontReachM, reservations, maxRadius);
  const banks = waterBoundarySegments(site.water);
  const pickGlyph = (p: Point): string => selectFlora(site.biome, rng.float(),
    banks.some(([a,b]) => dist(p, closestPointOnSegment(p,a,b)) < 15));
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
      const glyph = pickGlyph(position);
      const scale = VEG_SCALE_MIN + rng.float() * (VEG_SCALE_MAX - VEG_SCALE_MIN);

      const id = `veg:${cellX}x${cellY}`;
      if (rejected(position, plantRadius(glyph, scale))) {
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
        if (rejected(neighbourPos, plantRadius(glyph, scale))) {
          continue;
        }
        trees.push({
          id: `${id}:${j}`, glyph, position: neighbourPos, scale,
        });
      }
    }
  }

  // Close stems make overlapping crowns; broad correlated cover leaves
  // organic clearings. Arid and exposed biomes retain more open ground.
  const spacing = site.biome === 'desert' ? 6 : site.biome === 'tundra' ? 4.8 : 3.8;
  const threshold = site.biome === 'desert' ? .64 : site.biome === 'coastal' ? .56
    : site.biome === 'tundra' ? .46 : site.biome === 'tropical' ? .30 : .36;
  const seed = Math.floor(rng.float() * 4294967296);
  const half = Math.ceil(rimMaxM / spacing);
  for (let x = -half; x <= half; x++) for (let y = -half; y <= half; y++) {
    const position = new Point(green.centre.x + (x + .15 + rng.float() * .7) * spacing,
      green.centre.y + (y + .15 + rng.float() * .7) * spacing);
    const d = dist(position, green.centre);
    // The existing interior pass already supplies domestic trees and groves.
    if (d < groveEdge.at(position) || d > rimExtent.at(position)) continue;
    const fringe = Math.max(0, (d - innerEdge.at(position)) / VEG_BAND_DEPTH_M);
    const cover = .75 * woodlandNoise(position.x / 48, position.y / 48, seed)
      + .25 * woodlandNoise(position.x / 19, position.y / 19, seed ^ 0x5bd1e995);
    if (cover < threshold + fringe * .48 || rejected(position)) continue;
    const glyph = pickGlyph(position);
    const scale = VEG_SCALE_MIN + rng.float() * (VEG_SCALE_MAX - VEG_SCALE_MIN);
    if (rejected(position, plantRadius(glyph, scale))) continue;
    trees.push({ id: `wood:${x}x${y}:0`, position, glyph, scale });
  }
  return trees;
}
