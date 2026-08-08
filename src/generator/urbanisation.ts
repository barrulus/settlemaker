import { Point } from '../types/point.js';

/** Population above which outlying hamlets appear along the road corridors. */
export const SATELLITE_POP_THRESHOLD = 50000;
/** Satellite bumps to emit per road, each weaker than the last. */
const SATELLITE_COUNT = 3;
/** Score multiplier per successive satellite. */
const SATELLITE_FALLOFF = 0.6;

export interface UrbanisationOptions {
  /** Unit direction vectors of approaching roads (`RoadEntry.point`). */
  roadDirections: Point[];
  /** Sprawl starts outside this radius — inside it is the core's business. */
  coreRadius: number;
  /** Distance at which continuous ribbon growth has decayed to nothing. */
  reach: number;
  /** Perpendicular distance at which a corridor has decayed to ~37%. */
  corridorHalfWidth: number;
  satellites: boolean;
  /** Gap between satellite bumps beyond `reach`. */
  satelliteSpacing: number;
}

export interface UrbanisationField {
  /** Built-ness at a point. 0 means "not a candidate for sprawl". */
  scoreAt(p: Point): number;
}

export function createUrbanisationField(opts: UrbanisationOptions): UrbanisationField {
  const { roadDirections, coreRadius, reach, corridorHalfWidth, satellites, satelliteSpacing } = opts;
  const span = Math.max(1, reach - coreRadius);

  function scoreAt(p: Point): number {
    let score = 0;

    for (const d of roadDirections) {
      const along = p.x * d.x + p.y * d.y;
      if (along <= coreRadius) continue;

      const perpX = p.x - along * d.x;
      const perpY = p.y - along * d.y;
      const perp = Math.sqrt(perpX * perpX + perpY * perpY);
      const lateral = Math.exp(-(perp * perp) / (corridorHalfWidth * corridorHalfWidth));

      // Continuous ribbon: linear decay from the core out to `reach`.
      if (along < reach) {
        score += lateral * (1 - (along - coreRadius) / span);
      }

      // Satellites: gaussian bumps further out on the SAME ray, so outlying
      // hamlets are on-road by construction.
      if (satellites) {
        for (let k = 1; k <= SATELLITE_COUNT; k++) {
          const centre = reach + k * satelliteSpacing;
          const t = (along - centre) / (satelliteSpacing * 0.5);
          score += lateral * Math.exp(-t * t) * Math.pow(SATELLITE_FALLOFF, k);
        }
      }
    }

    return score;
  }

  return { scoreAt };
}
