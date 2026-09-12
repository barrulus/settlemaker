# Development and documentation

Use a source checkout for development and review commands. The npm tarball contains
compiled modules, source maps, TypeScript source, build inputs, public docs and
artwork, but is not a complete clone of the development repository.

## Build

```sh
git clone https://github.com/barrulus/settlemaker.git
cd settlemaker
npm ci
npm run build
npm run build:lib
```

The 3.0.x release checks use Node 24. A Nix flake is available with `nix develop`
if you prefer that environment; it is optional. No unlisted `tsx` command or
root-level smoke-test file is required.

`build` emits ESM JavaScript, declarations and source maps under `dist`.
`build:lib` creates the standalone ESM browser bundle. `npm pack` runs `prepack`,
which removes `dist` before rebuilding both formats so stale files cannot ship.
`npm run build` alone does not clean an existing output directory.

## Checks

```sh
npm run build
npm run typecheck:scripts
npm test -- --maxWorkers=2 --pool=threads
npm run docs:check
```

The thread-pool invocation passed the full release suite without the worker RPC
reporting timeout encountered in earlier runs with process workers. No assertions
are disabled by these options. Use focused test files while iterating, then the
appropriate release checks before publishing.

For artwork or geometry changes, use the public-API review tools:

```sh
npm run review:art
npm run review:roads
npm run review:cities
```

They write local galleries and measurements under ignored `output/` directories.
The public [artwork integration guide](artwork-integration.md) documents source
regeneration when SVG authoring changes. Review images as well as measurements.

## Documentation checks

```sh
npm run docs:images
npm run docs:check
```

`docs:images` builds the library and runs `scripts/generate-examples.mjs`. It
regenerates PNGs and SVGs together, the exact fixture manifest and `docs/gallery.md`.
All maps use `generateSettlement`; the displayed engine is checked against the
population. The same script supplies both the README images and the full gallery.
PNG previews resolve the renderer-provided CSS-variable fallbacks for librsvg.
Do not hand-replace gallery images with illustrations that bypass the engine.

`docs:check` checks current documentation links and anchors, release-pinned README
image paths, the fixture version and public API examples. It executes the README
quick start and skin example and typechecks the standalone TypeScript examples.
It also exercises the current URL/rendering examples and validates their outputs.
Historical plans and release notes are not treated as current API guidance.

Review the gallery at readable size, including the full SVGs. Version-pinned
absolute README image/documentation links work from npm as well as GitHub; update
their release tag when publishing the next documentation revision. They should
point to committed artifacts belonging to that version.

## Package verification

```sh
npm pack --pack-destination /tmp
```

Inspect the tarball's file list, then install that exact file in a fresh temporary
project with production dependencies only. Exercise Node ESM import, CommonJS
dynamic import, browser bundle import and strict NodeNext TypeScript compilation.
Generate both a village and a city, with and without a skin. Verify that source
maps resolve to packaged TypeScript source and that artwork LICENSE/CREDITS ship.

## Release workflow

1. Update `package.json`, lockfile and `SETTLEMAKER_VERSION` together; update the
   metadata assertions and release notes.
2. Regenerate documentation if the version or output changes, and run the checks.
3. Pack and verify the artifact in an isolated consumer.
4. Commit through a PR to protected `master`; tag the merged source.
5. Publish the verified tarball, completing npm's authentication when prompted.
6. Verify registry version, `latest` tag, integrity and a clean registry install;
   publish the matching GitHub release notes.

An npm version is immutable; README changes on npm require a new package version.
A website consuming this repository or package must update its own pin/dependency
and deploy separately. An npm release does not deploy `settlemaker.com`.
