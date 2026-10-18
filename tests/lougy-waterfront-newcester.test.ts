import { describe, it } from 'vitest';
import { assertLougyWaterfront } from './lougy-waterfront.js';

describe('Lougy waterfront settlements', () => {
  it('newcester produces an inhabited waterfront with the required working access', () => {
    assertLougyWaterfront('newcester');
  }, 180000);
});
