import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import { hasGlyph } from '../../src/village/glyphs.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('renderVillage', () => {
  const model = generateVillage(input, 1);
  const svg = renderVillage(model);

  it('emits a single svg document with the tiler background contract', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-bg="paper"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('paints bands in order: parcel, route, structure', () => {
    const parcel = svg.indexOf('data-band="parcel"');
    const route = svg.indexOf('data-band="route"');
    const structure = svg.indexOf('data-band="structure"');
    expect(parcel).toBeGreaterThan(-1);
    expect(parcel).toBeLessThan(route);
    expect(route).toBeLessThan(structure);
  });

  it('draws every shadow in the structure band before any ink', () => {
    const lastShadow = svg.lastIndexOf('data-shadow="1"');
    const firstInk = svg.indexOf('data-ink="1"');
    expect(lastShadow).toBeLessThan(firstInk);
  });

  it('places one use per building', () => {
    const inks = svg.match(/data-ink="1"/g) ?? [];
    expect(inks).toHaveLength(model.buildings.length);
  });

  it('is deterministic', () => {
    expect(renderVillage(generateVillage(input, 2)))
      .toBe(renderVillage(generateVillage(input, 2)));
  });

  // --- R17: standalone output ---

  it('embeds a <defs> block with a <g id> for every glyph actually used, plus its -sil twin', () => {
    const usedGlyphs = Array.from(new Set(model.buildings.map((b) => b.glyph)));
    expect(usedGlyphs.length).toBeGreaterThan(0);
    const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
    expect(defsMatch).not.toBeNull();
    const defs = defsMatch![1];
    for (const glyph of usedGlyphs) {
      expect(defs).toContain(`<g id="${glyph}"`);
      expect(defs).toContain(`<g id="${glyph}-sil"`);
    }
  });

  it('does not dump every glyph in the asset library into defs — only the ones used', () => {
    const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
    const defIds = Array.from(defsMatch![1].matchAll(/<g id="([^"]+)"/g)).map((m) => m[1]);
    const usedGlyphs = new Set(model.buildings.map((b) => b.glyph));
    for (const id of defIds) {
      const base = id.endsWith('-sil') ? id.slice(0, -4) : id;
      // every def id must trace back either to a used building glyph or the green fallback glyph
      if (base !== `${model.green.shape}-${model.green.variant}`) {
        expect(usedGlyphs.has(base)).toBe(true);
      }
    }
  });

  it('every <use> in the document resolves to a <g id> defined in <defs> (standalone)', () => {
    const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
    const defIds = new Set(Array.from(defsMatch![1].matchAll(/<g id="([^"]+)"/g)).map((m) => m[1]));
    const useHrefs = Array.from(svg.matchAll(/<use[^>]*href="#([^"]+)"/g)).map((m) => m[1]);
    expect(useHrefs.length).toBeGreaterThan(0);
    for (const href of useHrefs) {
      expect(defIds.has(href)).toBe(true);
    }
  });

  // --- Regression: <symbol> viewport-scaling footgun ---
  // A <use> of a <symbol viewBox="..."> with no explicit width/height on
  // the <use> defaults to 100% of the outer viewport before the use's own
  // transform applies — every glyph rendered as a canvas-filling
  // silhouette (a solid black mass), because our <use> elements carry only
  // a transform, no width/height. Fixed by emitting <g id> instead of
  // <symbol> in defs, which has no viewport semantics at all. Pinned here
  // so a future edit cannot reintroduce <symbol> without this failing.
  it('never emits an SVG <symbol> element — <g id> has no viewport semantics to trip over', () => {
    expect(svg).not.toContain('<symbol');
  });

  // --- R17: green fallback ---

  it('falls back to a plain stand-in shape for the green when its glyph is not ingested', () => {
    // batch-002 greens are not in this repo's asset set yet
    expect(hasGlyph(`${model.green.shape}-${model.green.variant}`)).toBe(false);
    expect(svg).toContain('data-green-fallback="1"');
    // and does not emit a <use> for a green glyph that doesn't exist
    expect(svg).not.toContain(`href="#${model.green.shape}-${model.green.variant}"`);
  });

  it('places the green fallback in the parcel band', () => {
    const parcelBand = svg.slice(svg.indexOf('data-band="parcel"'), svg.indexOf('</g>', svg.indexOf('data-band="parcel"')));
    expect(parcelBand).toContain('data-green-fallback="1"');
  });

  // --- Regression: unstyled sm-* classes render as solid black rectangles ---
  // BATCH001_GLYPHS markup uses bare class="sm-stone" / "sm-timber" / etc.
  // with no stylesheet, so every fill/stroke falls back to SVG defaults
  // (solid black fill, no stroke) — buildings read as a field of identical
  // black blocks instead of buildings. A <style> block defining these
  // classes fixes that; pinned here so it cannot silently disappear.
  it('emits a <style> block defining the sm-* material classes the deck uses', () => {
    const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const style = styleMatch![1];
    for (const cls of ['.sm-stone', '.sm-timber', '.sm-void', '.sm-ridge', '.sm-hatch']) {
      expect(style).toContain(`${cls}{`);
    }
  });

  it('does not let the sm-* style rules leak colour into shadow silhouettes', () => {
    // The shadow contract requires flat, offset, single-colour silhouettes.
    // Several of BATCH001_GLYPHS' -sil twins duplicate the body's classed
    // elements (stone rect, ridge line, hatch texture) rather than being a
    // single flat currentColor shape, so the style block must override
    // fill/stroke back to currentColor for anything nested under .sm-sil —
    // otherwise a shadow would render as a coloured, outlined replica of
    // the building instead of a flat silhouette.
    const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
    const style = styleMatch![1];
    expect(style).toMatch(/\.sm-sil \.sm-stone[^}]*\{[^}]*fill:currentColor/);
  });

  // --- Regression: viewBox omitted lane geometry, so roads ran off-canvas ---
  // Bounds were computed from building positions and the green centre only.
  // Ruling R15 leaves arm- lanes (FMG's incoming roads) deliberately
  // untrimmed — they run out to roughly builtRadius * 2 past the green
  // whether or not anything is built along them — so a lane can extend
  // well past every building, and the viewBox silently clipped it. A
  // multi-road, low-population input (which leaves the untrimmed arms most
  // exposed relative to the built cluster) reproduces it reliably; the
  // single-bearing default used by the other tests in this file does not,
  // which is exactly what let this ship the first time.
  describe('viewBox covers every lane point (regression: roads running off-canvas)', () => {
    const multiRoadInput: AzgaarBurgInput = {
      name: 'Three Roads', population: 40, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [
        { bearing_deg: 20, kind: 'road' },
        { bearing_deg: 150, kind: 'road' },
        { bearing_deg: 260, kind: 'road' },
      ],
    };

    for (let seed = 1; seed <= 5; seed++) {
      it(`seed ${seed}: every building and every lane point falls within the viewBox`, () => {
        const pxPerMetre = 4;
        const m = generateVillage(multiRoadInput, seed);
        const rendered = renderVillage(m, pxPerMetre);
        const dims = rendered.match(/^<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/);
        expect(dims).not.toBeNull();
        const width = Number(dims![1]);
        const height = Number(dims![2]);

        const lanePoints = m.lanes.flatMap((lane) => lane.points);
        const allPoints = m.buildings.map((b) => b.position).concat(m.green.centre, lanePoints);

        // Reproduce the renderer's own coordinate mapping to check every
        // world point actually lands inside the declared viewBox.
        const pad = 40;
        const xs = allPoints.map((p) => p.x);
        const ys = allPoints.map((p) => p.y);
        const minX = Math.min(...xs) - pad;
        const minY = Math.min(...ys) - pad;

        for (const p of allPoints) {
          const px = (p.x - minX) * pxPerMetre;
          const py = (p.y - minY) * pxPerMetre;
          expect(px).toBeGreaterThanOrEqual(0);
          expect(px).toBeLessThanOrEqual(width);
          expect(py).toBeGreaterThanOrEqual(0);
          expect(py).toBeLessThanOrEqual(height);
        }
      });
    }
  });
});
