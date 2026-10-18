import { describe, it } from 'vitest';
import { assertLougyWaterfront } from './lougy-waterfront.js';

describe('Lougy waterfront settlements', () => {
  it('helster produces an inhabited waterfront with the required working access', () => {
    assertLougyWaterfront('helster');
  }, 180000);
});
