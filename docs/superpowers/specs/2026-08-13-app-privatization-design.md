# App Privatization — the whole site goes private; the public repo becomes a pure library

**Date:** 2026-08-13 (late; follows the completed site/repo split)
**Status:** Approved intent, spec awaiting Barry's review
**Owner:** Barry
**Supersedes:** the boundary decision ("site wraps public code") of
`2026-08-13-site-repo-split-design.md`. Everything else from that spec —
private `settlemaker-web` wrapper, pinned submodule, single Netlify site —
stands.

## Motivation

The split's original intent was that ALL site code — pages, analytics
wiring, everything Barry regards as "the website" — lives in the private
repo, and the public repo is nothing but the settlemaker node library.
The executed split instead kept `web/` (builder, /fmg, umami/analytics
wiring) public, on the reasoning that each page ships one JS bundle
fusing app code with the GPL library, making the whole bundle's source
conveyance-bound. That reasoning is an artifact of the build, not a
requirement: stop fusing them, and the constraint falls away.

## Licensing stance (Barry's decision, recorded 2026-08-13)

- The GPL work the site conveys is the **settlemaker library**, shipped
  as its own standalone artifact (`/lib/settlemaker.js`). Its
  corresponding source is the public repo; the visible source link on the
  site is the offer (GPLv3 §6 network-server conveyance).
- The **page code is Barry's own work**, uses the library through its
  public API, ships as separate files, and is private. This adopts the
  API-use reading of GPL linking and supersedes the conservative
  web-is-a-derivative stance of commit e212dba. Barry owns both the page
  code and this risk call; the library and the symbol art remain fully
  open regardless.
- **Enforcement mechanism:** production builds MUST NOT bundle library
  code into page bundles. The site build marks the library external and
  the verification step greps the built page JS for library-unique
  strings (must be absent) and `/lib/settlemaker.js` for the GPL banner
  (must be present). Dev-mode bundling (local only, never conveyed) is
  fine.

## Architecture

### Public `settlemaker` — pure node library

Gains:
- A browser-library build: `npm run build:lib` (esbuild as a devDependency)
  → `dist/settlemaker.browser.js`, ESM, `--bundle --format=esm
  --target=es2022 --minify`, with a `--banner:js` GPL notice naming the
  repo URL. Entry: `src/index.ts` (already exports everything the pages
  use: `generateFromBurg`-family, `PALETTES`, `parseSettlementUrl`,
  `UrlCodecError`, …).
- `symbols/` at repo root: the symbol assets move here from
  `web/public/symbols/` (batch001 SVGs, symbols.json, LICENSE, CREDITS).
  They stay public — CC-BY art, glyph-codegen input, licenseUrl target.
  `symbols.json`'s `licenseUrl` is updated to
  `https://github.com/barrulus/settlemaker/blob/master/symbols/LICENSE`.

Loses:
- `web/` entirely — every page, stylesheet, and the umami/analytics
  wiring migrate to the private repo. Git history keeps the past; the
  tree stops carrying site code.

Tooling notes:
- `scripts/make-review-page.ts` (generator QA contact sheet) stays in the
  public repo but gains an output-path argument; it keeps targeting a dev
  server's `/fmg`, which now runs from the private repo (below).
- `scripts/extract-glyphs.ts` (glyphs branch) reads the batch001 path —
  updated to `symbols/batch001/` when the branch takes the move.

### Private `settlemaker-web` — the whole site

- `site/` becomes the single Vite project for ALL pages: `index.html`,
  `fmg.html`, `symbols.html`, and `src/` (`builder.ts`, `main.ts`,
  `pan-zoom.ts`, `umami.ts`, `analytics.ts`, all css) migrated verbatim
  from public `web/`, with import paths changed from `../../src/...` to
  the bare specifier `settlemaker`.
- Library resolution, two modes:
  - **Dev:** Vite alias `settlemaker` → `../settlemaker/src/index.ts` —
    live generator hacking against submodule source with HMR. This is
    also the new home of the generator review loop (dev server on 5199,
    `/fmg` served here, review.html written into `site/public/`).
  - **Prod:** `settlemaker` is `rollupOptions.external`; pages carry an
    importmap resolving it to `/lib/settlemaker.js`.
- Root build becomes: (1) `npm ci` + `npm run build:lib` in the
  submodule; (2) `npm ci` + build in `site/`; (3) merge into `dist/`:
  site output, then `settlemaker/dist/settlemaker.browser.js` →
  `dist/lib/settlemaker.js`, then `settlemaker/symbols/` →
  `dist/symbols/`, then root `public/` (icons). `netlify.toml`
  redirects unchanged.

### Page copy and licence text (exact wording)

- `/` footer: "Map generation by settlemaker — free software under
  GPL-3.0, source on GitHub. Derived from watabou's TownGeneratorOS."
  (links unchanged in target, reworded to name the library as the GPL
  work rather than the page).
- `fmg.html` head comment: the page is settlemaker-web (© Barry Gill,
  all rights reserved) loading the settlemaker library (GPL-3.0-only) as
  a separate module; `<link rel="license">` keeps pointing at the public
  repo LICENSE — it describes the library.
- `/symbols` footer: unchanged apart from the new `symbols/` paths.

## Migration order (additive first, one reversible switch)

1. Public repo: add `build:lib` + esbuild devDep; copy (not yet move)
   symbols to `symbols/`; push master. Nothing deployed changes.
2. Private repo, on a branch: migrate the pages into `site/`, wire
   alias/external/importmap, rework the root build, bump the submodule.
   Open a PR → **Netlify deploy preview** (works now — the site watches
   this repo). Verify on the preview: functional /fmg parity (same
   params → same SVG output text), all pages, redirects, symbols assets,
   icons, AND the enforcement greps (no library code in page bundles;
   GPL banner in /lib/settlemaker.js). The distinguishing-marker lesson
   applies: the marker here is `/lib/settlemaker.js` existing at all.
3. Merge to settlemaker-web master → auto-publish. Rollback = republish
   previous deploy.
4. Public repo cleanup commit: delete `web/`, delete the old symbols
   location, update `make-review-page.ts` output handling and README
   (library identity, browser bundle, who consumes it). Bump the pin.
5. Glyphs branch takes the `symbols/batch001/` path in
   `extract-glyphs.ts` when it next rebases on master.

## Out of scope

- npm publishing of the library.
- Any change to the /fmg URL contract or generator behavior — functional
  output must be identical.
- Rewriting history to purge `web/` from past commits (it was GPL then;
  history stands).

## Success criteria

- The public repo tree contains no page code, no analytics wiring, no
  HTML — `src/`, `symbols/`, `scripts/`, tests, docs, and the lib build.
- Production serves page JS containing no bundled library code, plus
  `/lib/settlemaker.js` carrying the GPL banner; the site behaves
  identically (URL contract intact, same SVG for same inputs).
- All tracking wiring (tags, website id, analytics.ts logic) lives only
  in the private repo (visitor-visibility unchanged and acknowledged).
- Generator dev loop works from `settlemaker-web` dev mode against
  submodule source, including the 5199 review-page workflow.
- `licenseUrl` and the site's source-offer links resolve correctly to
  the new public-repo paths.
