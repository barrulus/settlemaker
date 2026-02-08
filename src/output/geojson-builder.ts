import type { Feature, FeatureCollection, Polygon as GeoPolygon } from 'geojson';
import type { Polygon } from '../geom/polygon.js';
import type { Model } from '../generator/model.js';
import type { CurtainWall } from '../generator/curtain-wall.js';
import { Castle } from '../wards/castle.js';

/**
 * Convert a generated Model to a GeoJSON FeatureCollection.
 *
 * Each ward patch becomes a Feature with:
 * - geometry: Polygon (from patch shape)
 * - properties: wardType, label, withinCity, withinWalls
 *
 * Buildings within each ward become separate features.
 * Walls and streets also have feature representations.
 */
export function generateGeoJson(model: Model): FeatureCollection {
  const features: Feature[] = [];

  // Ward patches
  for (const patch of model.patches) {
    if (!patch.ward) continue;

    features.push({
      type: 'Feature',
      properties: {
        layer: 'ward',
        wardType: patch.ward.type,
        label: patch.ward.getLabel(),
        withinCity: patch.withinCity,
        withinWalls: patch.withinWalls,
      },
      geometry: polygonToGeoJson(patch.shape),
    });

    // Buildings
    for (const building of patch.ward.geometry) {
      features.push({
        type: 'Feature',
        properties: {
          layer: 'building',
          wardType: patch.ward.type,
        },
        geometry: polygonToGeoJson(building),
      });
    }
  }

  // Streets
  for (const artery of model.arteries) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'street',
        streetType: 'artery',
      },
      geometry: {
        type: 'LineString',
        coordinates: artery.vertices.map(v => [v.x, v.y]),
      },
    });
  }

  for (const road of model.roads) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'street',
        streetType: 'road',
      },
      geometry: {
        type: 'LineString',
        coordinates: road.vertices.map(v => [v.x, v.y]),
      },
    });
  }

  // Walls
  if (model.wall !== null) {
    addWallFeatures(features, model.wall, 'city_wall');
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    addWallFeatures(features, (model.citadel.ward as Castle).wall, 'citadel_wall');
  }

  // Gates
  for (const gate of model.gates) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'gate',
      },
      geometry: {
        type: 'Point',
        coordinates: [gate.x, gate.y],
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

function addWallFeatures(features: Feature[], wall: CurtainWall, wallType: string): void {
  features.push({
    type: 'Feature',
    properties: {
      layer: 'wall',
      wallType,
    },
    geometry: polygonToGeoJson(wall.shape),
  });

  for (const tower of wall.towers) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'tower',
        wallType,
      },
      geometry: {
        type: 'Point',
        coordinates: [tower.x, tower.y],
      },
    });
  }
}

function polygonToGeoJson(poly: Polygon): GeoPolygon {
  const coords = poly.vertices.map(v => [v.x, v.y] as [number, number]);
  // Close the ring
  if (coords.length > 0) {
    coords.push([coords[0][0], coords[0][1]]);
  }
  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}
