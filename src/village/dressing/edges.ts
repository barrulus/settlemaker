import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { nominalFootprint } from '../glyphs.js';
import { arcLengths, sampleAt, withinLaneCorridor } from '../geometry.js';
import {
  EDGE_LANE_CLEAR_M, EDGE_NONE_POP_THRESHOLD, EDGE_NONE_POOR_BONUS,
  EDGE_STYLE_ORDER, EDGE_STYLE_WEIGHTS,
} from '../constants.js';
import type { EdgeStyle, EdgeStamp, Lane } from '../types.js';

/**
 * §7.1: the boundary asset choice is by biome (and culture) and held
 * CONSTANT across the whole settlement. Glyph per style — the `sm-edge-*`
 * family, all footprint [8, 2] m, cls "pattern", zBand "parcel".
 */
const EDGE_GLYPHS: Record<Exclude<EdgeStyle, 'none'>, string> = {
  hedge: 'sm-edge-hedge',
  wall: 'sm-edge-wall',
  fence: 'sm-edge-fence',
  ditch: 'sm-edge-ditch',
};

/**
 * One draw per village. Weights come from `EDGE_STYLE_WEIGHTS`, keyed by
 * biome with a `temperate` fallback for biomes the table doesn't name
 * (tropical/coastal read the same as temperate per the brief). Below
 * `EDGE_NONE_POP_THRESHOLD`, `none` gains `EDGE_NONE_POOR_BONUS` and the
 * table renormalises — no extra rng draw for that adjustment, only the
 * one weighted pick below.
 */
export function settlementEdgeStyle(
  biome: string, population: number, rng: SeededRandom,
): EdgeStyle {
  const base = EDGE_STYLE_WEIGHTS[biome] ?? EDGE_STYLE_WEIGHTS.temperate;
  const weights: Record<string, number> = { ...base };
  if (population < EDGE_NONE_POP_THRESHOLD) {
    weights.none = (weights.none ?? 0) + EDGE_NONE_POOR_BONUS;
  }
  const total = EDGE_STYLE_ORDER.reduce((s, k) => s + (weights[k] ?? 0), 0);
  if (total <= 0) return 'none';

  let roll = rng.float() * total;
  for (const style of EDGE_STYLE_ORDER) {
    roll -= weights[style] ?? 0;
    if (roll <= 0) return style as EdgeStyle;
  }
  return EDGE_STYLE_ORDER[EDGE_STYLE_ORDER.length - 1] as EdgeStyle;
}

/** Whether `p` falls inside any lane's corridor (its half-width plus the
 * fixed clearance) — the "no stamp across a lane" rule. */
function withinAnyLaneCorridor(p: Point, lanes: Lane[]): boolean {
  return lanes.some((lane) => withinLaneCorridor(p, lane, EDGE_LANE_CLEAR_M));
}

/**
 * Walks `polyline` by arc length, centring one `sm-edge-*` stamp per
 * glyph footprint length (nominally 8 m — read from the manifest, not a
 * literal) starting at half that length in. A stamp whose centre falls
 * within a lane's corridor is skipped, which naturally breaks the edge at
 * gates and lane mouths. `stampEdge` draws no rng itself: `style` was
 * already chosen once, deterministically, by `settlementEdgeStyle`.
 *
 * `i` in each stamp's id (`edge:<ownerId>:<i>`) is the ordinal of its
 * position along the walk — including positions skipped for lane
 * clearance, which is why emitted ids may skip numbers at a break.
 */
export function stampEdge(
  ownerId: string, polyline: Point[], style: EdgeStyle, lanes: Lane[],
): EdgeStamp[] {
  if (style === 'none' || polyline.length < 2) return [];

  const glyph = EDGE_GLYPHS[style];
  const step = nominalFootprint(glyph)[0];
  if (step <= 0) return [];

  const acc = arcLengths(polyline);
  const total = acc[acc.length - 1];
  if (total <= 0) return [];

  const stamps: EdgeStamp[] = [];
  let i = 0;
  for (let s = step / 2; s < total; s += step, i++) {
    const { p, dirDeg } = sampleAt(polyline, acc, s);
    if (withinAnyLaneCorridor(p, lanes)) continue;
    stamps.push({ id: `edge:${ownerId}:${i}`, glyph, position: p, bearingDeg: dirDeg });
  }
  return stamps;
}
