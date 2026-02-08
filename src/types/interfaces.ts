import { Polygon } from '../geom/polygon.js';

export enum WardType {
  Craftsmen = 'craftsmen',
  Merchant = 'merchant',
  Cathedral = 'cathedral',
  Slum = 'slum',
  Patriciate = 'patriciate',
  Administration = 'administration',
  Military = 'military',
  GateWard = 'gate',
  Market = 'market',
  Castle = 'castle',
  Park = 'park',
  Farm = 'farm',
  Empty = 'empty',
}

export type Street = Polygon;

export interface Palette {
  paper: number;
  light: number;
  medium: number;
  dark: number;
}
