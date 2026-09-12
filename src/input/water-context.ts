import type { AzgaarBurgInput } from './azgaar-input.js';

export type WaterContextV1 = {
  version: 1; status: 'measured'; coordinateSpace: 'burg-local-metres';
  surveyRadiusM: number; geometryErrorM: number;
  omittedRivers?: Array<{ riverId?: string; reason: 'local-width-unavailable' }>;
  bodies: Array<{
    featureId?: string; kind: 'ocean' | 'lake'; distanceM: number; bearingDeg: number;
    polygonIndices?: number[]; coastApproximation?: 'simple-local-coast';
  }>;
} | { version: 1; status: 'unknown-units'; sourceUnit: string };
export type WaterIssueCode = 'water-coverage-exceeded' | 'water-geometry-required'
  | 'water-context-conflict' | 'water-units-unknown' | 'water-context-unsupported-engine'
  | 'water-context-invalid' | 'water-river-local-width-unavailable';
export interface WaterContextResult {
  version: 1;
  status: 'measured' | 'approximate' | 'unknown-units' | 'error';
  issues: Array<{ code: WaterIssueCode; requiredSurveyRadiusM?: number }>;
}
export class WaterContextError extends Error {
  readonly waterContextResult: WaterContextResult;
  constructor(code: WaterIssueCode, detail: string, requiredSurveyRadiusM?: number) {
    super(`${code}: ${detail}`);
    this.name = 'WaterContextError';
    this.waterContextResult = { version: 1, status: 'error', issues: [{ code,
      ...(requiredSurveyRadiusM !== undefined ? { requiredSurveyRadiusM } : {}) }] };
  }
}
export function coverageExceeded(radius: number): never {
  const required = Math.ceil(radius / 1000) * 1000;
  throw new WaterContextError('water-coverage-exceeded',
    `Water survey is too small. A survey radius of at least ${required} metres is required.`, required);
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const point = (x: unknown): boolean => record(x) && finite(x.x) && finite(x.y);
function invalid(why: string): never { throw new WaterContextError('water-context-invalid', why); }

/** Validate at both the URL and direct-library boundaries. Never downgrade a new context to legacy. */
export function validateWaterContext(input: AzgaarBurgInput): void {
  if (!Object.hasOwn(input, 'waterContext')) return;
  const c: unknown = input.waterContext;
  if (!record(c) || c.version !== 1) invalid('Unsupported or malformed waterContext version.');
  if (!finite(input.population) || input.population < 1) invalid('Measured water requires a positive population.');
  if (input.population > 1000) throw new WaterContextError('water-context-unsupported-engine',
    'Measured water is supported for villages of 1–1000 people only.');
  if (c.status === 'unknown-units') {
    if (typeof c.sourceUnit !== 'string' || !c.sourceUnit.trim()) invalid('Unknown units require a sourceUnit label.');
    if (Object.hasOwn(input, 'coastlineGeometry') || Object.hasOwn(input, 'rivers')) invalid('Unknown units cannot include metric water geometry.');
    return;
  }
  if (c.status !== 'measured' || c.coordinateSpace !== 'burg-local-metres') invalid('Unsupported water status or coordinate space.');
  if (!finite(c.surveyRadiusM) || c.surveyRadiusM < 3000) invalid('surveyRadiusM must be at least 3000 metres.');
  if (!finite(c.geometryErrorM) || c.geometryErrorM < 0 || c.geometryErrorM > .5) invalid('geometryErrorM must be between 0 and 0.5 metres.');
  if (!Array.isArray(c.bodies)) invalid('bodies must be an array.');
  const polygons: unknown = input.coastlineGeometry;
  if (Object.hasOwn(input, 'coastlineGeometry')) {
    if (!Array.isArray(polygons)) invalid('coastlineGeometry must be an array.');
    for (const ring of polygons) {
      if (!Array.isArray(ring) || ring.length < 3 || !ring.every(point)) invalid('Water polygons require at least three finite points.');
      const area = ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].y - p.y * ring[(i + 1) % ring.length].x, 0);
      if (Math.abs(area) < 1e-8) invalid('Water polygons must have nonzero area.');
    }
  }
  const used = new Set<number>();
  for (const b of c.bodies) {
    if (!record(b) || !['ocean', 'lake'].includes(String(b.kind)) || !finite(b.distanceM) || b.distanceM < 0
      || !finite(b.bearingDeg) || b.bearingDeg < 0 || b.bearingDeg >= 360) invalid('Invalid water body summary.');
    if (b.featureId !== undefined && typeof b.featureId !== 'string') invalid('featureId must be a string.');
    if (b.coastApproximation !== undefined && (b.kind !== 'ocean' || b.coastApproximation !== 'simple-local-coast')) invalid('Invalid simple-coast declaration.');
    if (b.polygonIndices !== undefined) {
      if (!Array.isArray(b.polygonIndices)) invalid('polygonIndices must be an array.');
      for (const i of b.polygonIndices) {
        if (!Number.isInteger(i) || i < 0 || !Array.isArray(polygons) || i >= polygons.length || used.has(i)) invalid('Invalid or repeated polygon association.');
        used.add(i);
      }
    }
  }
  if (c.omittedRivers !== undefined && (!Array.isArray(c.omittedRivers) || !c.omittedRivers.every(r =>
    record(r) && r.reason === 'local-width-unavailable' && (r.riverId === undefined || typeof r.riverId === 'string')))) invalid('Invalid omittedRivers.');
  if (Object.hasOwn(input, 'rivers')) {
    if (!Array.isArray(input.rivers) || !input.rivers.every(r => record(r) && finite(r.widthM) && r.widthM > 0
      && Array.isArray(r.centreline) && r.centreline.length >= 2 && r.centreline.every(point)
      && (r.meander === undefined || typeof r.meander === 'boolean'))) invalid('Invalid local river survey.');
  }
}
