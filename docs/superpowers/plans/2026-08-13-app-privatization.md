# App Privatization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire site (all pages + analytics wiring) into the private `settlemaker-web` repo and reduce the public repo to a pure library, conveyed to browsers as one standalone GPL artifact (`/lib/settlemaker.js`).

**Architecture:** The public repo gains an esbuild library-bundle build; the private `site/` project absorbs every page and imports the library by the bare specifier `settlemaker` — aliased to submodule source in dev, external + importmap (`/lib/settlemaker.js`) in prod. The root merge gains lib and symbols copy steps. Ship via a settlemaker-web PR deploy preview (they work now), merge to publish, then delete `web/` from the public repo.

**Tech Stack:** esbuild (new devDep, public repo), Vite 6, git submodule, Netlify deploy previews, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-08-13-app-privatization-design.md`.

## Global Constraints

- Production page bundles MUST NOT contain library code. Enforcement: built page JS must contain an import of bare `"settlemaker"` (proves externalization); `/lib/settlemaker.js` must carry the GPL banner.
- Functional behavior identical: /fmg URL contract untouched; same params → same settlement.
- Umami website id `162c6727-fc89-4425-9962-7ad4d65e71ba`, script `https://stats.barrulus.com/script.js`, and `data-domains="settlemaker.com,www.settlemaker.com,settlemaker.netlify.app"` — values unchanged, copied verbatim wherever they move.
- Symbols assets stay public: new home `symbols/` at public repo root; `licenseUrl` becomes `https://github.com/barrulus/settlemaker/blob/master/symbols/LICENSE`. COPY first (Task 1), delete old location only in Task 5 (glyphs-branch codegen still reads the old path).
- Public repo master work happens in a worktree (`git -C /home/barrulus/dev/settlemaker worktree add <path> master`) — the main checkout stays on `glyphs`. Remove worktrees when done.
- Node via `nix develop /home/barrulus/dev/settlemaker-web/settlemaker --command bash -c "<cmd>"` (private repo work) or `nix develop <worktree-root> --command ...` (public worktree).
- Commit messages: no Co-Authored-By lines.
- Private repo path `/home/barrulus/dev/settlemaker-web`; its Netlify site auto-publishes master and builds PR deploy previews at `https://deploy-preview-<PR#>--settlemaker.netlify.app`.

---

### Task 1: Public repo — library bundle build + symbols copy (additive)

**Files (public repo, in a master worktree at `/home/barrulus/dev/settlemaker-lib`):**
- Modify: `package.json` (add `build:lib` script + `esbuild` devDep)
- Create: `symbols/` (copy of `web/public/symbols/`, with `licenseUrl` updated in the copied `batch001/symbols.json`)

**Interfaces:**
- Produces: `npm run build:lib` → `dist/settlemaker.browser.js` (ESM, es2022, minified, GPL banner comment naming the repo). Task 2's root build calls it; Task 3 greps its banner. `symbols/batch001/*` paths that Task 2's merge copies.

- [ ] **Step 1: Worktree**

```bash
git -C /home/barrulus/dev/settlemaker worktree add /home/barrulus/dev/settlemaker-lib master
cd /home/barrulus/dev/settlemaker-lib
```

- [ ] **Step 2: Add the lib build to `package.json`**

In `scripts`, after `"build": "tsc",` add:
```json
    "build:lib": "esbuild src/index.ts --bundle --format=esm --target=es2022 --minify --outfile=dist/settlemaker.browser.js --banner:js=\"/* settlemaker — GPL-3.0-only. Corresponding source: https://github.com/barrulus/settlemaker */\"",
```
In `devDependencies` add (alphabetical position):
```json
    "esbuild": "^0.25.0",
```

- [ ] **Step 3: Install and build**

Run: `nix develop /home/barrulus/dev/settlemaker-lib --command bash -c "cd /home/barrulus/dev/settlemaker-lib && npm install && npm run build:lib"`
(`npm install`, not `ci` — the lockfile must pick up esbuild.)
Expected: `dist/settlemaker.browser.js` written.

- [ ] **Step 4: Verify the bundle**

Run: `head -c 200 dist/settlemaker.browser.js && echo && grep -c "export{" dist/settlemaker.browser.js`
Expected: first line is the GPL banner comment; at least one `export{` (ESM exports present).

- [ ] **Step 5: Copy symbols to their new home and update licenseUrl**

```bash
cp -R web/public/symbols symbols
```
In `symbols/batch001/symbols.json` line 4, change:
```json
  "licenseUrl": "https://github.com/barrulus/settlemaker/blob/master/web/public/symbols/LICENSE",
```
to:
```json
  "licenseUrl": "https://github.com/barrulus/settlemaker/blob/master/symbols/LICENSE",
```
Then verify: `diff -r web/public/symbols symbols` shows ONLY that one line differing, and `test -f symbols/LICENSE` passes.

- [ ] **Step 6: Commit and push**

```bash
git add package.json package-lock.json symbols
git commit -m "Library bundle build (esbuild → dist/settlemaker.browser.js) + symbols/ at repo root"
git push origin master
```

---

### Task 2: Private repo — the whole site moves into site/

**Files (private repo `/home/barrulus/dev/settlemaker-web`, on new branch `app-privatization`):**
- Create: `site/index.html`, `site/fmg.html` (migrated from submodule `settlemaker/web/`, edited)
- Create: `site/src/builder.ts`, `site/src/main.ts`, `site/src/pan-zoom.ts`, `site/src/analytics.ts`, `site/src/umami.ts`, `site/src/builder.css`, `site/src/style.css` (migrated)
- Modify: `site/symbols.html` (importmap not needed — page uses no library; only note below), `site/src/symbols.ts` (umami import simplifies), `site/vite.config.ts`, `site/tsconfig.json`, `site/package.json`
- Modify: root `package.json` (build stages), `.gitignore` (+`site/public/review.html`)
- Modify: `settlemaker` submodule pin → Task 1's master head

**Interfaces:**
- Consumes: submodule `npm run build:lib` → `settlemaker/dist/settlemaker.browser.js`; library entry `settlemaker/src/index.ts` exporting `generateFromBurg`, `PALETTES`, `parseSettlementUrl`, `UrlCodecError` (used by `main.ts`/`builder.ts`).
- Produces: root `npm run build` → `dist/` containing all pages, `lib/settlemaker.js`, `symbols/batch001/*`, icons. Branch pushed + PR opened → deploy preview for Task 3.

- [ ] **Step 1: Branch and bump the pin**

```bash
cd /home/barrulus/dev/settlemaker-web
git checkout -b app-privatization
cd settlemaker && git fetch origin && git checkout origin/master && cd ..
```
Verify: `test -f settlemaker/symbols/batch001/symbols.json && grep -q '"build:lib"' settlemaker/package.json && echo PIN-OK`

- [ ] **Step 2: Migrate the pages**

```bash
cp settlemaker/web/index.html settlemaker/web/fmg.html site/
cp settlemaker/web/src/{builder.ts,main.ts,pan-zoom.ts,analytics.ts,umami.ts,builder.css,style.css} site/src/
```

- [ ] **Step 3: Rewrite library imports to the bare specifier**

`site/src/main.ts` line 1–2 area:
```ts
// before
import { generateFromBurg, PALETTES, parseSettlementUrl, UrlCodecError } from '../../src/index.js';
// after
import { generateFromBurg, PALETTES, parseSettlementUrl, UrlCodecError } from 'settlemaker';
```
`site/src/builder.ts` (line 4 area):
```ts
// before
import { PALETTES } from '../../src/output/palette.js';
// after
import { PALETTES } from 'settlemaker';
```
`site/src/symbols.ts` line 6 — umami is local again:
```ts
// before
import { trackEvent } from '../../settlemaker/web/src/umami.js';
// after
import { trackEvent } from './umami.js';
```
Then: `grep -rn '\.\./\.\./' site/src/` → must return nothing.

- [ ] **Step 4: Importmaps + licence copy in the two migrated pages**

In `site/index.html` AND `site/fmg.html`, directly before the closing `</head>`, insert:
```html
    <script type="importmap">{ "imports": { "settlemaker": "/lib/settlemaker.js" } }</script>
```
(Importmaps must precede the module script; both pages' module script tags are in `<body>`, so end-of-head is safe.)

In `site/index.html`, replace the licence footer paragraph:
```html
        <p class="footer">settlemaker is free software:
          <a href="https://github.com/barrulus/settlemaker" target="_blank" rel="noopener">source on GitHub</a>,
          licensed <a href="https://github.com/barrulus/settlemaker/blob/master/LICENSE" rel="license" target="_blank">GPL-3.0</a>.
          Derived from <a href="https://github.com/watabou/TownGeneratorOS" target="_blank" rel="noopener">watabou's TownGeneratorOS</a>.</p>
```
with:
```html
        <p class="footer">Map generation by the settlemaker library — free software:
          <a href="https://github.com/barrulus/settlemaker" target="_blank" rel="noopener">source on GitHub</a>,
          licensed <a href="https://github.com/barrulus/settlemaker/blob/master/LICENSE" rel="license" target="_blank">GPL-3.0</a>.
          Derived from <a href="https://github.com/watabou/TownGeneratorOS" target="_blank" rel="noopener">watabou's TownGeneratorOS</a>.</p>
```

In `site/fmg.html`, replace the head comment block:
```html
    <!--
      settlemaker — Copyright (C) 2025-2026 Barry Gill. Free software under GPL-3.0-only.
      Derived from watabou's TownGeneratorOS (https://github.com/watabou/TownGeneratorOS).
      Corresponding source: https://github.com/barrulus/settlemaker
      This page is the machine image endpoint, so the source offer is metadata only —
      a visible footer would render into the returned map image.
    -->
```
with:
```html
    <!--
      settlemaker-web — Copyright (C) 2025-2026 Barry Gill. All rights reserved.
      Map generation by the settlemaker library (GPL-3.0-only), loaded as a
      separate module (/lib/settlemaker.js); corresponding source:
      https://github.com/barrulus/settlemaker — also linked via rel=license.
      This page is the machine image endpoint, so the source offer is metadata
      only; a visible footer would render into the returned map image.
    -->
```

- [ ] **Step 5: Vite config — all pages, dev alias, prod external, dev symbols middleware**

Replace `site/vite.config.ts` entirely with:
```ts
import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';

// Dev-only: serve the submodule's symbol assets at /symbols/batch001/*,
// mirroring what the root merge provides in production.
function serveSymbolsDev(): Plugin {
  return {
    name: 'serve-symbols-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/symbols/batch001', (req, res, next) => {
        const rel = (req.url ?? '/').split('?')[0];
        readFile(new URL(`../settlemaker/symbols/batch001${rel}`, import.meta.url))
          .then((buf) => {
            if (rel.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
            if (rel.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
            res.end(buf);
          })
          .catch(() => next());
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [serveSymbolsDev()],
  resolve: {
    alias:
      command === 'serve'
        ? // Dev: compile the library from submodule source (HMR-able). Never
          // shipped — production externalizes the bare specifier instead.
          { settlemaker: new URL('../settlemaker/src/index.ts', import.meta.url).pathname }
        : {},
  },
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      // The GPL library ships as its own artifact; pages resolve the bare
      // specifier via the importmap to /lib/settlemaker.js. Bundling it into
      // page JS would re-fuse the works — never remove this external.
      external: ['settlemaker'],
      input: { index: 'index.html', fmg: 'fmg.html', symbols: 'symbols.html' },
    },
  },
}));
```

- [ ] **Step 6: site tsconfig + package.json**

`site/tsconfig.json` — replace with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": false,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "settlemaker": ["../settlemaker/src/index.ts"],
      "geojson": ["./node_modules/@types/geojson"]
    }
  },
  "include": ["src"]
}
```
(`vite.config.ts` leaves `include` — it now uses node APIs, which this
tsconfig has no types for; Vite transpiles it itself.)

`site/package.json` devDependencies — add `@types/geojson` (the library's
types import it):
```json
  "devDependencies": {
    "@types/geojson": "^7946.0.16",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
```
Then refresh the lockfile so the root build's `npm ci --prefix site` still
works: `nix develop /home/barrulus/dev/settlemaker-web/settlemaker --command bash -c "cd /home/barrulus/dev/settlemaker-web/site && npm install"`

- [ ] **Step 7: Root build rework**

Root `package.json` scripts — replace the four scripts with:
```json
  "scripts": {
    "build:lib": "npm install --prefix settlemaker && npm run build:lib --prefix settlemaker",
    "build:site": "npm ci --prefix site && npm run build --prefix site",
    "merge": "rm -rf dist && mkdir -p dist/lib && cp -R site/dist/. dist/ && cp settlemaker/dist/settlemaker.browser.js dist/lib/settlemaker.js && cp -R settlemaker/symbols/. dist/symbols/ && cp -R public/. dist/",
    "build": "npm run build:lib && npm run build:site && npm run merge"
  }
```
(The submodule app build is gone — `site/` builds every page now.
`npm install` for the submodule because its lockfile gained esbuild in
Task 1 and `ci` is fine too — but `install` tolerates platform-specific
esbuild binaries; keep `install`.)

Append to root `.gitignore`:
```gitignore
site/public/review.html
```

- [ ] **Step 8: Full build + enforcement checks**

Run: `nix develop /home/barrulus/dev/settlemaker-web/settlemaker --command bash -c "cd /home/barrulus/dev/settlemaker-web && npm run build"`
Then:
```bash
cd /home/barrulus/dev/settlemaker-web
test -f dist/index.html && test -f dist/fmg.html && test -f dist/symbols.html \
  && test -f dist/lib/settlemaker.js && test -f dist/symbols/batch001/symbols.json \
  && test -f dist/favicon.ico && echo DIST-OK
head -c 120 dist/lib/settlemaker.js   # expect the GPL banner
grep -l 'from"settlemaker"\|from "settlemaker"' dist/assets/*.js && echo EXTERNALIZED
grep -o '"licenseUrl": *"[^"]*"' dist/symbols/batch001/symbols.json   # expect .../master/symbols/LICENSE
grep -c 'type="importmap"' dist/index.html dist/fmg.html   # expect 1 and 1
```
All five checks must pass. If `EXTERNALIZED` fails, the external config is
broken — do not proceed.

- [ ] **Step 9: Dev-mode smoke check**

Run the dev server briefly:
```bash
nix develop /home/barrulus/dev/settlemaker-web/settlemaker --command bash -c '
  cd /home/barrulus/dev/settlemaker-web/site
  npx vite --port 5199 & PID=$!
  sleep 8
  curl -s -o /dev/null -w "fmg %{http_code}\n" http://localhost:5199/fmg
  curl -s -o /dev/null -w "symbols.json %{http_code}\n" http://localhost:5199/symbols/batch001/symbols.json
  kill $PID'
```
Expected: both 200 (dev alias compiles the library; middleware serves symbols).

- [ ] **Step 10: Commit, push, open PR**

```bash
git add -A
git commit -m "Site absorbs all pages; settlemaker consumed as external /lib/settlemaker.js (importmap), dev alias to submodule source"
git push -u origin app-privatization
gh pr create --repo barrulus/settlemaker-web --title "App privatization: whole site private, library as standalone GPL artifact" --body "Per settlemaker docs/superpowers/specs/2026-08-13-app-privatization-design.md. Deploy preview is the verification gate."
```
Record the PR number — the preview URL is `https://deploy-preview-<PR#>--settlemaker.netlify.app`.

---

### Task 3: Verify the deploy preview (agent) + Barry eyeball — GATE

**Files:** none (HTTP checks against the preview).

**Interfaces:**
- Consumes: `https://deploy-preview-<PR#>--settlemaker.netlify.app` (Task 2). Netlify needs a few minutes to build — poll until the deploy responds.
- Produces: go/no-go for the Task 4 merge. Do not merge without Barry's eyeball OK.

- [ ] **Step 1: Status + artifact checks (set `P` to the preview URL)**

```bash
for p in / /fmg /symbols /symbols/batch001/symbols.json /lib/settlemaker.js /favicon.ico; do
  printf '%-35s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$P$p")"
done
```
Expected: six 200s.

- [ ] **Step 2: Enforcement + licence markers**

```bash
curl -s "$P/lib/settlemaker.js" | head -c 120          # GPL banner
curl -s "$P/" | grep -o 'type="importmap"' | head -1    # importmap present
curl -s "$P/" | grep -c 'Map generation by the settlemaker library'   # ≥1, new footer
APPJS=$(curl -s "$P/fmg" | grep -o '/assets/[^"]*\.js' | head -1)
curl -s "$P$APPJS" | grep -o 'from"settlemaker"' | head -1   # external import survives
curl -s "$P$APPJS" | wc -c   # page JS is small (tens of KB, not the ~300KB+ fused bundle)
```
All present/plausible or STOP.

- [ ] **Step 3 (Barry): Eyeball the preview**

Open the preview URL: generate a settlement in the builder, open a direct `/fmg?...` link from it, open `/symbols`. Confirm settlements render identically to production. Report OK.

---

### Task 4: Merge and verify production

**Files:** none (GitHub merge + HTTP checks).

**Interfaces:**
- Consumes: Barry's OK from Task 3.
- Produces: production served with the private pages + external library artifact.

- [ ] **Step 1: Merge**

```bash
gh pr merge <PR#> --repo barrulus/settlemaker-web --merge --delete-branch
```

- [ ] **Step 2: Wait for auto-publish, then verify production**

Poll `https://settlemaker.com/lib/settlemaker.js` (30s interval, ≤10 min) until 200, then run Task 3 Steps 1–2 against `P=https://settlemaker.com`. All checks must pass. Rollback if anything is wrong: Netlify → Deploys → previous deploy → Publish deploy.

---

### Task 5: Public repo cleanup — web/ leaves, tooling follows

**Files (public repo, in the `/home/barrulus/dev/settlemaker-lib` worktree, after `git pull`):**
- Delete: `web/` (entire directory)
- Modify: `scripts/make-review-page.ts:11,114-115` (output path argument)
- Modify: `README.md` (deploy/consumption paragraph)
- Modify (private repo): submodule pin bump

**Interfaces:**
- Consumes: production verified on the new architecture (Task 4).
- Produces: final end state — public repo with no site code; private pin past it.

- [ ] **Step 1: Delete web/ and fix the review harness**

```bash
cd /home/barrulus/dev/settlemaker-lib && git pull
git rm -r web
```
In `scripts/make-review-page.ts`, change the output handling (line 114-115):
```ts
// before
writeFileSync('web/public/review.html', html);
console.log(`wrote web/public/review.html with ${items.length} settlements`);
// after — the dev server that serves /fmg lives in settlemaker-web now
const OUT = process.argv[2] ?? '../settlemaker-web/site/public/review.html';
writeFileSync(OUT, html);
console.log(`wrote ${OUT} with ${items.length} settlements`);
```
Also update the file's header comment (line 2) `web/public/review.html` → `settlemaker-web/site/public/review.html (override with argv[2])`.

- [ ] **Step 2: README deploy paragraph**

In `README.md`, find the section describing the web app / settlemaker.com deployment (grep for `settlemaker.com` / `web/`) and replace its content with one short paragraph:
```markdown
settlemaker.com is built from the private settlemaker-web repo, which pins
this repo as a submodule and serves the library to browsers as a standalone
GPL artifact (`/lib/settlemaker.js`, built by `npm run build:lib`). This
repository is the library: generation core, symbols, tests, and tooling.
```
Keep surrounding sections intact; do not rewrite unrelated README content.

- [ ] **Step 3: Verify the library repo stands alone**

```bash
nix develop /home/barrulus/dev/settlemaker-lib --command bash -c "cd /home/barrulus/dev/settlemaker-lib && npm run build:lib && npx vitest run 2>&1 | tail -3"
grep -rn "web/" package.json tsconfig.json vitest.config.ts 2>/dev/null
```
Expected: lib build ok; full test suite passes; no build-relevant `web/` references (docs/spec mentions are fine).

- [ ] **Step 4: Commit, push, bump the private pin**

```bash
git add -A && git commit -m "Library-only: web/ moves to settlemaker-web; review harness output configurable" && git push origin master
cd /home/barrulus/dev/settlemaker-web && cd settlemaker && git fetch origin && git checkout origin/master && cd ..
git add settlemaker && git commit -m "Bump settlemaker past web/ removal" && git push
```
Wait for the deploy, then re-run Task 3 Steps 1–2 against production one last time (all 200s, banner, externalization).

- [ ] **Step 5: Tidy**

```bash
git -C /home/barrulus/dev/settlemaker worktree remove /home/barrulus/dev/settlemaker-lib
```
Note in the session (controller): glyphs branch owes `extract-glyphs.ts` the `symbols/batch001/` path when it rebases; memory close-out.
