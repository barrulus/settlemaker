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
export function buildWardDistribution(params: GenerationParams, slots: number): WardConstructor[] {
  // `slots` is the exact number of patches createWards' assignment loop will
  // deal to (this.inner minus the plaza minus the gate wards, both assigned
  // before the deck is drawn). Earlier revisions sized the deck off nPatches
  // and then nCore — both larger than the slots actually dealt — which
  // starved the entries near the end of the list: the distinctive singletons
  // (Administration, Military, Cathedral, Park) sat past the last slot and
  // were effectively extinct (measured pop 20000, seeds 1-20: deck 29 vs
  // 23-28 slots — Park 1/20, Cathedral 3/20, Military 6/20). Sizing the deck
  // to exactly `slots` means every entry is dealt, every run.
  const n = slots;
  if (n <= 0) return [];

  // Singletons first (in deal order): they must all fit inside the deck.
  const specials: WardConstructor[] = [];

  // Administration: ~3%, more if capital
  const adminCount = Math.max(0, Math.round(n * (params.capitalNeeded ? 0.08 : 0.03)));
  for (let i = 0; i < adminCount; i++) specials.push(AdministrationWard);

  // Military: 1
  specials.push(MilitaryWard);

  // Cathedral/Temple: add if templeNeeded
  if (params.templeNeeded) {
    specials.push(Cathedral);
  }

  // Park: 1 if city is large enough
  if (n >= 10) {
    specials.push(Park);
  }

  // Tiny settlements may not have room for every special; drop the least
  // distinctive first (Administration, then Military — Cathedral answers an
  // explicit input flag and Park is already gated on n >= 10, so in practice
  // the trim never reaches them).
  while (specials.length > n) specials.shift();

  // Commons fill the remaining slots. Proportions are of the whole deck,
  // with Craftsmen as the flexible filler absorbing the remainder.
  const commonsBudget = n - specials.length;

  const commons: WardConstructor[] = [];

  // Slum: ~14%, more if shanty
  const slumCount = Math.max(1, Math.round(n * (params.shantyNeeded ? 0.22 : 0.14)));
  for (let i = 0; i < slumCount; i++) commons.push(Slum);

  // Merchant: ~6%
  const merchantCount = Math.max(1, Math.round(n * 0.06));
  for (let i = 0; i < merchantCount; i++) commons.push(MerchantWard);

  // Patriciate: ~6%
  const patriciateCount = Math.max(0, Math.round(n * 0.06));
  for (let i = 0; i < patriciateCount; i++) commons.push(PatriciateWard);

  // Market: ~6%
  const marketCount = Math.max(0, Math.round(n * 0.06));
  for (let i = 0; i < marketCount; i++) commons.push(Market);

  // Trim from the end (Market first) if the fixed commons alone overflow
  // the budget — only possible at very small n.
  while (commons.length > commonsBudget) commons.pop();

  // Base Craftsmen fill: the remainder (~46% at typical proportions)
  const craftsmenCount = commonsBudget - commons.length;
  const wards: WardConstructor[] = [];
  for (let i = 0; i < craftsmenCount; i++) wards.push(CraftsmenWard);

  wards.push(...commons, ...specials);
  return wards;
}
