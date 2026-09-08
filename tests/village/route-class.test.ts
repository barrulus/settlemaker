import { describe, it, expect } from 'vitest';
import {
  ROUTE_CLASS_ORDER, classRank, isRoadClass, laneWidth, stepDown, fromLegacyKind, toLegacyKind,
} from '../../src/village/route-class.js';

describe('route class vocabulary', () => {
  it('orders classes highest first', () => {
    expect(ROUTE_CLASS_ORDER).toEqual(
      ['royal', 'main', 'market', 'town', 'local', 'trail', 'footpath'],
    );
    expect(classRank('royal')).toBeLessThan(classRank('local'));
  });

  it('separates the road group from the path group', () => {
    expect(isRoadClass('local')).toBe(true);
    expect(isRoadClass('trail')).toBe(false);
    expect(isRoadClass('footpath')).toBe(false);
  });

  it('gives each class a width in metres', () => {
    expect(laneWidth('royal')).toBe(6);
    expect(laneWidth('local')).toBe(3.5);
    expect(laneWidth('footpath')).toBe(1.2);
  });

  it('steps down one class but never below the floor', () => {
    expect(stepDown('main', 'local')).toBe('market');
    expect(stepDown('local', 'local')).toBe('local');
    expect(stepDown('trail', 'footpath')).toBe('footpath');
    expect(stepDown('footpath', 'footpath')).toBe('footpath');
  });

  it('maps the legacy three-kind input', () => {
    expect(fromLegacyKind('road')).toBe('main');
    expect(fromLegacyKind('foot')).toBe('trail');
    expect(fromLegacyKind('sea')).toBe('searoutes');
  });

  it('narrows route types back to the legacy three-kind form', () => {
    // Legacy values pass through unchanged
    expect(toLegacyKind('road')).toBe('road');
    expect(toLegacyKind('foot')).toBe('foot');
    expect(toLegacyKind('sea')).toBe('sea');
    // Road-group classes narrow to 'road'
    expect(toLegacyKind('royal')).toBe('road');
    expect(toLegacyKind('main')).toBe('road');
    expect(toLegacyKind('market')).toBe('road');
    expect(toLegacyKind('town')).toBe('road');
    expect(toLegacyKind('local')).toBe('road');
    // Path-group classes narrow to 'foot'
    expect(toLegacyKind('trail')).toBe('foot');
    expect(toLegacyKind('footpath')).toBe('foot');
    // Special groups
    expect(toLegacyKind('searoutes')).toBe('sea');
    expect(toLegacyKind('airroutes')).toBe(undefined);
    expect(toLegacyKind('traderoutes')).toBe(undefined);
    // Undefined in, undefined out
    expect(toLegacyKind(undefined)).toBe(undefined);
  });
});

/**
 * CITY-VISIBLE BEHAVIOUR. `src/input/azgaar-input.ts` imports `toLegacyKind`
 * and calls it on every road bearing of every burg, cities included, so this
 * function's output is part of the settlement engine's input. City SVG
 * byte-identity is the clean regression signal for a village-side release
 * (two sessions certified "cities are insulated from src/village/" on
 * 2026-09-07 and both were wrong -- see the plan for the import walk).
 *
 * This pins every input the function can receive. Adding a route class is
 * fine; changing what an EXISTING one narrows to is a city regression, and
 * it should fail here rather than in someone's byte diff after a deploy.
 */
describe('toLegacyKind is city-visible and must not drift', () => {
  it.each([
    ['royal', 'road'], ['main', 'road'], ['market', 'road'],
    ['town', 'road'], ['local', 'road'],
    ['trail', 'foot'], ['footpath', 'foot'],
    ['road', 'road'], ['foot', 'foot'], ['sea', 'sea'],
    ['searoutes', 'sea'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(toLegacyKind(input)).toBe(expected);
  });

  it.each(['airroutes', 'traderoutes'] as const)('%s -> undefined', (input) => {
    expect(toLegacyKind(input)).toBeUndefined();
  });

  it('maps undefined through', () => {
    expect(toLegacyKind(undefined)).toBeUndefined();
  });

  it.each(['royal', 'main', 'market', 'town'] as const)(
    'keeps %s ranked below local, the boundary isRoadClass reads', (kind) => {
      // `trail` and `footpath` are caught by a literal check BEFORE
      // isRoadClass, so their position is irrelevant here -- these four are
      // the ones that reach classRank. Move 'local' ahead of 'town' and
      // toLegacyKind('town') silently becomes undefined for every city burg.
      expect(classRank(kind)).toBeLessThan(classRank('local'));
    },
  );
});
