import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import { hasGlyph } from '../../src/village/glyphs.js';
import { classRank } from '../../src/village/route-class.js';
import { RENDER_MINOR_LANE_WIDTH_SHARE } from '../../src/village/constants.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

// Fix round 1 (2026-08-21): field/wedge ids can legitimately carry regex
// metacharacters (`wedge:<laneIdA>|<laneIdB>`'s `|`, per the fields design
// brief -- not a bug in the id scheme). Every id interpolated into
// `new RegExp(...)` below must be escaped, or a `|` reads as alternation
// and silently matches the wrong markup instead of failing to compile.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const input: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('renderVillage', () => {
  const model = generateVillage(input, 1);
  /** renderVillage's own default; pinned here so the stroke-width maths below
   * converts painted pixels back to metres against the same scale. */
  const PX_PER_M = 4;
  const svg = renderVillage(model);

  it('emits a single svg document with the tiler background contract', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-bg="paper"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('paints water, in its own band beneath everything the village built', () => {
    // Phase 2: `render.ts` contained the word "water" zero times. The model
    // has always known about water -- it keeps lots, lanes, fields and trees
    // out of it -- but nothing drew it, so every coastal render was a
    // village with an unexplained bite out of it, and we were judging those
    // renders blind.
    const coastal = generateVillage({
      ...input,
      coastlineGeometry: [[
        { x: -600, y: 40 }, { x: 600, y: 40 }, { x: 600, y: 600 }, { x: -600, y: 600 },
      ]],
    } as AzgaarBurgInput, 1);
    expect(coastal.site.water.length).toBeGreaterThan(0);
    const wet = renderVillage(coastal);

    expect(wet).toContain('data-band="water"');
    // Beneath the fields, the roads and the parcels -- water is ground, and
    // everything the village put down sits on top of it.
    expect(wet.indexOf('data-band="water"'))
      .toBeLessThan(wet.indexOf('data-band="parcel-fields"'));
    expect(wet.indexOf('data-band="water"')).toBeLessThan(wet.indexOf('data-band="route"'));
    // ...and above the paper, which is the tiler's crop contract.
    expect(wet.indexOf('data-bg="paper"')).toBeLessThan(wet.indexOf('data-band="water"'));
    // One painted shape per drawable water polygon.
    const drawable = coastal.site.water.filter((poly) => poly.length >= 3).length;
    expect(drawable).toBeGreaterThan(0);
    expect((wet.match(/data-water="/g) ?? []).length).toBe(drawable);
  });

  it('leaves a landlocked village byte-identical', () => {
    // Phase 2's acceptance bar. The hash was taken from the renderer BEFORE
    // the water band existed, so this pins that a dry village gained
    // nothing at all -- not an empty group, not a stray newline.
    const dry = generateVillage({
      name: 'Dry', population: 300, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    } as AzgaarBurgInput, 1);
    expect(dry.site.water).toHaveLength(0);
    const svg = renderVillage(dry);
    expect(svg).not.toContain('data-band="water"');
    // The hash moved when Phase 6 added the alignment frame
    // (`data-origin-x/y`, `data-px-per-metre`) to the root element. The
    // PICTURE did not: stripping those three attributes reproduces the
    // original hash exactly, which is asserted below rather than asserted
    // away by simply re-pinning. `d0b2f407...` is the pre-change value,
    // taken before the water band or theming existed.
    const stripped = svg.replace(
      / data-origin-x="[-0-9.]+" data-origin-y="[-0-9.]+" data-px-per-metre="[-0-9.]+"/, '',
    );
    // The hash moved AGAIN when resolved fills landed: `var(--sm-x, <fallback>)`
    // now carries the resolved token value instead of the glyph's own. The
    // PICTURE still did not move -- a browser resolves the variable in both
    // cases and paints the identical colour -- so the fallback is normalised
    // away and the ORIGINAL hash is reproduced under that normalisation
    // rather than re-pinned. `29020286...` is the pre-change value with both
    // the alignment frame and the fallbacks stripped; erasing only the frame
    // still gives `d0b2f407...` on the pre-change renderer, which is how this
    // value was derived.
    const normalised = stripped.replace(/var\((--[a-z0-9-]+)\s*,\s*[^)]*\)/gi, 'var($1)');
    expect(createHash('sha256').update(normalised).digest('hex'))
      .toBe('29020286752231d733c1f7e6bdd28c5a89238460e62945f16b454579c4907f86');
  });

  it('carries the contract circle radius for consumers to align against', () => {
    // Task 10 (spec 5.5, "boundary alignment"): every FMG route meets the
    // contract circle at its exact bearing, so a consumer that knows the
    // circle's radius can line our tile up with FMG's own route lines. The
    // radius is the one thing it cannot recover from the drawing, so the
    // SVG states it. `data-bg="paper"` is settlement-tiler's existing crop
    // contract and must survive untouched beside it.
    const match = /data-contract-radius="([0-9.]+)"/.exec(svg);
    expect(match, 'no data-contract-radius on the rendered SVG').not.toBeNull();
    expect(Number(match![1])).toBeCloseTo(model.contractRadiusM, 2);
    expect(model.contractRadiusM).toBeGreaterThan(0);
    expect(svg).toContain('data-bg="paper"');
  });

  it('paints roads first and the green over them (gate-2 band order)', () => {
    // Gate 2: "roads should go under the green". Route band paints first,
    // the green's parcel band paints over it — lane geometry runs into the
    // green's interior, so each road visibly disappears beneath the turf.
    const route = svg.indexOf('data-band="route"');
    const parcel = svg.indexOf('data-band="parcel"');
    const structure = svg.indexOf('data-band="structure"');
    expect(route).toBeGreaterThan(-1);
    expect(route).toBeLessThan(parcel);
    expect(parcel).toBeLessThan(structure);
  });

  it('pass 5: parcel-fields band (the field ring) paints before the route band, canopy after structure', () => {
    const parcelFields = svg.indexOf('data-band="parcel-fields"');
    const route = svg.indexOf('data-band="route"');
    const structure = svg.indexOf('data-band="structure"');
    const canopy = svg.indexOf('data-band="canopy"');
    expect(parcelFields).toBeGreaterThan(-1);
    expect(canopy).toBeGreaterThan(-1);
    expect(parcelFields).toBeLessThan(route);
    expect(structure).toBeLessThan(canopy);
  });

  it('draws every shadow in the structure band before any ink IN THAT BAND', () => {
    const structureStart = svg.indexOf('data-band="structure"');
    const structureEnd = svg.indexOf('data-band="canopy"');
    const structureBand = svg.slice(structureStart, structureEnd);
    const lastShadow = structureBand.lastIndexOf('data-shadow="1"');
    const firstInk = structureBand.indexOf('data-ink="1"');
    expect(lastShadow).toBeGreaterThan(-1);
    expect(lastShadow).toBeLessThan(firstInk);
  });

  it('draws every canopy shadow before any canopy ink, after the structure band', () => {
    const canopyBand = svg.slice(svg.indexOf('data-band="canopy"'));
    const lastShadow = canopyBand.lastIndexOf('data-shadow="1"');
    const firstInk = canopyBand.indexOf('data-ink="1"');
    if (model.vegetation.length > 0) {
      expect(lastShadow).toBeGreaterThan(-1);
      expect(lastShadow).toBeLessThan(firstInk);
    }
  });

  it('places one building-ink use per building', () => {
    const inks = svg.match(/data-ink="1" data-kind="building"/g) ?? [];
    expect(inks).toHaveLength(model.buildings.length);
  });

  it('places one poi-ink use per POI, inside the structure band', () => {
    const structureStart = svg.indexOf('data-band="structure"');
    const structureEnd = svg.indexOf('data-band="canopy"');
    const structureBand = svg.slice(structureStart, structureEnd);
    const inks = structureBand.match(/data-ink="1" data-kind="poi"/g) ?? [];
    expect(inks).toHaveLength(model.pois.length);
    for (const poi of model.pois) {
      expect(structureBand).toContain(`data-id="${poi.id}"`);
    }
  });

  it('is deterministic', () => {
    expect(renderVillage(generateVillage(input, 2)))
      .toBe(renderVillage(generateVillage(input, 2)));
  });

  // Task 8: guards against a renderer that silently ignores its input (e.g.
  // a stray global/cache) by pinning that two DIFFERENT seeds, same
  // fixture, produce different SVG bytes. The byte-identical-for-the-SAME-
  // seed half of this contract is already covered by the 'is deterministic'
  // test above (full renderVillage(generateVillage(...)) pipeline, pop 300).
  it('renders different bytes for different seeds (same input)', () => {
    expect(renderVillage(generateVillage(input, 1)))
      .not.toBe(renderVillage(generateVillage(input, 2)));
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
    // Field crop glyphs' own vendored artwork embeds a nested content id
    // (e.g. `<g id="c-sm-field-plough">`, wrapping the tile's clipped
    // content) INSIDE the glyph's own <g id> body -- an implementation
    // detail of that glyph's markup, not a second top-level def. Only
    // field glyphs carry this `c-` prefix convention; excluded here so the
    // "every def traces to something used" check isn't tripped by a glyph
    // reaching into its own body.
    const defIds = Array.from(defsMatch![1].matchAll(/<g id="([^"]+)"/g))
      .map((m) => m[1])
      .filter((id) => !id.startsWith('c-'));
    // Pass 5 widens "used" to every category the renderer can place: buildings,
    // POIs, edge stamps, field-tile pattern content, and trees.
    const usedGlyphs = new Set([
      ...model.buildings.map((b) => b.glyph),
      ...model.pois.map((p) => p.glyph),
      ...model.fieldEdges.map((e) => e.glyph),
      ...model.fields.map((f) => f.glyph),
      ...model.vegetation.map((v) => v.glyph),
    ]);
    for (const id of defIds) {
      const base = id.endsWith('-sil') ? id.slice(0, -4) : id;
      // every def id must trace back either to a used glyph above or the green fallback glyph
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

  // --- R17 retired: the refined greens are ingested ---

  it('draws the real green glyph, not a stand-in shape', () => {
    // The refined manifest carries every green shape/variant the deck can
    // produce (sm-green-round-a and friends), so hasGlyph is true and the
    // renderer emits a real <use>, not the old plain-ellipse fallback.
    expect(hasGlyph(`${model.green.shape}-${model.green.variant}`)).toBe(true);
    expect(svg).not.toContain('data-green-fallback="1"');
    expect(svg).toContain(`href="#${model.green.shape}-${model.green.variant}"`);
  });

  it('places the green use in the parcel band', () => {
    const parcelBand = svg.slice(svg.indexOf('data-band="parcel"'), svg.indexOf('</g>', svg.indexOf('data-band="parcel"')));
    expect(parcelBand).toContain(`href="#${model.green.shape}-${model.green.variant}"`);
  });

  // --- Regression: unstyled sm-* classes render as solid black rectangles ---
  // REFINED_GLYPHS markup uses bare class="sm-stone" / "sm-timber" / etc.
  // Fill classes carry an inline `fill="var(--sm-x, #hex)"` fallback, but
  // never a stroke, so without a <style> block a building would render
  // filled but borderless, and a hatch/ridge line class (no fill attr at
  // all) would default to a solid black SVG fill instead of a line. Pinned
  // here so the stylesheet cannot silently disappear.
  it('emits a <style> block defining the sm-* ink classes the deck uses', () => {
    const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const style = styleMatch![1];
    for (const cls of ['.sm-stone', '.sm-timber', '.sm-void', '.sm-ridge', '.sm-hatch']) {
      expect(style).toContain(`${cls}{`);
    }
  });

  it('does not need a shadow colour override — every -sil twin is already a flat currentColor shape', () => {
    // Unlike batch001, no -sil in the refined set duplicates the body's
    // classed children (verified by extract-refined-glyphs's structure-band
    // sil requirement), so there is nothing for the style block to
    // override — this pins that the render still honours the shadow
    // contract (flat, single-colour) with no override rule present.
    const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
    const style = styleMatch![1];
    expect(style).not.toContain('.sm-sil');
    for (const glyph of Array.from(new Set(model.buildings.map((b) => b.glyph)))) {
      const silMatch = svg.match(new RegExp(`<g id="${escapeRegExp(glyph)}-sil">([\\s\\S]*?)</g>`));
      expect(silMatch).not.toBeNull();
      expect(silMatch![1]).toContain('fill="currentColor"');
    }
  });

  // --- Pass 5: parcel dressing (the field ring and the tree scatter) ---

  it('emits a <pattern> def with explicit width/height/patternUnits for every field strip, and the strip references it', () => {
    if (model.fields.length === 0) return;
    const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
    const defs = defsMatch![1];
    const patternIds = new Set(
      Array.from(defs.matchAll(/<pattern id="([^"]+)"[^>]*>/g)).map((m) => m[1]),
    );
    expect(patternIds.size).toBeGreaterThan(0);
    for (const patternMarkup of defs.matchAll(/<pattern [^>]*>/g)) {
      const tag = patternMarkup[0];
      expect(tag).toMatch(/width="[\d.]+"/);
      expect(tag).toMatch(/height="[\d.]+"/);
      expect(tag).toContain('patternUnits="userSpaceOnUse"');
    }
    for (const field of model.fields) {
      const fieldMarkup = svg.match(new RegExp(`data-field="${escapeRegExp(field.id)}"[^>]*fill="url\\(#([^)]+)\\)"`));
      expect(fieldMarkup).not.toBeNull();
      expect(patternIds.has(fieldMarkup![1])).toBe(true);
    }
  });

  // Gate 5 (2026-08-22): crofts are CLAIMS ONLY -- never painted, no tint,
  // no boundary stamps. Owner's verdict: hedged garden crofts read as "huge
  // private fields ... you'd have fields AROUND the village, not INSIDE the
  // village." The claim survives only to keep the tree scatter off the
  // ground behind each house.
  it('paints no croft at all: no tint class, no croft path, no croft-derived stamp', () => {
    expect(model.crofts.length).toBeGreaterThan(0);
    expect(svg).not.toContain('sm-croft');
    expect(svg).not.toContain('data-croft=');
    for (const croft of model.crofts) {
      expect(svg).not.toContain(croft.id);
    }
  });

  // Gate 5.3: minor streets recede in the PAINT only. The wagon classes
  // keep their true width (an inter-settlement road is a real road); the
  // classes a village invents for itself are drawn thinner, so lanes read
  // as tracks between the houses rather than as the widest thing on the
  // page. lane.widthM itself is untouched, which this pins by comparing
  // the painted stroke against the model's own width.
  it('paints minor lanes narrower than their geometric width, wagon roads at full width', () => {
    let checkedMinor = 0;
    let checkedWagon = 0;
    for (const lane of model.lanes) {
      const m2 = svg.match(new RegExp(`data-lane="${escapeRegExp(lane.id)}"[^>]*stroke-width="([\\d.]+)"`));
      expect(m2).not.toBeNull();
      const paintedM = Number(m2![1]) / PX_PER_M;
      if (classRank(lane.type) < classRank('local')) {
        checkedWagon += 1;
        expect(paintedM).toBeCloseTo(lane.widthM, 2);
      } else {
        checkedMinor += 1;
        expect(paintedM).toBeCloseTo(lane.widthM * RENDER_MINOR_LANE_WIDTH_SHARE, 2);
        expect(paintedM).toBeLessThan(lane.widthM);
      }
    }
    expect(checkedMinor + checkedWagon).toBe(model.lanes.length);
    expect(checkedMinor).toBeGreaterThan(0);
  });

  it('places every edge stamp in the parcel-fields band with no shadow', () => {
    const parcelFieldsBand = svg.slice(
      svg.indexOf('data-band="parcel-fields"'), svg.indexOf('</g>', svg.indexOf('data-band="parcel-fields"')),
    );
    const edgeStamps = [...model.fieldEdges];
    for (const stamp of edgeStamps) {
      expect(parcelFieldsBand).toContain(`data-edge="${stamp.id}"`);
    }
    expect(parcelFieldsBand).not.toContain('data-shadow');
  });

  it('scales a tree by its footprint AND its per-tree scale jitter', () => {
    const scaledTree = model.vegetation.find((v) => v.scale !== undefined && v.scale !== 1);
    if (!scaledTree) return; // no jittered tree in this fixture/seed — nothing to pin
    const inkMatch = svg.match(new RegExp(`data-id="${escapeRegExp(scaledTree.id)}"[^>]*transform="([^"]+)"`));
    expect(inkMatch).not.toBeNull();
    const scaleMatch = inkMatch![1].match(/scale\(([\d.]+)\)/);
    expect(scaleMatch).not.toBeNull();
    // Not scale(1) exactly (footprint-normalised) unless the jitter and
    // footprint ratio happen to cancel out — assert it differs from the
    // un-jittered (scale=1) tree's own factor when one exists for contrast.
    const plainTree = model.vegetation.find((v) => v.glyph === scaledTree.glyph && (v.scale ?? 1) === 1);
    if (plainTree) {
      const plainInk = svg.match(new RegExp(`data-id="${escapeRegExp(plainTree.id)}"[^>]*transform="([^"]+)"`));
      const plainScale = plainInk![1].match(/scale\(([\d.]+)\)/);
      expect(scaleMatch![1]).not.toBe(plainScale![1]);
    }
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
