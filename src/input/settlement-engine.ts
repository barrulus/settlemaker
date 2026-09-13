/** Planner selection is independent of population when explicitly requested. */
export const SETTLEMENT_ENGINES = ['auto', 'village', 'city'] as const;
export type SettlementEngine = typeof SETTLEMENT_ENGINES[number];

/** Inclusive population boundary used only by automatic selection. */
export const VILLAGE_POP_CEILING = 1000;

export function resolveSettlementEngine(population: number, engine: SettlementEngine = 'auto'): 'village' | 'city' {
  if (!(SETTLEMENT_ENGINES as readonly unknown[]).includes(engine)) {
    throw new RangeError(`Unknown settlement engine "${String(engine)}"; expected auto, village or city.`);
  }
  return engine === 'auto' ? (population <= VILLAGE_POP_CEILING ? 'village' : 'city') : engine;
}
