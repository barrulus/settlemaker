# Authoring settlement skins

A skin is a versioned JSON document containing SVG artwork, material colours,
and optional named biomes. The same skin works with villages and cities in Node
and the browser. Load it once with `createSkin`, then pass it per request:

```ts
import { createSkin, generateSettlement } from 'settlemaker';

// Browser example. Applications choose where to store/host their skin files.
const response = await fetch('/skins/moon-glass.skin.json');
if (!response.ok) throw new Error('Could not load skin');
const skin = createSkin(await response.json());

const result = generateSettlement(
  { ...burg, biome: 'moon-wastes' },
  { seed: 42, skin },
);
```

In Node, pass `JSON.parse(await readFile(path, 'utf8'))` to `createSkin`.
There is no global registry, automatic network access, or executable plugin code.
Keep the original JSON to save or distribute the skin; the returned skin is an
immutable runtime handle. Invalid definitions throw an error naming the property.

Start with [Moon Glass](examples/moon-glass.skin.json), a small working example
that replaces snowy dwellings with crystal homes and colours their surroundings.
Everything it omits inherits the bundled artwork. Use the
[JSON Schema](skins.schema.json) for editor assistance; `createSkin` additionally
checks artwork slots, SVG fragments, aliases, and numeric values at runtime.

For a complete technological set, use [Copperline](../symbols/copperline/README.md)
([JSON](examples/copperline.skin.json), [SVG preview](../symbols/copperline/preview.svg)).
It replaces all 91 slots and includes `industrial`, `steampunk`, and `modern`
biome presets, all using the existing temperate terrain behaviour.

## Version 1 format

| Property | Meaning |
| --- | --- |
| `version` | Required integer `1`; unsupported versions are rejected. |
| `id` | Required lowercase slug, e.g. `moon-glass`. |
| `name` | Required nonempty display name. |
| `glyphs` | Optional map of exact engine artwork slot IDs to `{body, sil?}`. |
| `tokens` | Optional material CSS properties such as `--sm-ink`. |
| `village` | Optional ground, water, waterEdge, shadowColor, shadowOpacity overrides. |
| `city` | Optional `RenderTheme` overrides, including paper, roadCore, greenFill. |
| `biomes` | Optional map of named biome presets. |

Each biome has a required `base`: `temperate`, `desert`, `tundra`, `tropical`,
`coastal`, or `steppe`. It can also contain `aliases`, `glyphs`, `tokens`,
`village`, and `city`. Biome keys are lowercase slugs; input names and aliases
are trimmed and matched without case sensitivity. Custom names/aliases take
precedence over the built-in FMG vocabulary. Existing biome names can themselves
be overridden. Unknown names retain the engine's temperate fallback.

The base chooses the existing terrain behaviour: dwelling selection, field and
vegetation decks, and boundary choices. Artwork replaces the resulting slots.
For example, a lunar biome based on tundra replaces `sm-house--tundra`, not
`sm-house`. The returned model and GeoJSON retain the effective base biome and
semantic IDs. Store the skin ID and requested custom biome alongside saved inputs.

Precedence is bundled defaults → skin defaults → selected biome → explicit
renderer overrides. Each glyph replacement is a whole artwork replacement;
omitting `sil` removes that glyph's shadow rather than inheriting an unrelated
silhouette. `tokens` work in both engines; use `village` and `city` to style their
respective geometry. An explicit city palette re-derives the complete city theme
and its six standard material colours; explicit city theme properties override
only the named values. Material properties in `city` override the corresponding
tokens. An explicit `VillageTheme` replaces the skin's village theme in full.

## SVG authoring contract

The public `SKIN_SLOTS` catalog describes every supported slot, including its
`viewBox`, `anchor`, metre `footprint`, `rotation`, `zBand`, and `minScale`.
`SKIN_TOKENS` lists the built-in material defaults. Inspect them in your tooling:

```ts
import { SKIN_SLOTS, SKIN_TOKENS } from 'settlemaker';
console.log(SKIN_SLOTS['sm-house']);
console.log(SKIN_TOKENS);
```

The source [symbol manifest](../symbols/refined/symbols.json) and
[sprite sheets](../symbols/refined/) are visual references. The older integration
notes describe the bundled artwork; this document is the skin loading contract.

1. Draw inside the slot's existing coordinate system, usually `0 0 64 64`
   centred at `(32,32)`. Check the catalog: marks can have a different box.
2. Export **inner SVG elements** into `body`; remove the outer `<svg>` or
   `<symbol>`, XML declaration, editor metadata, and embedded stylesheets.
3. Preserve the slot's orientation and painted margins. The placement engine
   budgets ordinary house ink to 68% of its footprint and hut ink to 85%; oversized
   artwork can overlap neighbours even when its SVG fits the art box. Use the
   original slot as the sizing template. Version 1 does not change footprints,
   anchors, occupancy, rotation rules, or placement algorithms.
4. Use explicit presentation attributes. Material colours should use
   `fill="var(--sm-stone, #e8dcc0)"` (and equivalent stroke attributes).
   Always include a fallback. Both renderers rewrite fallbacks for skin tokens
   so rasterizers without CSS variable support receive the selected colours.
5. For a structure shadow, supply a flat silhouette in `sil` using
   `fill="currentColor"`. Do not bake in the shadow offset; the renderer positions
   and colours it. Parcel artwork needs no silhouette.
6. Field tiles must repeat seamlessly in both axes. Edge stamps repeat along
   their local x-axis. The engine supplies pattern scaling, rotation, and clipping.

Supported elements: `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
`polygon`, `defs`, `clipPath`. Supported attributes cover geometry (`d`, `points`,
coordinates, sizes, radii, `transform`), `id`, `class`, fill/stroke and their opacity,
width, linecap, linejoin, miterlimit, dasharray, dashoffset and rule attributes,
`opacity`, `color`, `clip-path`, `clipPathUnits`, and `vector-effect`.

Local clipping uses `clip-path="url(#local-id)"` and a `clipPath` defined in the
same fragment. IDs are automatically prefixed per slot and fragment to prevent
collisions. Cross-fragment references are unsupported. SVG scripts, event handlers,
stylesheets, `style` attributes, text/fonts, images, `use`, animation, filters,
external resources, XML entities, and document wrappers are rejected. Convert text
or complex effects to paths before packaging. Each fragment is limited to 250,000
characters. Theme colours use hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or
`none`, `transparent`, `currentColor`; numeric values must be finite.

## Coverage and compatibility

A partial skin is useful immediately. For complete replacement, cover all slots
used by the selected base biomes, including their dwelling variants, landmarks,
trees, greens, field tiles, and edge stamps. Replacement keys match exact slots;
replacing `sm-house` does not replace its biome variants. Catalog entries describe
available artwork; the generator only paints assets used by the current model.
Some features are generated geometry: city walls/roads/building fallbacks and the
village's junction-shaped green, bridges, and road surfaces. Skin colour options
cover the exposed theme properties; these features are not all SVG asset slots.

The normal generation pipeline and semantic GeoJSON remain intact. Changing only
artwork or colours preserves the settlement layout for the same seed and biome
base. A different biome base can change layout through its existing dwelling and
landscape rules. Novel terrain algorithms or new placement categories require
engine extensions beyond skin version 1.

`generateFromBurg(burg, {skin})` also supports skins directly. For existing models:

```ts
generateSvg(cityModel, { skin, skinBiome: 'moon-wastes' });
renderVillage(villageModel, 4, undefined, { skin, skinBiome: 'moon-wastes' });
assembleSvg(scene, { skin, skinBiome: 'moon-wastes' });
```

These lower-level functions only render: generate the model with the desired base
biome first. `skinBiomeFor(skin, requestedName)` returns `{name, base}` for that
purpose. Omitting `skinBiome` uses the model/scene biome. Existing calls without a
skin retain their defaults. The city renderer's lower-level `assetSet` option takes
precedence over the skin's artwork.

Skins are currently a library API. A hosting application can add a picker or load
its own curated files; the URL codec does not serialize skin artwork or fetch skin
URLs. Distribute your original artwork with your chosen licence information. For
artwork derived from the bundled symbols, consult [symbols/LICENSE](../symbols/LICENSE).
