import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { drySegments, nearestOnSegment, overlapsWater, type CityFrontage } from './city-frontage.js';
import type { WardLane } from '../wards/ward.js';
import { intersectLines } from '../geom/geom-utils.js';
import { convexHull } from '../village/dressing/parcel-cut.js';
import polygonClipping from 'polygon-clipping';
import { reserveCityCompound, retainUsefulCompoundNeighbours, retainConnectedCompoundLanes, type CityCompound, type CityCompoundFamily } from './city-compounds.js';

/** Convex clipping by nx*x + ny*y <= limit. Shared vertices stay in mesh units. */
export function clipBlock(poly: Polygon, nx: number, ny: number, limit: number): Polygon {
  const out: Point[] = [];
  poly.forEdge((a, b) => {
    const da = nx * a.x + ny * a.y - limit, db = nx * b.x + ny * b.y - limit;
    if (da <= 1e-9) out.push(a);
    if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
      const t = da / (da - db);
      out.push(new Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)));
    }
  });
  return new Polygon(out);
}

export interface CityBlockPlan {
  buildings: Polygon[];
  lanes: WardLane[];
  frontages: Map<Polygon, CityFrontage>;
  /** Buildings are ordered by street run, so quota trimming removes run ends. */
  runs: Polygon[][];
  /** Concave boundary cutouts that must also survive quota coalescing. */
  exclusions?: Point[][];
  /** Unbuilt strips beside detached plots or behind narrow terraces, reserved as private gardens. */
  gardens?: Polygon[];
  compounds?: CityCompound[];
}

export interface CityBlockSpacing {
  /** Gap relative to an ordinary house frontage; changes spacing, never roof scale. */
  gapRatio: number;
  /** Attached pairs/short runs share frontage, with larger yards between groups. */
  groupSize?: number;
}

/** Meet a smaller quota by joining neighbours on the same street, preserving
 * their occupied area. Never span a missing lot, courtyard or service lane. */
export function coalesceCityRuns(plan: CityBlockPlan, target: number): void {
  let count = plan.buildings.length;
  while (count > target) {
    let best: { run: Polygon[]; index: number; joined: Polygon; area: number } | null = null;
    for (const run of plan.runs) for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i], area = Math.abs(a.square) + Math.abs(b.square);
      if (best && area >= best.area) continue;
      const joined = new Polygon(convexHull([...a.vertices, ...b.vertices]));
      if (joined.length < 3 || Math.abs(joined.square) < area - 1e-7 || Math.abs(joined.square) > area * 1.05) continue;
      const frontage=plan.frontages.get(a)!;
      const length=Point.distance(frontage.a,frontage.b);
      const ax=(frontage.b.x-frontage.a.x)/length,ay=(frontage.b.y-frontage.a.y)/length;
      const xs=joined.vertices.map(p=>ax*p.x+ay*p.y),ys=joined.vertices.map(p=>-ay*p.x+ax*p.y);
      const width=Math.max(...xs)-Math.min(...xs),depth=Math.max(...ys)-Math.min(...ys);
      // A quota is not permission to turn several shallow houses into a
      // 30-metre strip. Unmerged sites remain real buildings until budget trim.
      if(Math.max(width/depth,depth/width)>2.5)continue;
      if (plan.exclusions && overlapsWater(joined, plan.exclusions)) continue;
      if (joined.square < 0) joined.vertices.reverse();
      best = { run, index: i - 1, joined, area };
    }
    if (!best) break;
    const [a, b] = best.run.splice(best.index, 2, best.joined);
    const frontage = plan.frontages.get(a)!;
    plan.frontages.delete(a); plan.frontages.delete(b);
    plan.frontages.set(best.joined, { ...frontage, at: nearestOnSegment(best.joined.centroid, frontage.a, frontage.b) });
    count--;
  }
  plan.buildings = plan.runs.flat();
}

/** Build perimeter rows around small, serviced blocks. Subdivision earns its
 * lane only when the block is too deep for two street-facing building rows.
 * Long street fronts own their corners; shorter returns stop behind them.
 * No random search and no city-wide building scans. */
export function planCityBlock(
  site: Polygon, streets: Array<WardLane & { kind: 'street' | 'alley' }>,
  areaPerHouse: number, alleyWidth: number,
  compact = false,
  clipConcave = compact,
  spacing?: CityBlockSpacing,
  mixedDenseSites = false,
  compound?: {family:CityCompoundFamily;biome?:string},
): CityBlockPlan | null {
  if (site.length < 3 || Math.abs(site.square) < 1) return null;
  if (compound) {
    let best:CityBlockPlan|undefined;
    for(const fraction of [.5,.25,.75]){
    const reserved=reserveCityCompound(site,streets,areaPerHouse,compound.family,compound.biome,fraction);
    if(reserved){
      const plan:CityBlockPlan={buildings:[...reserved.compound.buildings],lanes:[...reserved.lanes],frontages:new Map(reserved.frontages),runs:reserved.compound.buildings.map(b=>[b]),gardens:[],compounds:[reserved.compound]};
      const exclusions:Point[][]=[reserved.compound.site.vertices];
      for(const remainder of reserved.remaining){
        const part=planCityBlock(remainder,streets,areaPerHouse,alleyWidth,compact,clipConcave,spacing,mixedDenseSites);
        if(!part)continue;
        plan.buildings.push(...part.buildings);plan.lanes.push(...part.lanes);plan.runs.push(...part.runs);
        for(const[b,f]of part.frontages)plan.frontages.set(b,f);
        plan.gardens!.push(...part.gardens??[]);
        exclusions.push(...part.exclusions??[]);
      }
      // Remainder hulls can repeat the compound notch. Union reservations so
      // even-odd water-style checks cannot cancel overlapping exclusions.
      const rings=exclusions.map(points=>points.map(p=>[Math.round(p.x*1e8)/1e8,Math.round(p.y*1e8)/1e8] as [number,number]));
      plan.exclusions=polygonClipping.union([rings[0]],...rings.slice(1).map(r=>[r]))
        .flatMap(p=>p.map(r=>r.slice(0,-1).map(([x,y])=>new Point(x,y))));
      retainUsefulCompoundNeighbours(plan,areaPerHouse);
      retainConnectedCompoundLanes(plan,streets);
      if(!best || plan.buildings.length>best.buildings.length)best=plan;
    }
    }
    if(best)return best;
  }
  // Boolean cuts can leave virtually collinear hull vertices. The strict
  // Polygon predicate and hull use differently based cross products, whose
  // last-bit signs can disagree and repeatedly rehull the same polygon.
  const weaklyConvex=site.square>0 && site.vertices.every((b,i)=>{
    const a=site.vertices[(i+site.length-1)%site.length],c=site.vertices[(i+1)%site.length];
    return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>=-1e-10;
  });
  if (!weaklyConvex) {
    if (!clipConcave) return null;
    // Wall insets can introduce tiny reflex notches. They must not send an
    // otherwise ordinary block back to the sparse estate subdivision.
    const hull=new Polygon(convexHull(site.vertices));
    const plan=planCityBlock(hull,streets,areaPerHouse,alleyWidth,compact,clipConcave,spacing,mixedDenseSites);
    if(!plan)return null;
    // Shared near-collinear wall vertices need a common precision grid for
    // the Boolean sweep; raw floating-point drift can leave an unclosed ring.
    const ring=(p:Polygon)=>p.vertices.map(v=>[Math.round(v.x*1e8)/1e8,Math.round(v.y*1e8)/1e8] as [number,number]);
    const notches=polygonClipping.difference([ring(hull)],[ring(site)]).flatMap(p=>p.map(r=>r.slice(0,-1).map(([x,y])=>new Point(x,y))));
    const frontages=new Map<Polygon,CityFrontage>();
    plan.runs=plan.runs.map(run=>run.flatMap(lot=>{
      const f=plan.frontages.get(lot)!;
      return polygonClipping.intersection([ring(lot)],[ring(site)]).flatMap(p=>{
        if(p.length!==1)return [];
        const b=new Polygon(p[0].slice(0,-1).map(([x,y])=>new Point(x,y)));
        if(b.square<0)b.vertices.reverse();
        if(b.square<areaPerHouse*.32 || b.compactness<.35)return [];
        const at=nearestOnSegment(b.centroid,f.a,f.b), c=b.centroid;
        const dry=drySegments(c,at,notches);
        if(dry.length!==1 || dry[0][0]!==c || dry[0][1]!==at)return [];
        frontages.set(b,{...f,at});
        return [b];
      });
    })).filter(run=>run.length);
    plan.buildings=plan.runs.flat();
    plan.frontages=frontages;
    plan.exclusions=notches;
    if (plan.gardens) plan.gardens = plan.gardens.flatMap(g => polygonClipping.intersection([ring(g)], [ring(site)])
      .filter(p => p.length === 1).map(p => new Polygon(p[0].slice(0, -1).map(([x,y]) => new Point(x,y)))));
    plan.lanes=plan.lanes.flatMap(l=>drySegments(l.a,l.b,notches).map(([a,b])=>({...l,a,b})));
    return plan;
  }
  // A dense block mixes narrow street houses and substantial tenements.
  // Deep, wide sites accommodate tenements; ordinary narrow houses retain
  // their usual depth and a rear garden. Giving every narrow lot tenement
  // depth produces slender footprints that cannot hold ordinary house art.
  // Every site still counts once, regardless of its footprint.
  const ordinaryDepth = Math.sqrt(areaPerHouse * 1.15);
  const depth = mixedDenseSites ? ordinaryDepth * Math.SQRT2 : ordinaryDepth, frontage = areaPerHouse / depth;
  const plan: CityBlockPlan = { buildings: [], lanes: [], frontages: new Map(), runs: [], ...(spacing || mixedDenseSites ? { gardens: [] } : {}) };
  const lines = [...streets];
  const main = [...streets].sort((a, b) => Point.distance(b.a, b.b) - Point.distance(a.a, a.b))[0];
  const mainLength = main ? Point.distance(main.a, main.b) : 1;
  const axisX = main ? (main.b.x - main.a.x) / mainLength : 1;
  const axisY = main ? (main.b.y - main.a.y) / mainLength : 0;
  const blocks: Polygon[] = [];
  const pending: Array<{ polygon: Polygon; level: number }> = [{ polygon: site, level: 0 }];
  while (pending.length) {
    const { polygon, level } = pending.pop()!;
    let perimeter = 0;
    polygon.forEdge((a, b) => {
      const length = Point.distance(a, b);
      perimeter += length;
    });
    const xs = polygon.vertices.map(p => axisX * p.x + axisY * p.y);
    const ys = polygon.vertices.map(p => -axisY * p.x + axisX * p.y);
    // Dense quarters form long back-to-back terraces. Repeatedly bisecting
    // the longest dimension made little square compounds with roads on all
    // sides; cut parallel to the main frontage until two house rows fit.
    const shallow = compact ? Math.max(...ys)-Math.min(...ys) <= depth*2.1
      : Math.abs(polygon.square)/perimeter <= depth*.85;
    if (shallow || level >= 8) { blocks.push(polygon); continue; }
    const along = !compact && Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const dx = along ? axisX : -axisY, dy = along ? axisY : axisX;
    const c = polygon.centroid, at = dx * c.x + dy * c.y;
    const left = clipBlock(polygon, dx, dy, at - alleyWidth / 2);
    const right = clipBlock(polygon, -dx, -dy, -at - alleyWidth / 2);
    if (left.length < 3 || right.length < 3 || Math.min(Math.abs(left.square), Math.abs(right.square)) < areaPerHouse * 2) {
      blocks.push(polygon); continue;
    }
    const crossings: Point[] = [];
    polygon.forEdge((a, b) => {
      const da = dx * a.x + dy * a.y - at, db = dx * b.x + dy * b.y - at;
      if (da * db < 0) {
        const t = da / (da - db);
        crossings.push(new Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)));
      }
    });
    if (crossings.length !== 2) { blocks.push(polygon); continue; }
    let connections = 0;
    const ends = crossings.map((p, i) => {
      const other = crossings[1 - i], vx = p.x - other.x, vy = p.y - other.y;
      const targets: Array<{ at: Point; distance: number }> = [];
      for (const line of lines) {
        const t = intersectLines(p.x, p.y, vx, vy, line.a.x, line.a.y, line.b.x - line.a.x, line.b.y - line.a.y);
        if (!t || t.x < -1e-7 || t.y < 0 || t.y > 1) continue;
        const at = new Point(p.x + t.x * vx, p.y + t.x * vy), distance = Point.distance(p, at);
        if (distance <= 1.25) targets.push({ at, distance });
      }
      targets.sort((a, b) => a.distance - b.distance);
      if (targets.length) { connections++; return targets[0].at; }
      return p; // a dead end at a wall still has its other end connected
    });
    if (!connections) { blocks.push(polygon); continue; }
    const lane = { a: ends[0], b: ends[1], width: alleyWidth };
    plan.lanes.push(lane);
    lines.push({ ...lane, kind: 'alley' });
    pending.push({ polygon: right, level: level + 1 }, { polygon: left, level: level + 1 });
  }
  for (const block of blocks) {
    const winding = Math.sign(block.square);
    const edges: Array<{ a: Point; b: Point; nx: number; ny: number; k: number; length: number }> = [];
    block.forEdge((a, b) => {
      const length = Point.distance(a, b);
      if (length > 1e-8) {
        const nx = winding * (a.y - b.y) / length, ny = winding * (b.x - a.x) / length;
        edges.push({ a, b, nx, ny, k: nx * a.x + ny * a.y, length });
      }
    });
    const occupied: typeof edges = [];
    for (const edge of edges.sort((a, b) => b.length - a.length)) {
      const ax = (edge.b.x - edge.a.x) / edge.length, ay = (edge.b.y - edge.a.y) / edge.length;
      const midpoint = new Point((edge.a.x + edge.b.x) / 2, (edge.a.y + edge.b.y) / 2);
      const source = lines.filter(line => {
        const length = Point.distance(line.a, line.b);
        return length > 1e-8 && Math.abs(ax * (line.b.y - line.a.y) - ay * (line.b.x - line.a.x)) / length < 1e-6;
      }).map(line => ({ line, d: Point.distance(midpoint, nearestOnSegment(midpoint, line.a, line.b)) }))
        .sort((a, b) => a.d - b.d)[0];
      // Wall boundaries are not street fronts; cut lanes and reserved streets are.
      if (!source || source.d > Math.max(1.25, alleyWidth * 2)) continue;
      let strip = clipBlock(block, edge.nx, edge.ny, edge.k + depth);
      for (const other of occupied) {
        strip = clipBlock(strip, -other.nx, -other.ny, -other.k - depth - 0.05);
      }
      occupied.push(edge);
      const ends = [source.line.a, source.line.b].map(p => ax * p.x + ay * p.y);
      strip = clipBlock(strip, ax, ay, Math.max(...ends));
      strip = clipBlock(strip, -ax, -ay, -Math.min(...ends));
      if (strip.length < 3) continue;
      const projections = strip.vertices.map(p => ax * p.x + ay * p.y);
      const lo = Math.min(...projections), hi = Math.max(...projections);
      const gap = frontage * (spacing?.gapRatio ?? 0);
      const count = Math.max(1, Math.round((hi - lo) / (frontage * (mixedDenseSites ? 1.4 : 1) + gap)));
      const width = (hi - lo) / count;
      const weights = Array.from({length:count},(_,i)=>mixedDenseSites && i%4===1 ? 2.6 : 1);
      const unitWidth = (hi-lo)/weights.reduce((a,b)=>a+b,0);
      const lotEnds = [lo];
      for(const weight of weights)lotEnds.push(lotEnds[lotEnds.length-1]+weight*unitWidth);
      const houseWidth = spacing ? Math.min(frontage * 1.2, width - Math.min(gap, width * .75)) : width;
      const groupSize = Math.max(1, spacing?.groupSize ?? 1);
      const startAt = (i: number) => {
        const groupStart = Math.floor(i / groupSize) * groupSize;
        const members = Math.min(groupSize, count - groupStart);
        const shift = ((members - 1) / 2 - (i - groupStart)) * (width - houseWidth);
        return lo + i * width + (width - houseWidth) / 2 + shift;
      };
      const run: Polygon[] = [];
      for (let i = 0; i < count; i++) {
        // A small seam distinguishes houses without turning every party wall into a lane.
        const start = spacing ? startAt(i) : mixedDenseSites ? lotEnds[i] : lo+i*width;
        let lot = clipBlock(strip, -ax, -ay, -(start + 0.025));
        lot = clipBlock(lot, ax, ay, (spacing ? start + houseWidth : mixedDenseSites ? lotEnds[i+1] : lo+(i+1)*width) - 0.025);
        let rearGarden: Polygon | undefined;
        if (mixedDenseSites && weights[i] === 1) {
          rearGarden = clipBlock(lot, -edge.nx, -edge.ny, -edge.k - ordinaryDepth);
          lot = clipBlock(lot, edge.nx, edge.ny, edge.k + ordinaryDepth);
        }
        if (lot.length < 3 || Math.abs(lot.square) < areaPerHouse * 0.32 || lot.compactness < 0.35) continue;
        const at = nearestOnSegment(lot.centroid, source.line.a, source.line.b);
        plan.buildings.push(lot);
        run.push(lot);
        plan.frontages.set(lot, { ...source.line, at });
        if (rearGarden && rearGarden.length >= 3 && Math.abs(rearGarden.square) > .05) plan.gardens!.push(rearGarden);
        const nextStart = i + 1 < count ? startAt(i + 1) : hi;
        if (spacing && nextStart - start - houseWidth > .1) {
          const garden = clipBlock(clipBlock(strip, -ax, -ay, -(start + houseWidth)), ax, ay,
            Math.min(hi, nextStart));
          if (garden.length >= 3 && Math.abs(garden.square) > .05) plan.gardens!.push(garden);
        }
      }
      if (run.length) plan.runs.push(run);
    }
  }
  return plan;
}
