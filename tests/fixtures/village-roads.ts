import type { RouteType } from '../../src/village/route-class.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

export interface RoadFixture { id: string; input: AzgaarBurgInput; seed: number; }
export function roadFixture(population: number, overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Road review', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false,
    roadBearings: [{ bearing_deg: 225, kind: 'road' }], ...overrides
  };
}
export const roadReviewFixtures: RoadFixture[] = [
  ...[
    ['offset-three', 80, [18, 142, 267]],
    ['offset-four', 150, [12, 102, 207, 288]],
    ['offset-five', 300, [23, 81, 167, 236, 310]],
    ['offset-six', 600, [4, 73, 139, 196, 248, 327]],
    ['same-side', 150, [22, 57, 104]],
    ['close-fan', 300, [90, 90.5, 91.2, 145, 233, 312]],
    ['bent-through', 300, [46, 193]],
    ['hamlet-royal', 40, [36, 209]],
    ['hamlet-market', 80, [83, 244]],
    ['village-royal', 300, [36, 209]],
    ['seven-classes', 300, [13, 66, 124, 171, 227, 281, 337]],
  ].map(([id, population, bearings]) => ({
    id: String(id), seed: 7,
    input: roadFixture(Number(population), {
      roadBearings: (bearings as number[]).map((bearing_deg, i) => ({
        bearing_deg, route_id: String(id).includes('hamlet') || id === 'village-royal' || id === 'bent-through' ? 'continuing' : `r-${i}`,
        kind: (id === 'hamlet-market' ? 'market' : String(id).includes('royal') ? 'royal'
          : id === 'seven-classes' ? ['royal', 'main', 'market', 'town', 'local', 'trail', 'footpath'][i]
            : ['main', 'town', 'local', 'footpath', 'town', 'local'][i]) as RouteType,
      })),
    }),
  })),

  ...[40, 80, 119, 120, 150, 300, 600, 900].flatMap(population =>
    [1, 2, 3].map(seed => ({ id: `p${population}-s${seed}`, input: roadFixture(population), seed }))),
  ...[
    ['class-joins', { roadBearings: [{ bearing_deg: 45, kind: 'royal', through: true, route_id: 'royal' }, { bearing_deg: 218, kind: 'royal', through: true, route_id: 'royal' }, { bearing_deg: 190, kind: 'town' }, { bearing_deg: 270, kind: 'footpath' }] }],
    ['headland', {
      port: true, coastlineGeometry: [[
        { x: 38, y: -500 }, { x: 32, y: -120 }, { x: 70, y: -55 }, { x: 120, y: -10 },
        { x: 105, y: 35 }, { x: 46, y: 80 }, { x: 38, y: 150 }, { x: 80, y: 500 },
        { x: 600, y: 500 }, { x: 600, y: -500 },
      ]]
    }],
    ['estuary', {
      port: true, roadBearings: [0, 180], coastlineGeometry: [[
        { x: 12, y: -500 }, { x: 22, y: -120 }, { x: 38, y: -55 }, { x: 30, y: 0 },
        { x: 55, y: 60 }, { x: 120, y: 140 }, { x: 500, y: 200 }, { x: 500, y: -500 },
      ]]
    }],
    ['meander', {
      roadBearings: [{ bearing_deg: 90, kind: 'main', through: true, route_id: 'cross' }, { bearing_deg: 256, kind: 'main', through: true, route_id: 'cross' }],
      coastlineGeometry: [[
        ...Array.from({ length: 61 }, (_, i) => ({ x: 35 + 26 * Math.sin((i - 30) / 5) - 4, y: (i - 30) * 12 })),
        ...Array.from({ length: 61 }, (_, i) => ({ x: 35 + 26 * Math.sin((30 - i) / 5) + 4, y: (30 - i) * 12 })),
      ]]
    }],
  ].map(([id, overrides]) => ({ id: String(id), seed: 2, input: roadFixture(300, overrides as Partial<AzgaarBurgInput>) })),
  ...[false, true].map(wet => ({
    id: wet ? 'brook' : 'brook-dry', seed: 3,
    input: roadFixture(300, {
      name: 'Brook',
      roadBearings: [{ bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' }, { bearing_deg: 305, kind: 'main', through: true, route_id: 'r-cross' }],
      ...(wet ? {
        rivers: [{ centreline: [{ x: -900, y: -896 }, { x: 900, y: 904 }], widthM: 2.83 }]
      } : {}),
    }),
  })),
  ...[121, 899, 1000, 1001].map(population => ({ id: `boundary-${population}`, input: roadFixture(population), seed: 2 })),
  ...[
    ['no-routes', 40, { roadBearings: [] }],
    ['trail', 40, { roadBearings: [{ bearing_deg: 225, kind: 'trail' }] }],
    ['local', 80, { roadBearings: [{ bearing_deg: 225, kind: 'local' }] }],
    ['royal', 40, { roadBearings: [{ bearing_deg: 225, kind: 'royal' }] }],
    ['through', 300, { roadBearings: [{ bearing_deg: 30, kind: 'main', through: true, route_id: 'through' }, { bearing_deg: 222, kind: 'main', through: true, route_id: 'through' }] }],
    ['tri', 900, { roadBearings: [0, 120, 240] }],
    ['close', 150, { roadBearings: [0, 15, 180] }],
    ['coast', 300, { port: true, oceanBearing: 90 }],
    ['water', 80, { coastlineGeometry: [[{ x: 25, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 300 }, { x: 25, y: 300 }]] }],
    ['landmarks', 300, { temple: true, citadel: true, plaza: true }],
    ['desert', 80, { biome: 'desert' }],
    ['tundra', 300, { biome: 'tundra' }],
  ].map(([id, population, overrides]) => ({
    id: String(id), seed: 2,
    input: roadFixture(Number(population), overrides as Partial<AzgaarBurgInput>)
  })),
];
