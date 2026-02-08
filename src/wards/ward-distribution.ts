import type { GenerationParams } from '../generator/generation-params.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import { Ward } from './ward.js';
import { CraftsmenWard } from './craftsmen-ward.js';
import { MerchantWard } from './merchant-ward.js';
import { Slum } from './slum.js';
import { PatriciateWard } from './patriciate-ward.js';
import { AdministrationWard } from './administration-ward.js';
import { MilitaryWard } from './military-ward.js';
import { Cathedral } from './cathedral.js';
import { Market } from './market.js';
import { Park } from './park.js';

/** Ward constructor type: creates a Ward given a Model and Patch */
export type WardConstructor = new (model: Model, patch: Patch) => Ward;

/**
 * Build a ward distribution list based on Azgaar flags and population.
 * Replaces the hardcoded Model.WARDS array from the Haxe source.
 *
 * Original Haxe distribution (35 elements):
 *   Craftsmen ×16 (~46%), Slum ×5 (~14%), Merchant ×2 (~6%),
 *   Patriciate ×2 (~6%), Market ×2 (~6%), Administration ×1 (~3%),
 *   Military ×1 (~3%), Cathedral ×1 (~3%), Park ×1 (~3%)
 *   + remaining Craftsmen fill
 */
export function buildWardDistribution(params: GenerationParams): WardConstructor[] {
  const n = params.nPatches;
  const wards: WardConstructor[] = [];

  // Base Craftsmen fill: ~46%
  const craftsmenCount = Math.max(3, Math.round(n * 0.46));
  for (let i = 0; i < craftsmenCount; i++) wards.push(CraftsmenWard);

  // Slum: ~14%, more if shanty
  const slumCount = Math.max(1, Math.round(n * (params.shantyNeeded ? 0.22 : 0.14)));
  for (let i = 0; i < slumCount; i++) wards.push(Slum);

  // Merchant: ~6%
  const merchantCount = Math.max(1, Math.round(n * 0.06));
  for (let i = 0; i < merchantCount; i++) wards.push(MerchantWard);

  // Patriciate: ~6%
  const patriciateCount = Math.max(0, Math.round(n * 0.06));
  for (let i = 0; i < patriciateCount; i++) wards.push(PatriciateWard);

  // Market: ~6%
  const marketCount = Math.max(0, Math.round(n * 0.06));
  for (let i = 0; i < marketCount; i++) wards.push(Market);

  // Administration: ~3%, more if capital
  const adminCount = Math.max(0, Math.round(n * (params.capitalNeeded ? 0.08 : 0.03)));
  for (let i = 0; i < adminCount; i++) wards.push(AdministrationWard);

  // Military: 1
  wards.push(MilitaryWard);

  // Cathedral/Temple: add if templeNeeded
  if (params.templeNeeded) {
    wards.push(Cathedral);
  }

  // Park: 1 if city is large enough
  if (n >= 10) {
    wards.push(Park);
  }

  return wards;
}
