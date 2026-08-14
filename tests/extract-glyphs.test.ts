import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSprite, buildManifest, renderManifestModule, renderGlyphModule,
} from '../scripts/extract-glyphs.js';

const ROOT = new URL('..', import.meta.url).pathname;
const spriteSvg = readFileSync(`${ROOT}symbols/batch001/symbols.svg`, 'utf8');
const manifestJson = JSON.parse(
  readFileSync(`${ROOT}symbols/batch001/symbols.json`, 'utf8'),
);

describe('glyph extraction', () => {
  it('parses body + sil for every manifest id', () => {
    const sprite = parseSprite(spriteSvg);
    for (const id of Object.keys(manifestJson.symbols)) {
      expect(sprite.get(id), `missing body for ${id}`).toBeTruthy();
      expect(sprite.get(`${id}-sil`), `missing sil for ${id}`).toBeTruthy();
    }
  });

  it('manifest entries carry typed metadata', () => {
    const manifest = buildManifest(manifestJson);
    for (const [id, m] of Object.entries(manifest)) {
      expect(['fixed', 'mark', 'canopy', 'pattern']).toContain(m.cls);
      expect(m.viewBox).toHaveLength(4);
      expect(m.anchor).toHaveLength(2);
      expect(m.minScale).toBeGreaterThan(0);
      if (m.cls === 'fixed') expect(m.footprint, `${id} fixed needs footprint`).not.toBeNull();
    }
  });

  it('committed modules match a fresh regeneration (idempotent codegen)', () => {
    const sprite = parseSprite(spriteSvg);
    const manifest = buildManifest(manifestJson);
    const wantManifest = renderManifestModule(manifest);
    const wantGlyphs = renderGlyphModule(manifest, sprite);
    expect(readFileSync(`${ROOT}src/assets/symbol-manifest.ts`, 'utf8')).toBe(wantManifest);
    expect(readFileSync(`${ROOT}src/assets/batch001.ts`, 'utf8')).toBe(wantGlyphs);
  });

  it('glyph module carries CC-BY attribution', () => {
    const src = readFileSync(`${ROOT}src/assets/batch001.ts`, 'utf8');
    expect(src).toContain('CC-BY-4.0');
    expect(src).toContain('Barry Gill');
  });
});
