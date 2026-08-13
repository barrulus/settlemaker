# Site/Repo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move settlemaker.com's deploy path and site-only content into a new private `settlemaker-web` repo that wraps the public `settlemaker` repo as a pinned git submodule, with a single reversible cutover at the end.

**Architecture:** The private repo carries the public repo as a submodule (layout preserved, so the web app's `../../src` imports work untouched) plus a small Vite project for the `/symbols` page and future private assets. A two-stage build (app build from the submodule, site build merged on top) produces one publish directory. Nothing in the public repo changes until two deliberate master commits: the Umami-domains update at cutover and the file removals after it.

**Tech Stack:** git submodules, Vite 6, TypeScript 5.7, Netlify (UI — no CLI installed), `gh` CLI (authenticated as barrulus), nix develop for local Node 22.

**Spec:** `docs/superpowers/specs/2026-08-13-site-repo-split-design.md` (approved 2026-08-13).

## Global Constraints

- The public repo's master receives **zero** split-related commits until Task 6 (domains commit) and Task 7 (cleanup commit). Tasks 1–5 touch only the new private repo.
- The submodule URL must be `https://github.com/barrulus/settlemaker.git` (not ssh) so Netlify can clone it without deploy keys.
- Private repo local path: `/home/barrulus/dev/settlemaker-web`. GitHub: `barrulus/settlemaker-web`, private.
- Netlify: the EXISTING site (currently serving settlemaker.com, hostname `settlemaker.netlify.app`) is relinked to the private repo — no second site is created (Barry's call, 2026-08-13, revising the original two-site design). Site name, hostname, custom domain, and Umami config are all unchanged throughout; there are no domains edits anywhere in this plan.
- Node 22 everywhere: `NODE_VERSION = "22"` on Netlify; locally run npm via the submodule's flake: `nix develop /home/barrulus/dev/settlemaker-web/settlemaker --command bash -c "<cmd>"`.
- Site output must be identical before and after cutover: same pages (`/`, `/fmg`, `/symbols`), same redirects, same `/symbols/batch001/*` assets, same GPL footers.
- Umami website id `162c6727-fc89-4425-9962-7ad4d65e71ba` and script `https://stats.barrulus.com/script.js` are unchanged throughout.
- Commit messages: no Co-Authored-By lines (user preference).
- This is infrastructure work: "tests" are build-output assertions and HTTP checks, written as explicit run-and-expect steps. Run every one; do not claim a task done without its verification output.

---

### Task 1: Private repo with pinned submodule

**Files:**
- Create: `/home/barrulus/dev/settlemaker-web/` (new git repo, GitHub private)
- Create: `/home/barrulus/dev/settlemaker-web/.gitmodules` (via `git submodule add`)
- Create: `/home/barrulus/dev/settlemaker-web/.gitignore`

**Interfaces:**
- Consumes: public repo `github.com/barrulus/settlemaker`, master head (`cd50b17` at planning time; pin whatever master head is at execution).
- Produces: `settlemaker/` submodule directory whose layout Tasks 2–3 reference by the literal paths `settlemaker/web/...`.

- [ ] **Step 1: Create the private GitHub repo and clone it**

```bash
gh repo create barrulus/settlemaker-web --private \
  -d "settlemaker.com — wraps the public settlemaker repo as a pinned submodule"
git clone git@github.com:barrulus/settlemaker-web.git /home/barrulus/dev/settlemaker-web
cd /home/barrulus/dev/settlemaker-web
```

Expected: empty repo cloned (warning about empty repo is fine).

- [ ] **Step 2: Add the submodule (https URL) and ignore its build dirt**

```bash
cd /home/barrulus/dev/settlemaker-web
git submodule add https://github.com/barrulus/settlemaker.git settlemaker
git config -f .gitmodules submodule.settlemaker.ignore dirty
git add .gitmodules
```

The `ignore = dirty` setting keeps `npm ci`/`dist` churn inside the submodule from showing the submodule as modified in `git status`.

- [ ] **Step 3: Write `.gitignore`**

```gitignore
node_modules/
dist/
site/dist/
```

- [ ] **Step 4: Verify the pin and layout**

Run: `cd /home/barrulus/dev/settlemaker-web && git submodule status && test -f settlemaker/web/vite.config.ts && test -f settlemaker/web/public/symbols/batch001/symbols.json && echo LAYOUT-OK`
Expected: one submodule line with a 40-char SHA (no `+` or `-` prefix after the initial add commit) and `LAYOUT-OK`.

- [ ] **Step 5: Commit**

```bash
cd /home/barrulus/dev/settlemaker-web
git add .gitignore .gitmodules settlemaker
git commit -m "Repo skeleton: public settlemaker pinned as submodule"
```

---

### Task 2: `site/` Vite project — the /symbols page moves in

**Files:**
- Create: `site/package.json`, `site/tsconfig.json`, `site/vite.config.ts` (in `/home/barrulus/dev/settlemaker-web/`)
- Create: `site/symbols.html` (copied from `settlemaker/web/symbols.html`, unmodified)
- Create: `site/src/symbols.ts` (copied from `settlemaker/web/src/symbols.ts`, one import path edited)
- Create: `site/src/symbols.css` (copied from `settlemaker/web/src/symbols.css`, unmodified)

**Interfaces:**
- Consumes: `settlemaker/web/src/umami.ts` (exports `trackEvent(name: string, data?: Record<string, string | number | boolean>): void`) via relative import into the submodule; `settlemaker/web/public/` as Vite `publicDir`.
- Produces: `site/dist/` containing `symbols.html` + hashed assets + a full copy of the submodule's `public/` tree. Task 3's merge step copies `site/dist/.` last, so its files win.

- [ ] **Step 1: Copy the page files from the submodule**

```bash
cd /home/barrulus/dev/settlemaker-web
mkdir -p site/src
cp settlemaker/web/symbols.html site/symbols.html
cp settlemaker/web/src/symbols.ts site/src/symbols.ts
cp settlemaker/web/src/symbols.css site/src/symbols.css
```

No edits to `symbols.html` or `symbols.css`: the page's `/src/symbols.css` and `/src/symbols.ts` references resolve against the new Vite root (`site/`) exactly as they did against `web/`, and the runtime asset path `/symbols/batch001` is a served URL, not a file path.

- [ ] **Step 2: Point the umami import at the submodule**

In `site/src/symbols.ts`, change line 6:

```ts
// before
import { trackEvent } from './umami.js';
// after
import { trackEvent } from '../../settlemaker/web/src/umami.js';
```

- [ ] **Step 3: Write `site/package.json`**

```json
{
  "name": "settlemaker-site",
  "private": true,
  "version": "0.1.0",
  "author": "Barry Gill <b@rry.im>",
  "type": "module",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

(No `@types/geojson` and no GPL license field: this project contains no generator code — `umami.ts` is pulled from the submodule at build time, not vendored.)

- [ ] **Step 4: Write `site/tsconfig.json`**

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
    "skipLibCheck": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`tsc` follows the import graph, so the submodule's `umami.ts` is type-checked without being listed in `include`.

- [ ] **Step 5: Write `site/vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  // The submodule's public/ is this project's publicDir: dev serves the
  // symbol sprite at /symbols/batch001/* just like production, and the build
  // copies the same tree the app build (Task 3, stage 1) also produces —
  // identical source, so the merge overwrite is a no-op.
  publicDir: '../settlemaker/web/public',
  // symbols.ts imports umami.ts from inside the submodule — allow it
  // through Vite's dev-server fs guard.
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        // "/symbols" is the symbol-library reference sheet; the extensionless
        // path is mapped by a Netlify rewrite in the root netlify.toml.
        symbols: 'symbols.html',
      },
    },
  },
});
```

- [ ] **Step 6: Build and verify**

Run:
```bash
cd /home/barrulus/dev/settlemaker-web/settlemaker
nix develop --command bash -c "cd ../site && npm ci && npm run build"
```
Expected: tsc silent, Vite build succeeds.

Run: `cd /home/barrulus/dev/settlemaker-web && test -f site/dist/symbols.html && test -f site/dist/symbols/batch001/symbols.json && test -f site/dist/symbols/batch001/symbols.svg && grep -l umami site/dist/assets/*.js && echo SITE-BUILD-OK`
Expected: `SITE-BUILD-OK` (symbols page built, sprite copied via publicDir, umami helper bundled — grep for `umami`, not `trackEvent`: the function name gets mangled by minification but the `window.umami` property access survives).

- [ ] **Step 7: Commit**

```bash
cd /home/barrulus/dev/settlemaker-web
git add site
git commit -m "site/: /symbols page as its own Vite project, umami from the submodule"
```

---

### Task 3: Root orchestration, netlify.toml, README

**Files:**
- Create: `package.json` (repo root)
- Create: `netlify.toml` (repo root)
- Create: `README.md` (repo root)

**Interfaces:**
- Consumes: `settlemaker/web`'s npm `build` script (`tsc --noEmit && vite build` → `settlemaker/web/dist/`); `site`'s npm `build` script (Task 2 → `site/dist/`).
- Produces: root `npm run build` → merged `dist/` at repo root; `netlify.toml` with `publish = "dist"` and the `/fmg` + `/symbols` redirects. Tasks 4–6 rely on these exact names.

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "settlemaker-web",
  "private": true,
  "version": "0.1.0",
  "author": "Barry Gill <b@rry.im>",
  "scripts": {
    "build:app": "npm ci --prefix settlemaker/web && npm run build --prefix settlemaker/web",
    "build:site": "npm ci --prefix site && npm run build --prefix site",
    "merge": "rm -rf dist && mkdir dist && cp -R settlemaker/web/dist/. dist/ && cp -R site/dist/. dist/",
    "build": "npm run build:app && npm run build:site && npm run merge"
  }
}
```

Merge order is load-bearing: `site/dist` is copied **last** so the private `symbols.html` wins over the copy the submodule's app build still emits until the Task 7 cleanup lands.

- [ ] **Step 2: Write root `netlify.toml`**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "22"

# "/fmg" is the machine endpoint (URL contract: settlemaker docs/url-api.md);
# query parameters pass through 200 rewrites untouched. "/" serves the
# human builder page. Both pages are built from the settlemaker submodule.
[[redirects]]
  from = "/fmg"
  to = "/fmg.html"
  status = 200

# "/symbols" is the symbol-library reference sheet, built from site/. The
# sprite and per-symbol files it loads live under /symbols/batch001/* — real
# static files, which Netlify serves ahead of this rewrite.
[[redirects]]
  from = "/symbols"
  to = "/symbols.html"
  status = 200
```

- [ ] **Step 3: Write `README.md`**

```markdown
# settlemaker-web

Private repo for [settlemaker.com](https://settlemaker.com). The public
[settlemaker](https://github.com/barrulus/settlemaker) repo (GPL-3.0) is
pinned here as the `settlemaker/` submodule; this repo adds the site layer
(the /symbols page, imagery, Netlify config) and is what Netlify deploys.

This repo contains no GPL code — a submodule pointer and site-only content.
The corresponding source for everything the site conveys is the public repo,
which the GPL footers on / and /fmg point at.

## Build

Two stages into one publish dir (`dist/`): the app build inside
`settlemaker/web` (/, /fmg, symbol assets), then the `site/` build
(/symbols) merged on top — site files win. `npm run build` at the root
runs both. Netlify runs the same via `netlify.toml`.

Local build (Node 22 via the submodule's flake):

    nix develop ./settlemaker --command bash -c "npm run build"

## Releasing generator changes

Production only moves when the submodule pin moves:

    cd settlemaker && git fetch origin && git checkout origin/master && cd ..
    git add settlemaker && git commit -m "Bump settlemaker to <sha>: <what>"
    git push

## Previewing a generator branch

    cd settlemaker && git fetch origin <branch> && git checkout FETCH_HEAD && cd ..
    git checkout -b preview/<branch>
    git add settlemaker && git commit -m "Preview: settlemaker <branch> @ <sha>"
    git push -u origin preview/<branch>   # open a PR → Netlify deploy preview

## Rollback

Site-level: revert the offending commit and push. Domain-level (cutover
emergencies): move the custom domain back to the previous Netlify site.
```

- [ ] **Step 4: Full build and merge verification**

Run:
```bash
cd /home/barrulus/dev/settlemaker-web/settlemaker
nix develop --command bash -c "cd .. && npm run build"
```
Expected: both stages build, merge completes.

Run:
```bash
cd /home/barrulus/dev/settlemaker-web
test -f dist/index.html && test -f dist/fmg.html && test -f dist/symbols.html \
  && test -f dist/symbols/batch001/symbols.json && echo DIST-OK
cmp dist/symbols.html site/dist/symbols.html && echo MERGE-ORDER-OK
grep -c "stats.barrulus.com" dist/index.html dist/symbols.html
```
Expected: `DIST-OK`, `MERGE-ORDER-OK`, and both grep counts ≥ 1 (umami tags present). Note: the two symbols.html copies are byte-identical today, so `cmp` passes regardless of merge order — it becomes the real order proof at Task 6 Step 2, when the site copy diverges; re-run it there mentally. The order guarantee until then is the `merge` script itself (site copied last).

- [ ] **Step 5: Commit and push**

```bash
cd /home/barrulus/dev/settlemaker-web
git add package.json netlify.toml README.md
git commit -m "Root build: two-stage app+site merge, Netlify config, workflows README"
git push -u origin master
```

---

### Task 4: Relink the existing Netlify site — HUMAN CHECKPOINT (Barry, Netlify UI)

**Files:** none (Netlify account state).

**Interfaces:**
- Consumes: `barrulus/settlemaker-web` on GitHub (pushed in Task 3), root `netlify.toml`; the existing Netlify site currently serving settlemaker.com from the public repo.
- Produces: a **built but unpublished** deploy of the private repo on the existing site, with the current production deploy locked in place. Task 5 verifies the unpublished deploy's permalink; Task 6 publishes it.

Relinking is the cutover trigger: the moment the repo link changes, pushes and PR previews from the PUBLIC repo stop building on this site (the glyphs draft-PR preview flow ends here — generator previews switch to submodule-bump PRs per the private repo's README). Production keeps serving the locked deploy until Task 6 publishes.

No agent can do this — no Netlify CLI is installed and these are account actions. Present Barry this exact checklist and wait:

- [ ] **Step 1 (Barry): Lock the current deploy**

Netlify app → the existing settlemaker site → **Deploys** → on the currently published deploy: **Lock to stop auto publishing** (padlock option). Production is now frozen on today's build no matter what deploys next.

- [ ] **Step 2 (Barry): Grant repo access and relink**

Site configuration → **Build & deploy → Continuous deployment → Manage repository → Link to a different repository** → GitHub → `barrulus/settlemaker-web` (if not listed, use "Configure the Netlify app on GitHub" to grant it access to the private repo). Branch to deploy: `master`. Build command `npm run build` and publish dir `dist` come from the new repo's root `netlify.toml` — clear any leftover UI-level overrides from the old setup (old base `web` must NOT survive as a UI override; the base is now the repo root).

- [ ] **Step 3 (Barry): Confirm the new deploy builds green (unpublished)**

Deploys tab → a new deploy from `settlemaker-web@master` builds. Because of the lock it does NOT publish. Expected: build succeeds (Netlify clones the public https submodule automatically — no deploy key needed). Open the deploy's detail page and copy its **deploy permalink URL** (the `https://<deploy-id>--settlemaker.netlify.app` link) back into the session for Task 5. If the build fails, paste the deploy log instead.

---

### Task 5: Verify the new site against production

**Files:** none (HTTP checks; run from any shell).

**Interfaces:**
- Consumes: the unpublished deploy's permalink from Task 4 (`https://<deploy-id>--settlemaker.netlify.app`, below `$DEPLOY`) and `https://settlemaker.com` (production, still serving the locked old build) as the reference.
- Produces: go/no-go evidence for the Task 6 publish.

Set `DEPLOY=https://<deploy-id>--settlemaker.netlify.app` (the permalink Barry reported in Task 4) before running the steps.

- [ ] **Step 1: Page and redirect checks**

```bash
for p in / /fmg /symbols /symbols/batch001/symbols.json /symbols/batch001/symbols.svg; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$DEPLOY$p")"
done
```
Expected: five `200`s (the `/fmg` and `/symbols` extensionless rewrites prove netlify.toml is live).

- [ ] **Step 2: /fmg renders a settlement**

```bash
curl -s "$DEPLOY/fmg" | grep -o '<script type="module"[^>]*>' | head -1
```
Expected: one module script tag (the page shell is served; actual SVG generation is client-side — full render check is Step 5's eyeball).

- [ ] **Step 3: Licensing and analytics markers match production**

```bash
for h in "https://settlemaker.com" "$DEPLOY"; do
  echo "== $h"
  curl -s "$h/" | grep -c 'github.com/barrulus/settlemaker'
  curl -s "$h/" | grep -c 'stats.barrulus.com'
  curl -s "$h/symbols/batch001/symbols.json" | grep -o '"licenseUrl": *"[^"]*"'
done
```
Expected: identical counts per host (GPL footer links, umami tag) and the same `licenseUrl` value on both.

- [ ] **Step 4: Content parity spot-check**

```bash
diff <(curl -s https://settlemaker.com/symbols) <(curl -s "$DEPLOY/symbols") && echo SYMBOLS-IDENTICAL
diff <(curl -s https://settlemaker.com/) <(curl -s "$DEPLOY/") && echo INDEX-IDENTICAL
```
Expected: both `IDENTICAL` markers, **provided** the submodule pin equals the commit production last deployed. If master moved since, diffs show real content drift — bump the pin to current master (README flow) and re-run rather than explaining diffs away.

- [ ] **Step 5 (Barry): Eyeball it**

Visual work needs eyes: open `$DEPLOY/`, generate a settlement, open `$DEPLOY/symbols`, confirm both look right. Report OK or what's off.

- [ ] **Step 6: Record the evidence**

Paste the outputs of Steps 1–4 into the session log / task notes. No commit (nothing changed).

---

### Task 6: Publish the cutover deploy — HUMAN-GATED (Barry picks the moment)

**Files:**
- Modify: `settlemaker-web` (private repo) `README.md` (rollback wording only)

No domains edits anywhere: the site keeps its name and `settlemaker.netlify.app` hostname, so the Umami `data-domains` lists in the public repo and the private symbols.html are already correct.

**Interfaces:**
- Consumes: verified unpublished deploy (Task 5); Barry's explicit go signal — do not start this task without it.
- Produces: settlemaker.com served from the private repo. End of the transition window.

- [ ] **Step 1 (Barry): Publish**

Netlify UI → Deploys → the verified deploy from Task 5 → **Publish deploy** (this also lifts the lock; if a separate "Unlock" toggle is shown, unlock so future master pushes auto-publish again).

- [ ] **Step 2: Verify production**

```bash
for p in / /fmg /symbols /symbols/batch001/symbols.json; do
  printf '%-30s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://settlemaker.com$p")"
done
curl -s https://settlemaker.com/ | grep -o 'data-domains="[^"]*"'
```
Expected: four `200`s; `data-domains` unchanged (`settlemaker.com,www.settlemaker.com,settlemaker.netlify.app`). Then (Barry) load settlemaker.com in a browser, generate a settlement, and check the Umami dashboard registers the pageview.

- [ ] **Step 3: Correct the README's rollback note**

The private repo's README (written in Task 3 for the two-site design) says domain-level rollback is "move the custom domain back to the previous Netlify site" — there is no second site. In `/home/barrulus/dev/settlemaker-web/README.md`, replace the Rollback section's second sentence:

```markdown
Site-level: revert the offending commit and push. Deploy-level: Netlify
Deploys → pick the last good deploy → Publish deploy (instant, no build).
```

```bash
cd /home/barrulus/dev/settlemaker-web
git add README.md
git commit -m "README: rollback is republishing a previous deploy (single-site relink, not two sites)"
git push
```

- [ ] **Step 4: Hold the rollback line**

Rollback at any point = Netlify UI → Deploys → previous production deploy → **Publish deploy**. The pre-cutover build stays in deploy history indefinitely; nothing else needs undoing.

---

### Task 7: Post-cutover cleanup in the public repo

**Files:**
- Delete: `netlify.toml`, `web/symbols.html`, `web/src/symbols.ts`, `web/src/symbols.css` (public repo)
- Modify: `web/vite.config.ts:20-22` (remove the `symbols` entry)
- Modify: `settlemaker-web` submodule pin (private repo)

**Interfaces:**
- Consumes: settled cutover (Task 6 verified, no rollback pending — give it at least a day of normal traffic).
- Produces: a public repo with no deploy coupling; the private repo pinned to the cleanup commit. End state of the whole plan.

- [ ] **Step 1: Remove the moved files (public repo, master)**

```bash
cd /home/barrulus/dev/settlemaker   # master checkout/worktree, not the glyphs branch
git rm netlify.toml web/symbols.html web/src/symbols.ts web/src/symbols.css
```

In `web/vite.config.ts`, delete the symbols entry and its comment:
```ts
        // "/symbols" is the symbol-library reference sheet. Its assets live in
        // public/symbols/batch001/ and are served verbatim.
        symbols: 'symbols.html',
```

- [ ] **Step 2: Check for dangling references**

Run: `grep -rn "symbols.html\|symbols\.ts\|symbols\.css\|netlify" web/src web/*.html web/vite.config.ts README.md docs/ --exclude-dir=node_modules 2>/dev/null | grep -v Binary`
Expected: only URL references (`href="/symbols"` in `index.html` footer — the page still exists on the site, served from the private repo) and historical mentions in docs/specs. Anything that would break the build gets fixed here.

- [ ] **Step 3: Verify the web build without the symbols page**

Run: `cd web && nix develop .. --command bash -c "npm run build"`
Expected: build passes; `test ! -f dist/symbols.html && test -f dist/index.html && test -f dist/fmg.html && test -f dist/symbols/batch001/symbols.json && echo CLEANUP-BUILD-OK` prints `CLEANUP-BUILD-OK` (page gone, assets still shipped — they're generator input and stay public).

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Site split cleanup: netlify.toml and the /symbols page move to settlemaker-web"
git push origin master
```
(Pushing master no longer deploys anything — the Netlify site watches the private repo now and only moves on submodule bumps.)

- [ ] **Step 5: Bump the private pin past the cleanup**

```bash
cd /home/barrulus/dev/settlemaker-web
cd settlemaker && git fetch origin && git checkout origin/master && cd ..
git add settlemaker
git commit -m "Bump settlemaker past the split cleanup"
git push
```
Then verify the deploy: `curl -s -o /dev/null -w '%{http_code}\n' https://settlemaker.com/symbols` → `200` (now served solely from `site/`), and `curl -s https://settlemaker.com/ | grep -c stats.barrulus.com` → ≥ 1.

- [ ] **Step 6: Nothing to retire**

The relink design reuses the one Netlify site — there is no old site to delete. (This step existed in the two-site design; kept as a placeholder so step numbering in session logs stays stable.)

- [ ] **Step 7: Close the loop**

Update the project memory (`settlemaker-site-repo-split.md`): split is LIVE, record the cutover date and the new preview workflow (submodule-bump PRs) that glyph work now uses if it hasn't already shipped.
