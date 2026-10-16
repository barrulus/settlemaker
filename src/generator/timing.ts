/** Observations are delivered out of band: they never enter a deterministic model. */
export interface GenerationStageTiming { stage: string; durationMs: number; attempt?: number }
export type GenerationTimingObserver = (timing: GenerationStageTiming) => void;

export function timeGenerationStage<T>(stage: string, observer: GenerationTimingObserver | undefined, work: () => T, attempt?: number): T {
  if (!observer) return work();
  const started = performance.now();
  try { return work(); }
  finally { observer({ stage, durationMs: performance.now() - started, ...(attempt === undefined ? {} : { attempt }) }); }
}
