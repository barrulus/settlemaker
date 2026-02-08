import { Point } from '../types/point.js';
import type { GenerationParams } from '../generator/generation-params.js';

/**
 * Input data from Azgaar's Fantasy Map Generator (maps_burgs table).
 */
export interface AzgaarBurgInput {
  name: string;
  population: number;
  port: boolean;
  citadel: boolean;
  walls: boolean;
  plaza: boolean;
  temple: boolean;
  shanty: boolean;
  capital: boolean;
  culture?: string;
  elevation?: number;
  temperature?: number;
  /** Compass bearings (degrees, 0=N clockwise) of roads approaching the burg */
  roadBearings?: number[];
  /** Compass bearing (degrees, 0=N clockwise) to nearest ocean — enables coastline clipping for port cities */
  oceanBearing?: number;
  /** Harbour size for port cities — 'large' for major sea routes + big pop, 'small' otherwise */
  harbourSize?: 'large' | 'small';
}

/**
 * Map Azgaar population to nPatches count.
 *
 * <100 (hamlet)      → 3-4 patches
 * 100-1000 (village) → 5-9
 * 1000-5000 (town)   → 10-14
 * 5000-20k (city)    → 15-24
 * 20k-100k (large)   → 25-40
 * 100k+ (metropolis)  → 40-50
 */
function populationToPatches(population: number): number {
  if (population < 100) return 3 + Math.round((population / 100) * 1);
  if (population < 1000) return 5 + Math.round(((population - 100) / 900) * 4);
  if (population < 5000) return 10 + Math.round(((population - 1000) / 4000) * 4);
  if (population < 20000) return 15 + Math.round(((population - 5000) / 15000) * 9);
  if (population < 100000) return 25 + Math.round(((population - 20000) / 80000) * 15);
  return 40 + Math.min(10, Math.round(((population - 100000) / 200000) * 10));
}

/** Max border gates based on settlement size. */
function populationToMaxGates(population: number): number {
  if (population < 1000) return 2;
  if (population < 5000) return 3;
  if (population < 20000) return 4;
  if (population < 100000) return 5;
  return 6;
}

/**
 * Convert Azgaar burg data into generation parameters.
 * Uses a hash of the burg name as the random seed for deterministic output.
 */
export function mapToGenerationParams(
  burg: AzgaarBurgInput,
  seedOverride?: number,
): GenerationParams {
  const seed = seedOverride ?? hashString(burg.name);

  const roadEntryPoints = burg.roadBearings?.map(bearing => {
    const rad = bearing * Math.PI / 180;
    return new Point(Math.sin(rad), -Math.cos(rad));
  });

  return {
    nPatches: populationToPatches(burg.population),
    plazaNeeded: burg.plaza,
    citadelNeeded: burg.citadel,
    wallsNeeded: burg.walls,
    templeNeeded: burg.temple,
    shantyNeeded: burg.shanty,
    capitalNeeded: burg.capital,
    seed,
    ...(roadEntryPoints && roadEntryPoints.length > 0 ? { roadEntryPoints } : {}),
    maxGates: populationToMaxGates(burg.population),
    ...(burg.oceanBearing != null ? { oceanBearing: burg.oceanBearing } : {}),
    ...(burg.harbourSize != null ? { harbourSize: burg.harbourSize } : {}),
  };
}

/** Simple string hash (djb2) for deterministic seeding */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) & 0x7fffffff;
  }
  return hash || 1; // avoid zero seed
}
