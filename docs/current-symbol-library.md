# Current symbol library

SettleMaker 3.0.x ships six default artwork collections containing **852 drawings**.
These are the current authoring and download sources, distinct from the runtime
slots used by the generator and by portable skins.

| Collection | Drawings | Contents | Manifest |
| --- | ---: | --- | --- |
| Village | 49 | Rural dwellings and village forms | [symbols.json](../symbols/village/symbols.json) |
| City | 170 | Urban buildings, religious forms and landmark kits | [symbols.json](../symbols/city/symbols.json) |
| Infrastructure | 165 | Walls, gates, bridges, henges and supporting structures | [symbols.json](../symbols/infrastructure/symbols.json) |
| Landscape | 372 | Flora, field textures and agricultural forms | [symbols.json](../symbols/landscape/symbols.json) |
| Greens | 60 | Biome-specific green and ground variants | [symbols.json](../symbols/greens/symbols.json) |
| Markers | 36 | Map markers, separate from automatic settlement placement | [markers.json](../symbols/markers/markers.json) |

Counts exclude structure silhouettes and combined sprites. Every drawing has a
standalone SVG: markers sit directly in their collection directory; the other
collections use `individual/`. View boxes vary; preserve their aspect ratios.
A drawing's presence in a download does not promise the engine automatically
places it or that a portable skin can add a new placement category.

## Runtime slots and portable skins

The public `SKIN_SLOTS` catalogue contains **693 supported runtime slots**,
including compatibility IDs. It provides each slot's view box, anchor, footprint,
rotation, z-band and minimum scale. Use it as the exact contract when replacing
engine artwork. For example, some native field slots use 32-unit art boxes even
when other authoring assets have larger coordinate systems.

```js
import { SKIN_SLOTS, SKIN_TOKENS } from 'settlemaker';
console.log(Object.keys(SKIN_SLOTS).length);
console.log(SKIN_SLOTS['sm-house']);
console.log(SKIN_TOKENS);
```

The current city default is `SETTLEMENT_SET`. Some older exports in `src/assets`
remain for compatibility and shared placement metadata; they are not additional
download collections. The retired `symbols/batch001` and `symbols/refined`
directories are not required for skin authoring or current source generation.

[Skin authoring](skins.md) explains inert SVG fragments, tokens, silhouettes,
partial coverage and inherited biomes. [Artwork integration](artwork-integration.md)
explains how existing planners select and fit the drawings. The [gallery](gallery.md)
shows actual public-API output rather than assembled catalogue illustrations.

## Copperline

[Copperline](../symbols/copperline/README.md) is a separate, complete example skin.
It maps 47 original drawings and shared variants across all 693 runtime slots,
with industrial, steampunk and modern presets. It is not included in the 852
count for the six default collections.

## Source and licensing

Collection authoring lives under `scripts/art/` and the `build-*-symbols.mjs`
scripts. `scripts/build-runtime-art.mjs` compiles the current reviewed assets and
placement measurements into browser-safe source modules. See
[regeneration](artwork-integration.md#source-and-regeneration).

The six default collections use [CC BY 4.0 with a rendered-output exception](../symbols/LICENSE),
with attribution in [CREDITS](../symbols/CREDITS). Copperline uses the repository's
[GPL-3.0-only license](../LICENSE). The engine's code license and the default
artwork license are separate; `NOTICE` records the scopes and provenance.
