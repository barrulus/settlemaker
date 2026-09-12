# SettleMaker documentation

These guides describe the 3.0.x npm library. The declarations shipped in `dist/`
and the corresponding [source](../src/index.ts) are the complete type reference.

## Start here

- [Getting started](getting-started.md): install, generate a map, use TypeScript or a browser.
- [Gallery](gallery.md): current output across five biomes and both planners, plus Copperline.
- [Library API](api.md): input fields, engine selection, options, errors and reproducibility.
- [GeoJSON and coordinates](geojson.md): schema 4, local units, IDs, road geometry and tiling.

## Create a setting

- [Skin authoring](skins.md): portable JSON, SVG slots, biome inheritance and validation.
- [Skin JSON schema](skins.schema.json): editor assistance for skin format 1.
- [Current symbol library](current-symbol-library.md): downloadable collections versus runtime slots.
- [Artwork integration](artwork-integration.md): how the planners place the current artwork.
- [Copperline](../symbols/copperline/README.md): a complete example skin for technological settings.

## Integrate an application

- [URL adapter contract](url-api.md): compressed inputs and presentation parameters for `/fmg` hosts.
- [Water context v1](water-context-v1.md): measured village water, precision, precedence and errors.
- [Scene and rendering](scene-schema.md): city Scene v2, appearance controls and SVG embedding.
- [Embedding and zoom](fmg-embed-zoom.md): responsive previews and host-owned navigation.

## Maintain the project

- [Development](development.md): build, checks, documentation images and release workflow.
- [Example URLs](test-urls.md): reproducible fixtures for integration checks.
- [3.0.1](releases/3.0.1.md) and [3.0.0](releases/3.0.0.md) release notes.

## Contract versions

| Contract | Current value | Meaning |
| --- | --- | --- |
| npm package | 3.0.1 | A specific engine and documentation release. |
| GeoJSON `metadata.schema_version` | 4 | Output structure; both planners share this number. |
| City `Scene.version` | 2 | Semantic city scene; villages do not use this scene type. |
| URL envelope `v` | 1 | Compressed burg input for a URL adapter. |
| Skin `version` | 1 | Portable artwork and biome definition. |
| `waterContext.version` | 1 | Measured-water input, supported for villages only. |

A shared schema version does not imply identical fields in every engine's feature
properties. Check the [output reference](geojson.md) before sharing a renderer.
Cache against the package version, inputs, seed and rendering/skin configuration.

## Historical material

[Schema v3](schema-v3.md) records an earlier city-output migration. Files under
`plans/`, `superpowers/`, and older release notes record design discussions and
past behaviour; they are not the current API specification. Start from the guides
above when building a new integration.
