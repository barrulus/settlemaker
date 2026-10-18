import { describe, it } from 'vitest';
import { assertLougyWaterfront } from './lougy-waterfront.js';

describe('Lougy waterfront settlements', () => {
  it('hasingsbury produces an inhabited waterfront with the required working access', () => {
    assertLougyWaterfront('hasingsbury');
  }, 180000);
});
