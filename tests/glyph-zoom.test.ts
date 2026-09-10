import { expect, it } from 'vitest';
import sharp from 'sharp';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { SCENE_VERSION, type Scene } from '../src/scene/scene.js';
import { cropReviewSvg } from '../scripts/city-review-crop.js';

async function expectSameCrop(whole: string, detail: string) {
  const fromWhole = await sharp(Buffer.from(whole), { density: 720 })
    .extract({ left: 250, top: 250, width: 500, height: 500 }).ensureAlpha().raw().toBuffer();
  const fromDetail = await sharp(Buffer.from(detail), { density: 720 }).ensureAlpha().raw().toBuffer();
  expect(fromDetail.length).toBe(fromWhole.length);
  let difference = 0;
  for (let i = 0; i < fromWhole.length; i++) difference += Math.abs(fromWhole[i] - fromDetail[i]);
  expect(difference / fromWhole.length).toBeLessThan(0.01);
}

it('changing the viewBox crops glyphs without resizing them relative to city geometry', async () => {
  const scene: Scene = {
    version: SCENE_VERSION, seed: 2, population: 2500,
    bounds: { min_x: -50, min_y: -50, max_x: 50, max_y: 50 },
    layers: {
      water: { rings: [], synthetic: false }, fields: [], furrows: [], greens: [],
      roads: [], piers: [], walls: [],
      buildings: [{ kind: 'craftsmen', landmark: false, ring: [
        { x: -18, y: -8 }, { x: -12, y: -8 }, { x: -12, y: 8 }, { x: -18, y: 8 },
      ] }],
      symbols: [{ id: 'sm-house', at: { x: 0, y: 0 }, scale: 12, scaleY: 9, rotationDeg: 27, zBand: 'structure' }],
      vegetation: [{ kind: 'sm-tree-deciduous', at: { x: 15, y: 8 }, scale: 7, rotationDeg: 15 }],
    },
  };
  const whole = assembleSvg(scene);
  const detail = whole.replace('viewBox="-50.0 -50.0 100.0 100.0"', 'viewBox="-25 -25 50 50"');
  // Equal physical scale: ten raster pixels per local unit in both images.
  // Compare a pixel crop of the overview with a separately rendered viewBox crop.
  await expectSameCrop(whole, detail);
  await expectSameCrop(whole, cropReviewSvg(whole, [-25, -25, 50, 50]));
});

it('gallery crops preserve the unmodified baseline renderer viewport as well', async () => {
  const baseline = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100"><defs><symbol id="legacy" viewBox="0 0 64 64" width="64" height="64"><rect x="12" y="12" width="40" height="40" fill="red"/></symbol></defs><use href="#legacy" transform="scale(0.2) translate(-32,-32)"/></svg>';
  await expectSameCrop(baseline, cropReviewSvg(baseline, [-25, -25, 50, 50]));
});
