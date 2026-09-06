import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  mergeSprites, buildRefinedManifest, renderRefinedManifestModule, renderRefinedGlyphModule,
} from '../scripts/extract-refined-glyphs.js';

const ROOT = new URL('..', import.meta.url).pathname;
const sprites = [
  readFileSync(`${ROOT}symbols/refined/symbols.svg`, 'utf8'),
  readFileSync(`${ROOT}symbols/refined/symbols-biomes.svg`, 'utf8'),
  readFileSync(`${ROOT}symbols/refined/symbols-parcel.svg`, 'utf8'),
];
const manifestJson = JSON.parse(
  readFileSync(`${ROOT}symbols/refined/symbols.json`, 'utf8'),
);

describe('refined glyph extraction', () => {
  it('parses a body for every manifest id, across all three sprites', () => {
    const sprite = mergeSprites(sprites);
    for (const id of Object.keys(manifestJson.symbols)) {
      expect(sprite.get(id), `missing body for ${id}`).toBeTruthy();
    }
  });

  it('manifest entries carry typed metadata', () => {
    const manifest = buildRefinedManifest(manifestJson);
    for (const [id, m] of Object.entries(manifest)) {
      expect(['fixed', 'mark', 'canopy', 'pattern']).toContain(m.cls);
      expect(m.viewBox).toHaveLength(4);
      expect(m.anchor).toHaveLength(2);
      expect(m.minScale).toBeGreaterThan(0);
      if (m.cls === 'fixed') expect(m.footprint, `${id} fixed needs footprint`).not.toBeNull();
    }
  });

  it('every structure-band id has a sil twin', () => {
    const sprite = mergeSprites(sprites);
    const manifest = buildRefinedManifest(manifestJson);
    const structureIds = Object.entries(manifest)
      .filter(([, m]) => m.zBand === 'structure')
      .map(([id]) => id);
    expect(structureIds.length).toBeGreaterThan(0);
    for (const id of structureIds) {
      expect(sprite.get(`${id}-sil`), `structure id ${id} missing -sil`).toBeTruthy();
    }
  });

  it('parcel-band ids have no sil twin (ground casts no shadow)', () => {
    const sprite = mergeSprites(sprites);
    const manifest = buildRefinedManifest(manifestJson);
    const parcelIds = Object.entries(manifest)
      .filter(([, m]) => m.zBand === 'parcel')
      .map(([id]) => id);
    expect(parcelIds.length).toBeGreaterThan(0);
    for (const id of parcelIds) {
      expect(sprite.get(`${id}-sil`), `parcel id ${id} unexpectedly has -sil`).toBeUndefined();
    }
  });

  it('rotation is optional and absent only for the field pattern tiles', () => {
    const manifest = buildRefinedManifest(manifestJson);
    for (const [id, m] of Object.entries(manifest)) {
      if (m.rotation === undefined) {
        expect(id.startsWith('sm-field-'), `${id} unexpectedly has no rotation`).toBe(true);
      }
    }
  });

  it('committed modules match a fresh regeneration (idempotent codegen)', () => {
    const sprite = mergeSprites(sprites);
    const manifest = buildRefinedManifest(manifestJson);
    const wantManifest = renderRefinedManifestModule(manifest);
    const wantGlyphs = renderRefinedGlyphModule(manifest, sprite);
    expect(readFileSync(`${ROOT}src/assets/refined-manifest.ts`, 'utf8')).toBe(wantManifest);
    expect(readFileSync(`${ROOT}src/assets/refined-glyphs.ts`, 'utf8')).toBe(wantGlyphs);
  });

  it('glyph module carries CC-BY attribution', () => {
    const src = readFileSync(`${ROOT}src/assets/refined-glyphs.ts`, 'utf8');
    expect(src).toContain('CC-BY-4.0');
    expect(src).toContain('Barry Gill');
  });
});
