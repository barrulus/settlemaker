# Settlemaker illustrated markers

36 newly drawn elevation markers with the original mk-* filenames, types and
64 × 64 viewBoxes. Transparent native SVG, with no raster images, fonts,
filters or external assets. These are standalone replacement assets; no
generator or web marker registry has been changed automatically.

Open index.html for the gallery and size/background/outline controls. Each
marker is available individually, and markers.svg provides the corresponding
<symbol> IDs. Use an external sprite with an SVG <use> element, for example:

```html
<svg width="32" height="32" viewBox="0 0 64 64" aria-label="Inn">
  <use href="markers.svg#mk-inns"/>
</svg>
```

markers.json retains the input manifest's pin and marker-type contract. The
original 30 px bubble / 55% glyph slot works; fine material details are best
seen at 30–46 px standalone or in a larger pin. All drawings are centred using
measured visible bounds, fitted to a 54-unit envelope within the 64-unit box.
Player party retains its distinctive red-and-gold pennant. No shadow twins
are needed: the pin supplies the ground.

Colours use CSS custom properties with explicit SVG fallbacks. Set the same
properties on an inline SVG or its parent to theme it. SVGs loaded through an
HTML img element use their own fallback colours.

Authoring source in the Settlemaker repository: scripts/art/markers.mjs.
Regenerate with node scripts/build-marker-symbols.mjs; validate with
node scripts/check-marker-symbols.mjs.

Artwork licensing: see LICENSE and CREDITS.
