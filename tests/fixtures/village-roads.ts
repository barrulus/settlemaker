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
  ...[40, 80, 119, 120, 150, 300, 600, 900].flatMap(population =>
    [1, 2, 3].map(seed => ({ id: `p${population}-s${seed}`, input: roadFixture(population), seed }))),
  ...[
    ['class-joins', { roadBearings: [{ bearing_deg: 45, kind: 'royal', through: true }, { bearing_deg: 190, kind: 'town' }, { bearing_deg: 270, kind: 'footpath' }] }],
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
      roadBearings: [{ bearing_deg: 90, kind: 'main', through: true }],
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
      roadBearings: [{ bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' }],
      ...(wet ? {
        coastlineGeometry: [[
          { x: -900, y: -898 }, { x: 900, y: 902 }, { x: 900, y: 906 }, { x: -900, y: -894 },
        ]]
      } : {}),
    }),
  })),
  ...[121, 899, 1000, 1001].map(population => ({ id: `boundary-${population}`, input: roadFixture(population), seed: 2 })),
  ...[
    ['no-routes', 40, { roadBearings: [] }],
    ['trail', 40, { roadBearings: [{ bearing_deg: 225, kind: 'trail' }] }],
    ['local', 80, { roadBearings: [{ bearing_deg: 225, kind: 'local' }] }],
    ['royal', 40, { roadBearings: [{ bearing_deg: 225, kind: 'royal' }] }],
    ['through', 300, { roadBearings: [{ bearing_deg: 30, kind: 'main', through: true }] }],
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
