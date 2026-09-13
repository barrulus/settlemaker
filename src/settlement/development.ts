/** Population is demand; development controls how that demand occupies land. */
export interface DevelopmentOptions {
  preset: 'village' | 'city';
  /** Residents to accommodate inside the main wall; requires walls: true. */
  corePopulation?: number;
  /** Capacity of an ordinary dense residential building. Default 8. */
  centreOccupancy?: number;
  /** Capacity of a detached dwelling at the rural edge. Default 4. */
  edgeOccupancy?: number;
}

export interface DevelopmentProfile {
  preset: 'village' | 'city';
  corePopulation: number | null;
  centreOccupancy: number;
  edgeOccupancy: number;
}

export function resolveDevelopment(population: number, walls: boolean, input: DevelopmentOptions): DevelopmentProfile {
  if (!Number.isSafeInteger(population) || population < 1) throw new RangeError('population must be a positive safe integer');
  if (!input || !['village', 'city'].includes(input.preset)) throw new RangeError('development.preset must be village or city');
  const edgeOccupancy = input.edgeOccupancy ?? 4;
  const centreOccupancy = input.centreOccupancy ?? (input.preset === 'city' ? Math.max(8, edgeOccupancy) : edgeOccupancy);
  for (const [name, value] of Object.entries({ centreOccupancy, edgeOccupancy })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  }
  if (centreOccupancy < edgeOccupancy) throw new RangeError('centreOccupancy must be at least edgeOccupancy');
  if (input.preset === 'village' && centreOccupancy !== edgeOccupancy) throw new RangeError('village development uses edgeOccupancy throughout; use the city preset for a capacity gradient');
  const corePopulation = input.corePopulation ?? (walls && input.preset === 'city' ? Math.min(10000, Math.ceil(population * .8)) : null);
  if (corePopulation !== null && (!walls || !Number.isSafeInteger(corePopulation) || corePopulation < 0 || corePopulation > population)) {
    throw new RangeError('corePopulation requires walls and must be an integer between zero and population');
  }
  return { preset: input.preset, centreOccupancy, edgeOccupancy, corePopulation };
}

/** Capacity is fixed before residents are assigned; a shortage never raises it. */
export function residentialCapacity(profile: DevelopmentProfile, urbanity: number): number {
  return Math.round(profile.edgeOccupancy + (profile.centreOccupancy - profile.edgeOccupancy) * Math.max(0, Math.min(1, urbanity)));
}
