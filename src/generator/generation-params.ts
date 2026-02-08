import { Point } from '../types/point.js';

export interface GenerationParams {
  /** Number of Voronoi patches for the inner city */
  nPatches: number;
  /** Whether to generate a central market plaza */
  plazaNeeded: boolean;
  /** Whether to generate a citadel/castle */
  citadelNeeded: boolean;
  /** Whether to generate city walls */
  wallsNeeded: boolean;
  /** Whether to include a cathedral/temple in ward distribution */
  templeNeeded: boolean;
  /** Whether to increase slum proportion */
  shantyNeeded: boolean;
  /** Whether to increase administration wards */
  capitalNeeded: boolean;
  /** Random seed for deterministic generation */
  seed: number;

  // Future extension points
  /** Road entry points from external map data */
  roadEntryPoints?: Point[];
  /** River path through the settlement */
  riverPath?: Point[];
  /** Coastline geometry for harbour wards */
  coastlineGeometry?: Point[][];
}
