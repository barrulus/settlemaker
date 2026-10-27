import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { harbourArtwork } from '../src/output/harbour-artwork.js';
import { themeFrom } from '../src/output/render-theme.js';
import { PALETTE_BLUEPRINT, PALETTE_PARCHMENT } from '../src/output/palette.js';
import type { HarbourFeature } from '../src/scene/scene.js';

const rectangle = (x: number, y: number, width: number, height: number) =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const example = (): HarbourFeature => ({
  id: 'working-harbour', kind: 'protected', basin: rectangle(0, 0, 80, 60),
  entrance: [{ x: 65, y: 60 }, { x: 80, y: 60 }], approach: [], access: [], navigationWidth: 15,
  quays: [{ ring: rectangle(0, -12, 80, 12), edge: [{ x: 0, y: 0 }, { x: 80, y: 0 }] }],
  breakwaters: [{ ring: rectangle(-6, 0, 6, 65), path: [{ x: -3, y: 0 }, { x: -3, y: 65 }], width: 6 }],
  berths: [{ ring: rectangle(15, 0, 4, 18) }, { ring: rectangle(35, 0, 4, 18) }],
  fixtures: [
    { kind: 'crane', at: { x: 8, y: -4 }, angle: 90 },
    { kind: 'bollard', at: { x: 22, y: -1 }, angle: 0 },
    { kind: 'beacon', at: { x: -3, y: 61 }, angle: 0 },
    { kind: 'boat', at: { x: 22, y: 9 }, angle: 90 },
  ],
});

describe('physical harbour artwork', () => {
  it('keeps natural water and reserved basin unpainted while distinguishing built materials', () => {
    const art = harbourArtwork(example(), themeFrom(PALETTE_PARCHMENT));
    expect(art.ground).toContain('data-harbour-surface="quay"');
    expect(art.ground).toContain('data-harbour-surface="breakwater"');
    expect(art.ground.match(/data-harbour-surface="berth"/g)).toHaveLength(2);
    expect(art.ground).toContain('data-harbour-detail="capstones"');
    expect(art.ground).toContain('data-harbour-detail="masonry"');
    expect(art.ground).toContain('data-harbour-detail="planks"');
    expect(art.ground).toContain('data-harbour-detail="piles"');
    expect(art.ground).not.toContain('data-harbour-fixture');
    expect(art.fixtures).toContain('data-harbour-fixture="crane" transform="translate(8,-4) rotate(90)"');
    expect(art.fixtures).not.toContain('clipPath');
  });

  it('clips capstones, beams and texture to the built footprint, leaving the working basin transparent', async () => {
    const art = harbourArtwork(example(), themeFrom(PALETTE_PARCHMENT));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -15 100 85" width="600" height="510">${art.ground}</svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(Math.floor((y + 15) * 6) * info.width + Math.floor((x + 10) * 6)) * 4 + 3];
    for (const [x, y] of [[5, 5], [25, 30], [70, 40], [83, -5], [-7, 25], [16, 20]]) expect(alpha(x, y)).toBe(0);
    for (const [x, y] of [[5, -5], [40, -5], [-3, 30], [17, 10]]) expect(alpha(x, y)).toBe(255);
  });

  it('retains every working fixture alongside the built surfaces', () => {
    const art = harbourArtwork(example(), themeFrom(PALETTE_PARCHMENT));
    expect(art.ground.match(/data-harbour-surface=/g)).toHaveLength(4);
    expect(art.ground).toContain('data-harbour-detail');
    expect(art.fixtures).toContain('data-harbour-fixture="boat"');
    expect(art.fixtures).toContain('data-harbour-fixture="bollard"');
  });

  it('keeps motifs stable across views and uses the selected palette for every material', () => {
    const harbour = example(), theme = themeFrom(PALETTE_BLUEPRINT);
    const art = harbourArtwork(harbour, theme);
    expect(harbourArtwork(harbour, theme)).toEqual(art);
    expect(art.ground).toContain(`fill="${theme.smTimber}"`);
    expect(art.ground).toContain(`fill="${theme.smStone}"`);
    expect(art.fixtures).toContain(`stroke="${theme.smInk}"`);
    expect(art.ground + art.fixtures).not.toMatch(/NaN|Infinity|<image/);
  });

  it('escapes harbour identities and handles duplicate or degenerate structure points', () => {
    const harbour = example();
    harbour.id = 'harbour "a" <b>';
    harbour.berths.push({ ring: [{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 2 }] });
    harbour.breakwaters[0].path.splice(1, 0, { ...harbour.breakwaters[0].path[0] });
    const art = harbourArtwork(harbour, themeFrom(PALETTE_PARCHMENT));
    expect(art.ground).toContain('data-harbour-id="harbour &quot;a&quot; &lt;b&gt;"');
    expect(art.ground + art.fixtures).not.toMatch(/NaN|Infinity/);
    const ids = [...art.ground.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^[\w-]+$/.test(id))).toBe(true);
  });
});
