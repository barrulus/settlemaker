import { Point } from '../types/point.js';
import { Model } from '../generator/model.js';
import { Harbour } from '../wards/harbour.js';
import type { GenerationParams } from '../generator/generation-params.js';
import type { Site } from '../village/types.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { prepareWaterBoundary, waterBoundaryPaths, waterFillRings } from '../village/water-boundary.js';
import { belongingBanks } from './waterfront-placement.js';
import { coverageExceeded, WaterContextError } from '../input/water-context.js';
import type { GenerationTimingObserver } from '../generator/timing.js';
import { drySegments } from '../generator/city-frontage.js';
import { roadCorridor } from '../geom/road-corridor.js';

/** Reserve an inset working bank before generating the city's walls and roads.
 * This is only used for illustrative or explicitly inferred ocean shores. The
 * excavation is additive, leaving offshore islands and unrelated water intact. */
export function recessedHarbour(params: GenerationParams, site: Site, metresPerUnit: number,
  onStageTiming?: GenerationTimingObserver): Model | null {
  const probe = new Model({ ...params });
  const harbour = probe.probeHarbour()?.plan;
  const edge = harbour?.quays[0]?.edge;
  if (!edge || edge.length < 2) return null;
  const k = metresPerUnit, first = edge[0].scale(k), last = edge.at(-1)!.scale(k);
  const centre = first.add(last).scale(.5), tangent = last.subtract(first).norm();
  const normal = tangent.rotate90();
  const originalWater = waterFillRings(site.water)!;
  const wet = (p: Point) => originalWater.filter(r => pointInPolygon(p, r)).length % 2 === 1;
  if (!wet(centre.add(normal.scale(2)))) normal.scaleEq(-1);
  const at = (t: number, s: number) => centre.add(tangent.scale(t)).add(normal.scale(s));
  const local = (p: Point) => { const d = p.subtract(centre); return { t: d.dot(tangent), s: d.dot(normal) }; };
  const originalBanks = waterBoundaryPaths(site.water);
  const projected = originalBanks.flatMap(path => path.slice(1).map((b, i) => [local(path[i]), local(b)]));
  const shoreAt = (t: number): number | undefined => {
    const crossings = projected.flatMap(([a, b]) => {
      if (Math.abs(b.t - a.t) < 1e-8 || t < Math.min(a.t, b.t) || t > Math.max(a.t, b.t)) return [];
      const s = a.s + (b.s - a.s) * (t - a.t) / (b.t - a.t);
      return Math.abs(s) < 80 && !wet(at(t, s - .1)) && wet(at(t, s + .1)) ? [s] : [];
    });
    return crossings.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  };
  const initialWidth = Math.max(80, Math.min(140, Point.distance(first, last) + 30));
  // A changed water boundary creates a new mesh. If the first site becomes
  // too cramped after capacity expansion, try the adjoining coastal frontage.
  const shapes = [0, initialWidth, -initialWidth].flatMap(offset =>
    (offset === 0 ? [45, 55, 35] : [45, 55]).map(depth => ({ offset, depth })));
  for (const { offset, depth } of shapes) {
    const width = initialWidth;
    const half = width / 2, shoulder = 25, extent = half + shoulder;
    const back: Point[] = [], front: Point[] = [];
    const steps = Math.ceil(extent);
    for (let i = 0; i <= steps; i++) {
      const along = -extent + 2 * extent * i / steps, t = along + offset, s = shoreAt(t);
      if (s === undefined) break;
      const fraction = Math.abs(along) <= half ? 1
        : (1 + Math.cos(Math.PI * (Math.abs(along) - half) / shoulder)) / 2;
      const inland = at(t, s * (1 - fraction) - depth * fraction);
      const shore = at(t, s - .01);
      // Do not cut through a second channel or an intervening island.
      if (fraction > .01) {
        const length = Point.distance(inland, shore);
        const dry = drySegments(inland, shore, originalWater)
          .reduce((sum, [a, b]) => sum + Point.distance(a, b), 0);
        if (dry < length - 1e-5) break;
      }
      back.push(inland);
      front.push(at(t, s + 1));
    }
    if (back.length !== steps + 1) continue;
    const cut = [...back, ...front.reverse()];
    if (site.surveyRadiusM !== undefined) {
      const reach = Math.max(...cut.map(p => p.length));
      if (reach > site.surveyRadiusM) coverageExceeded(reach);
    }
    // Preserve the town centre and the existing dry side of the working bank.
    const workingBank = [at(offset - half + 2, -depth), at(offset + half - 2, -depth)];
    if (pointInPolygon(new Point(0, 0), cut) || workingBank.some(wet)) continue;
    const candidateWater = [...site.water, cut];
    prepareWaterBoundary(candidateWater, site.surveyRadiusM ?? Infinity);
    const banks = waterBoundaryPaths(candidateWater);
    const coastalBanks = belongingBanks(banks, [...site.shorelines ?? originalBanks, cut]);
    const candidate: GenerationParams = { ...params,
      coastlineGeometry: waterFillRings(candidateWater)!.map(r => r.map(p => p.scale(1 / k))),
      waterShorelines: banks.map(r => r.map(p => p.scale(1 / k))),
      harbourShorelines: [workingBank.map(p => p.scale(1 / k))],
      coastalShorelines: coastalBanks.map(r => r.map(p => p.scale(1 / k))),
    };
    const model = new Model(candidate);
    model.onStageTiming = onStageTiming;
    try { model.generate(); }
    catch (error) {
      if (error instanceof WaterContextError) throw error;
      continue;
    }
    const ward = model.harbour?.ward;
    // The trial is useful only if the final mesh retains a navigable basin.
    const accepted = ward instanceof Harbour ? ward.plan : null;
    if (!accepted?.basin.length || accepted.kind === 'landing') continue;
    // Accept only a basin actually behind the old coast, with its working
    // frontage on the reserved back bank, not a nearby unmodified shore.
    if (accepted.basin.some(p => wet(p.scale(k)))
      || accepted.quays[0].edge.some(p => Math.abs(local(p.scale(k)).s + depth) > 1)
      || !accepted.approach.length
      || (params.wallsNeeded && !model.wall)) continue;
    // A deeper inlet may extend beyond the usual offshore approach length.
    // Continue the same navigation corridor until it reaches original water.
    const start = accepted.approach[0], next = accepted.approach[1];
    const outward = start.subtract(next).norm();
    const trialWater = candidate.coastlineGeometry!;
    const trialWet = (p: Point) => trialWater.filter(r => pointInPolygon(p, r)).length % 2 === 1;
    let entrance = start, connected = wet(start.scale(k));
    for (let extra = 5; !connected && extra <= 60; extra += 5) {
      const end = start.add(outward.scale(extra / k));
      const corridor = roadCorridor(start, end, accepted.navigationWidth);
      if (!corridor.vertices.every(trialWet)
        || corridor.vertices.some((p, i) => drySegments(p, corridor.vertices[(i + 1) % 4], trialWater).length)
        || candidate.waterShorelines!.some(path => path.some(p => pointInPolygon(p, corridor.vertices)))) break;
      entrance = end;
      connected = wet(end.scale(k));
    }
    if (!connected) continue;
    accepted.approach[0] = entrance;
    site.water = candidateWater;
    site.shorelines = coastalBanks;
    if (site.waterContextResult) {
      site.waterContextResult.status = 'approximate';
      site.waterContextResult.issues.push({ code: 'water-harbour-recessed' });
    }
    return model;
  }
  return null;
}
