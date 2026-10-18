import { describe, it } from 'vitest';
import { assertLougyWaterfront } from './lougy-waterfront.js';

describe('Lougy waterfront settlements', () => {
  it('kinglewes produces an inhabited waterfront with the required working access', () => {
    assertLougyWaterfront('kinglewes');
  }, 180000);
});
