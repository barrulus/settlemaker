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
