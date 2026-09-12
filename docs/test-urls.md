# Reproducible example URLs

The [current gallery](gallery.md) is the public example set for 3.0.x. Its images
are generated with `generateSettlement`, so population ≤1,000 uses the village
planner instead of forcing small inputs through the city generator.

Each entry includes its population, seed, full SVG and (where supported) a hosted
preview URL. [fixtures.json](examples/gallery/fixtures.json) records the complete
burg inputs, generator version and skin choice. Use those inputs with your pinned
npm package for exact local reproduction; a hosted URL uses the website's deployed
build and can change appearance when that site updates.

## Generate links

Use the public `encodeBurgParam` helper described in the [URL contract](url-api.md).
Supply the complete input and an explicit seed. Route IDs and measured water
require the compressed input tier; the flat tier cannot preserve them.

Copperline examples are direct library calls. The URL protocol does not transport
skins, so the gallery links those examples to their generated SVG and skin JSON
instead of presenting a URL that would silently show default artwork.

## Regenerate and review

```sh
npm ci
npm run docs:images
npm run docs:check
```

The image command regenerates PNG and SVG files together and rewrites the gallery
and fixture manifest. Review the actual maps before committing them. PNGs use the
SVG's supplied CSS-variable fallbacks for rasterizer compatibility.

The generator script is [scripts/generate-examples.mjs](../scripts/generate-examples.mjs).
Older development review fixtures in `scripts/generate-test-urls.ts` and previous
image files are historical aids, not the current documentation contract or a list
of unresolved defects. Current behaviour and limits are documented in the
[API](api.md), [GeoJSON reference](geojson.md) and [water contract](water-context-v1.md).
