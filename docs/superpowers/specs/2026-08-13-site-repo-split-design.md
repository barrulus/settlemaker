# Site/Repo Split — settlemaker.com moves to a private repo

**Date:** 2026-08-13
**Status:** Approved design, not yet implemented
**Owner:** Barry

## Motivation

settlemaker.com should evolve privately: the site tracks visits and will
eventually hold licensed imagery that cannot live in a public repository.
The generator is and remains GPL-3.0 (a derivative of watabou's
TownGeneratorOS), so the split boundary is drawn by licence, not by
directory: anything the site serves that bundles the generator must keep
its source public; everything else moves out.

Note on analytics: going private does not hide the Umami website ID or
script URL — they ship in the served JavaScript and are readable by any
visitor. Privacy here buys a home for licensed imagery and keeps the
site's history and config out of the public repo, nothing more.

## Decisions

1. **Boundary:** the private repo is the site; it wraps the public repo
   as a build-time dependency. Generator + builder//fmg app code stay
   public.
2. **Consumption:** git submodule, pinned to a commit. Preserves the
   repo layout so the web app's `../../src` relative imports keep
   working untouched; Netlify clones submodules natively; bumping the
   ref is a deliberate, reviewable site release.
3. **Symbols:** the assets (`web/public/symbols/batch001/` — SVGs,
   `symbols.json`, LICENSE) stay public. They are generator input under
   the glyph-wiring spec, they are CC-BY, and `licenseUrl` keeps
   working unchanged. Only the `/symbols` reference *page* moves
   private.
4. **Sequencing:** the split proceeds in parallel with the glyphs work.
   Everything disruptive is deferred to a single cutover step; until
   then the public repo and its Netlify previews are untouched.

## Repo topology

### Public `settlemaker` (github.com/barrulus/settlemaker, GPL-3.0)

Keeps:

- `src/` generator, tests, docs — unchanged.
- `web/` app code for `/` and `/fmg`: `index.html`, `fmg.html`,
  `web/src/main.ts`, `builder.ts`, `pan-zoom.ts`, and the analytics
  wiring (`analytics.ts`, `umami.ts`) they import. These pages bundle
  the GPL generator; their source must remain publicly available, and
  the analytics IDs in them are client-visible regardless.
- `web/public/symbols/batch001/` symbol assets (see Decision 3).
- Local dev workflow: `npm run dev` in `web/` still serves `/` and
  `/fmg` for generator development.

Loses (at cutover, in one commit, not before):

- `netlify.toml` (moves to the private repo).
- The `/symbols` page: `web/symbols.html`, `web/src/symbols.ts`,
  `web/src/symbols.css`, and the `symbols` entry in
  `web/vite.config.ts`.

### Private `settlemaker-web` (new private GitHub repo)

- `settlemaker/` — submodule of the public repo, pinned.
- The `/symbols` page (moved from the public repo) as its own small
  Vite project.
- Site imagery and future licensed assets.
- `netlify.toml` — Netlify links to this repo; base/build/publish
  configured here; the `/fmg` and `/symbols` redirects move over
  verbatim.

The private repo contains no GPL code — a submodule pointer and
Barry-owned content only — so it owes nothing publicly.

## Build composition

The Netlify build in the private repo runs two stages into one publish
directory:

1. **App build:** `npm ci && npm run build` inside the submodule's
   `web/`. Produces `/`, `/fmg`, and copies `public/symbols/batch001/*`
   into the publish dir exactly as today.
2. **Site build:** the private Vite project builds the `/symbols` page
   and copies private static assets, merged into the same publish dir.
   The symbols page keeps reading its sprite from `/symbols/batch001/*`,
   which stage 1 provided.

The submodule's build ignore-rule logic (rebuild when `../src` changes)
becomes irrelevant: the private repo pins a commit, so every deploy is
an explicit ref bump or site change.

## Cutover

The only disruptive step, executed once, at a moment Barry chooses:

1. Create a **new** Netlify site linked to the private repo; verify the
   full site (/, /fmg, /symbols, symbol assets, redirects, analytics)
   on its `*.netlify.app` URL. The existing site keeps serving
   settlemaker.com and all deploy previews meanwhile.
2. Add the new site's `*.netlify.app` hostname to the Umami
   `data-domains` list (`DOMAINS` in `analytics.ts` and the
   `data-domains` attributes in the page HTML) so production pageviews
   are not suppressed.
3. Move the custom domain (settlemaker.com + www) to the new site.
   Rollback = move it back.
4. After it settles: one public-repo commit removes `netlify.toml` and
   the `/symbols` page files; retire the old Netlify site.

## Post-split workflows

- **Site release of generator changes:** bump the submodule ref in the
  private repo, push master → Netlify deploys.
- **Preview a generator branch** (replaces the draft-PR preview flow,
  including glyphs if it hasn't shipped by cutover): private-repo
  branch bumps the submodule to the branch head → PR → Netlify deploy
  preview.
- **Site-only changes:** private repo only; the public repo is not
  involved.

## Licensing invariants

- GPL footers on `/` and `/fmg` keep pointing at the public repo, which
  remains the corresponding source for everything the site conveys.
- `symbols.json` `licenseUrl` is untouched (assets stay public).
- The CC-BY attribution chain for symbol art is unchanged.

## Parallel-work protocol

All split work happens in the new private repo, in its own directory —
not in this worktree. The public repo's master receives zero
split-related commits until the post-cutover cleanup. The glyphs branch
and its preview plan proceed unchanged; the only post-cutover
difference for glyphs is that previews switch to the submodule-bump
flow.

## Out of scope

- Publishing settlemaker as an npm package.
- Any change to the generator, the URL contract, or `/fmg` behaviour.
- Moving analytics wiring out of the public app code.
- Per-asset licensing decisions for future imagery (the private repo
  simply provides the home).

## Success criteria

- settlemaker.com serves identically before and after cutover (same
  pages, redirects, symbol assets, analytics events).
- The public repo builds and runs `web/` locally with no Netlify
  coupling.
- A generator change reaches production only via an explicit submodule
  bump in the private repo.
- Licensed imagery can be added to the private repo without touching
  the public one.
