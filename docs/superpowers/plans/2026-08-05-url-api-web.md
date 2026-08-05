# URL API & Web App Implementation Plan (Plan C of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** settlemaker becomes a browser-hosted, URL-parameter-driven settlement renderer deployable on Netlify: `?i=<compressed payload>` (or human-friendly flat params) → full-viewport SVG in a chrome-free page, with `docs/url-api.md` as the contract Azgaar's FMG adapter targets.

**Architecture:** The codec and URL parsing live in the **library** (`src/url/`) so they are unit-testable in Node and shared verbatim with FMG's adapter (browser-native `CompressionStream('deflate-raw')` + `btoa`/`atob` exist in both). The **web app** (`web/`) is a ~100-line vanilla-TS Vite page that parses `location.search`, calls `generateFromBurg`, and injects the SVG — no framework, no runtime deps, AFMG owns all UI. `netlify.toml` publishes `web/dist`. Spec: `docs/superpowers/specs/2026-08-04-netlify-pivot-design.md`, sections "URL API", "Page behavior (v1)", "Web app and hosting".

**Tech Stack:** TypeScript (strict), vitest, Vite (web devDependency only). Library keeps zero runtime AND zero new dev dependencies.

**Execution base:** branch from `scene-assets` (or master once PR #1 merges) — flat params include `biome`, `trade`, `urbanDensity` from Plan B.

## Global Constraints

- Run everything through the nix shell: `nix develop --command bash -c "<cmd>"` from the repo root (`web/` commands run with `--prefix web` or `cd web &&` inside that shell).
- Library (`src/`, `tests/`): zero runtime dependencies, zero new devDependencies. The codec uses only web-platform globals (`CompressionStream`, `DecompressionStream`, `Blob`, `Response`, `TextEncoder`, `TextDecoder`, `btoa`, `atob`) — all verified present in the pinned Node 22 and in browsers; never import from `node:*` in `src/`.
- `web/` gets its own `package.json`; devDependencies only (`vite`, `typescript`); no runtime dependencies at all.
- URL contract (spec-fixed): `i=` carries `base64url(deflateRaw(JSON))` of envelope `{v: 1, burg, seed?}`; when `i` is present ALL flat data params are ignored; presentation params `theme=` (palette preset name) and `style=` (compressed `Partial<RenderTheme>` group overrides) stay outside the payload and apply in both tiers; no params at all → self-demoing random settlement.
- Determinism: same URL → byte-identical SVG (randomness only for the bare no-param URL, injected as a function so tests control it).
- A malformed `i`/`style` value renders a visible error card with the decode reason — never a blank iframe, never a thrown-to-console-only failure.
- Float assertions use `toBeCloseTo`, never `toBe`.
- Do not add `Co-Authored-By` lines to commit messages.
- Suite is 334 tests green at start; every task ends green.

## File Structure

- `src/url/codec.ts` — CREATE: compress/encode + decode/validate, `UrlCodecError` (Task 1)
- `src/url/params.ts` — CREATE: flat-param + tier parsing → `ParsedSettlementUrl` (Task 2)
- `src/index.ts` — MODIFY: export codec + params API (Tasks 1–2)
- `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/style.css` — CREATE (Task 3)
- `netlify.toml` — CREATE at repo root (Task 3)
- `docs/url-api.md` — CREATE (Task 4)
- Tests: `tests/url-codec.test.ts`, `tests/url-params.test.ts` — CREATE
- `.gitignore` — MODIFY: add `web/dist/`, `web/node_modules/` (Task 3)

---

### Task 1: URL codec — compressed envelope encode/decode

The primary FMG channel. Encode: JSON → UTF-8 → deflate-raw → base64url. Decode: the reverse, with a typed error at every failure layer so the page can show *why* a link is broken.

**Files:**
- Create: `src/url/codec.ts`
- Modify: `src/index.ts` (exports)
- Test: `tests/url-codec.test.ts` (create)

**Interfaces:**
- Consumes: `AzgaarBurgInput` (`src/input/azgaar-input.ts`).
- Produces (Task 2 and the FMG adapter consume these exact signatures):
  - `URL_PAYLOAD_VERSION = 1`
  - `class UrlCodecError extends Error { reason: 'base64' | 'inflate' | 'json' | 'version' | 'shape' }`
  - `encodeBurgParam(burg: AzgaarBurgInput, seed?: number): Promise<string>`
  - `decodeBurgParam(value: string): Promise<{ burg: AzgaarBurgInput; seed?: number }>`
  - `encodeJsonParam(value: unknown): Promise<string>` / `decodeJsonParam(value: string): Promise<unknown>` (generic layer; `style=` uses these)

- [ ] **Step 1: Write the failing test**

Create `tests/url-codec.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  encodeBurgParam, decodeBurgParam, encodeJsonParam, decodeJsonParam,
  UrlCodecError, URL_PAYLOAD_VERSION,
} from '../src/url/codec.js';
import { toprak } from './fixtures/toprak.js';

describe('url codec', () => {
  it('round-trips a full burg with coastline geometry and seed', async () => {
    const param = await encodeBurgParam(toprak, 1234);
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet, no padding
    const out = await decodeBurgParam(param);
    expect(out.burg).toEqual(toprak);
    expect(out.seed).toBe(1234);
  });

  it('omits seed cleanly', async () => {
    const out = await decodeBurgParam(await encodeBurgParam(toprak));
    expect(out.seed).toBeUndefined();
  });

  it('compresses (coastline burg param is much smaller than raw JSON)', async () => {
    const param = await encodeBurgParam(toprak);
    expect(param.length).toBeLessThan(JSON.stringify(toprak).length);
  });

  it('generic JSON params round-trip (style overrides)', async () => {
    const style = { buildingFill: '#123456', water: '#7aa' };
    expect(await decodeJsonParam(await encodeJsonParam(style))).toEqual(style);
  });

  it.each([
    ['not base64url!!', ['base64', 'inflate']],
    ['AAAA', ['inflate']],
  ])('rejects garbage %s with a transport-layer reason', async (value, reasons) => {
    const err = await decodeBurgParam(value).catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect(reasons).toContain((err as UrlCodecError).reason);
  });

  it('rejects a wrong-version envelope', async () => {
    const param = await encodeJsonParam({ v: URL_PAYLOAD_VERSION + 1, burg: toprak });
    const err = await decodeBurgParam(param).catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect((err as UrlCodecError).reason).toBe('version');
  });

  it('rejects an envelope without a plausible burg', async () => {
    const param = await encodeJsonParam({ v: URL_PAYLOAD_VERSION, burg: { nope: true } });
    const err = await decodeBurgParam(param).catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect((err as UrlCodecError).reason).toBe('shape');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/url-codec.test.ts"`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the codec**

Create `src/url/codec.ts`:

```typescript
import type { AzgaarBurgInput } from '../input/azgaar-input.js';

/**
 * URL payload codec — the FMG integration channel. Encode: JSON → UTF-8 →
 * deflate-raw → base64url. Uses only web-platform globals so the exact same
 * code runs in browsers and Node 18+; FMG's adapter can copy it verbatim.
 * Envelope: { v: URL_PAYLOAD_VERSION, burg, seed? }. Additive evolution;
 * bump the version on breaking change.
 */
export const URL_PAYLOAD_VERSION = 1;

export type UrlCodecFailure = 'base64' | 'inflate' | 'json' | 'version' | 'shape';

export class UrlCodecError extends Error {
  constructor(readonly reason: UrlCodecFailure, message: string) {
    super(message);
    this.name = 'UrlCodecError';
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new UrlCodecError('base64', 'parameter is not valid base64url');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Generic layer: any JSON value → compressed base64url param. */
export async function encodeJsonParam(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

/** Generic layer: compressed base64url param → JSON value. */
export async function decodeJsonParam(value: string): Promise<unknown> {
  const packed = fromBase64Url(value);
  let bytes: Uint8Array;
  try {
    bytes = await pipe(packed, new DecompressionStream('deflate-raw'));
  } catch {
    throw new UrlCodecError('inflate', 'parameter is not valid deflate-raw data');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UrlCodecError('json', 'decompressed payload is not valid JSON');
  }
}

/** Primary channel: burg (+ optional explicit seed) → `i=` parameter value. */
export async function encodeBurgParam(burg: AzgaarBurgInput, seed?: number): Promise<string> {
  return encodeJsonParam({ v: URL_PAYLOAD_VERSION, burg, ...(seed !== undefined ? { seed } : {}) });
}

/** Primary channel: `i=` parameter value → burg (+ optional seed). Throws UrlCodecError. */
export async function decodeBurgParam(value: string): Promise<{ burg: AzgaarBurgInput; seed?: number }> {
  const payload = await decodeJsonParam(value);
  if (typeof payload !== 'object' || payload === null) {
    throw new UrlCodecError('shape', 'payload is not an object');
  }
  const env = payload as { v?: unknown; burg?: unknown; seed?: unknown };
  if (env.v !== URL_PAYLOAD_VERSION) {
    throw new UrlCodecError('version', `unsupported payload version ${String(env.v)} (expected ${URL_PAYLOAD_VERSION})`);
  }
  const burg = env.burg as AzgaarBurgInput | undefined;
  if (typeof burg !== 'object' || burg === null ||
      typeof burg.name !== 'string' || typeof burg.population !== 'number') {
    throw new UrlCodecError('shape', 'payload has no plausible burg (name + population required)');
  }
  return { burg, ...(typeof env.seed === 'number' ? { seed: env.seed } : {}) };
}
```

Add to `src/index.ts`:

```typescript
export {
  URL_PAYLOAD_VERSION, UrlCodecError,
  encodeBurgParam, decodeBurgParam, encodeJsonParam, decodeJsonParam,
} from './url/codec.js';
export type { UrlCodecFailure } from './url/codec.js';
```

- [ ] **Step 4: Run tests to verify pass, then full suite**

Run: `nix develop --command bash -c "npx vitest run tests/url-codec.test.ts && npx vitest run"`
Expected: codec tests PASS; suite green. If TypeScript complains that `CompressionStream` is unknown in the library tsconfig (its `lib` may lack DOM), add the minimal ambient declaration to `src/url/codec.ts` rather than changing the shared tsconfig lib — but check first: the pinned TS 5.9 ships these in `lib.dom` AND recent `@types/node`-free `esnext` levels; prefer setting `"lib": ["ES2022", "DOM"]` in tsconfig only if it does not break other files, else the local `declare` block. Record which path was taken.

- [ ] **Step 5: Commit**

```bash
git add src/url/codec.ts src/index.ts tests/url-codec.test.ts
git commit -m "URL codec: deflate-raw + base64url envelope for the i= channel"
```

---

### Task 2: URL parsing — tiers, presentation params, random default

One async function turns `URLSearchParams` into everything the page needs. Precedence: `i=` wins over all flat data params; `theme=`/`style=` apply in both tiers; nothing at all → deterministic-from-injected-seed random burg.

**Files:**
- Create: `src/url/params.ts`
- Modify: `src/index.ts` (exports)
- Test: `tests/url-params.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 codec; `AzgaarBurgInput` (incl. Plan B's `biome`, `trade`, `urbanDensity`); `RenderTheme` type.
- Produces (the web page consumes exactly this):

```typescript
export interface ParsedSettlementUrl {
  burg: AzgaarBurgInput;
  seedOverride?: number;
  /** theme= preset name, validated against PALETTES by the caller. */
  paletteName?: string;
  /** style= decoded group/property overrides. */
  themeOverrides?: Partial<RenderTheme>;
  /** True when no data params were present and a demo burg was synthesized. */
  random: boolean;
}
export async function parseSettlementUrl(
  params: URLSearchParams,
  opts?: { randomSeed?: () => number },
): Promise<ParsedSettlementUrl>
```

Flat data params (documented tier): `name`, `pop`, `seed`, `port`, `citadel`, `walls`, `plaza`, `temple`, `shanty`, `capital`, `trade`, `oceanBearing`, `harbourSize` (`large`|`small`), `biome`, `urbanDensity`. Booleans accept `1/true/0/false`.

- [ ] **Step 1: Write the failing test**

Create `tests/url-params.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSettlementUrl } from '../src/url/params.js';
import { encodeBurgParam, encodeJsonParam } from '../src/url/codec.js';
import { toprak } from './fixtures/toprak.js';

const sp = (q: string) => new URLSearchParams(q);

describe('parseSettlementUrl', () => {
  it('parses the flat tier', async () => {
    const p = await parseSettlementUrl(sp('name=Salt+Harbour&pop=4200&seed=7&port=1&walls=1&plaza=1&temple=0&shanty=0&citadel=0&capital=0&trade=1&oceanBearing=135&harbourSize=large&biome=desert&urbanDensity=5'));
    expect(p.random).toBe(false);
    expect(p.burg.name).toBe('Salt Harbour');
    expect(p.burg.population).toBe(4200);
    expect(p.burg.port).toBe(true);
    expect(p.burg.walls).toBe(true);
    expect(p.burg.temple).toBe(false);
    expect(p.burg.trade).toBe(true);
    expect(p.burg.oceanBearing).toBeCloseTo(135, 5);
    expect(p.burg.harbourSize).toBe('large');
    expect(p.burg.biome).toBe('desert');
    expect(p.burg.urbanDensity).toBeCloseTo(5, 5);
    expect(p.seedOverride).toBe(7);
  });

  it('i= wins over every flat data param', async () => {
    const i = await encodeBurgParam(toprak, 99);
    const p = await parseSettlementUrl(sp(`i=${i}&name=Ignored&pop=99999&seed=1`));
    expect(p.burg).toEqual(toprak);
    expect(p.seedOverride).toBe(99); // envelope seed, not the flat one
  });

  it('presentation params apply in both tiers', async () => {
    const style = await encodeJsonParam({ buildingFill: '#123456' });
    const i = await encodeBurgParam(toprak);
    const p = await parseSettlementUrl(sp(`i=${i}&theme=classic&style=${style}`));
    expect(p.paletteName).toBe('classic');
    expect(p.themeOverrides).toEqual({ buildingFill: '#123456' });
  });

  it('no params → deterministic random demo burg from injected seed', async () => {
    const a = await parseSettlementUrl(sp(''), { randomSeed: () => 424242 });
    const b = await parseSettlementUrl(sp(''), { randomSeed: () => 424242 });
    expect(a.random).toBe(true);
    expect(a.seedOverride).toBe(424242);
    expect(a.burg).toEqual(b.burg);
    expect(a.burg.population).toBeGreaterThan(0);
  });

  it('invalid harbourSize is dropped, not passed through', async () => {
    const p = await parseSettlementUrl(sp('name=X&pop=100&port=1&harbourSize=gigantic'));
    expect(p.burg.harbourSize).toBeUndefined();
  });

  it('malformed i= propagates UrlCodecError (page renders the error card)', async () => {
    await expect(parseSettlementUrl(sp('i=%%%'))).rejects.toMatchObject({ name: 'UrlCodecError' });
  });

  it('malformed style= propagates too', async () => {
    const i = await encodeBurgParam(toprak);
    await expect(parseSettlementUrl(sp(`i=${i}&style=AAAA`))).rejects.toMatchObject({ name: 'UrlCodecError' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/url-params.test.ts"`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/url/params.ts`:

```typescript
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { RenderTheme } from '../output/render-theme.js';
import { decodeBurgParam, decodeJsonParam } from './codec.js';

export interface ParsedSettlementUrl {
  burg: AzgaarBurgInput;
  seedOverride?: number;
  /** theme= preset name; caller validates against PALETTES. */
  paletteName?: string;
  /** style= decoded overrides, merged over the palette-derived theme. */
  themeOverrides?: Partial<RenderTheme>;
  /** True when no data params were present and a demo burg was synthesized. */
  random: boolean;
}

const FLAT_DATA_PARAMS = [
  'name', 'pop', 'seed', 'port', 'citadel', 'walls', 'plaza', 'temple',
  'shanty', 'capital', 'trade', 'oceanBearing', 'harbourSize', 'biome', 'urbanDensity',
] as const;

function bool(params: URLSearchParams, key: string): boolean {
  const v = params.get(key);
  return v === '1' || v === 'true';
}

function num(params: URLSearchParams, key: string): number | undefined {
  const v = params.get(key);
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Default demo burg: everything derives from one seed so the bare URL
 * self-demos deterministically per draw. Feature flags switch on with
 * population so small draws read as hamlets and large ones as towns.
 */
function demoBurg(seed: number): AzgaarBurgInput {
  const population = 200 + (Math.abs(seed) % 4800);
  return {
    name: `Burg ${Math.abs(seed) % 10000}`,
    population,
    port: false,
    citadel: population > 3500,
    walls: population > 1500,
    plaza: population > 800,
    temple: population > 2000,
    shanty: false,
    capital: false,
  };
}

/**
 * URL → generation inputs. Tiers per the spec: `i=` (compressed envelope)
 * wins over every flat data param; `theme=`/`style=` are presentation and
 * apply in both tiers; no data params at all → random demo burg.
 * Throws UrlCodecError on malformed `i=`/`style=` — callers show it, they
 * never swallow it into a blank page.
 */
export async function parseSettlementUrl(
  params: URLSearchParams,
  opts: { randomSeed?: () => number } = {},
): Promise<ParsedSettlementUrl> {
  let burg: AzgaarBurgInput;
  let seedOverride: number | undefined;
  let random = false;

  const i = params.get('i');
  if (i !== null) {
    const decoded = await decodeBurgParam(i);
    burg = decoded.burg;
    seedOverride = decoded.seed;
  } else if (FLAT_DATA_PARAMS.some(k => params.has(k))) {
    const name = params.get('name') ?? `Burg ${num(params, 'seed') ?? num(params, 'pop') ?? 0}`;
    const harbourSizeRaw = params.get('harbourSize');
    const urbanDensity = num(params, 'urbanDensity');
    const oceanBearing = num(params, 'oceanBearing');
    burg = {
      name,
      population: num(params, 'pop') ?? 300,
      port: bool(params, 'port'),
      citadel: bool(params, 'citadel'),
      walls: bool(params, 'walls'),
      plaza: bool(params, 'plaza'),
      temple: bool(params, 'temple'),
      shanty: bool(params, 'shanty'),
      capital: bool(params, 'capital'),
      ...(bool(params, 'trade') ? { trade: true } : {}),
      ...(oceanBearing !== undefined ? { oceanBearing } : {}),
      ...(harbourSizeRaw === 'large' || harbourSizeRaw === 'small' ? { harbourSize: harbourSizeRaw } : {}),
      ...(params.get('biome') !== null ? { biome: params.get('biome')! } : {}),
      ...(urbanDensity !== undefined && urbanDensity > 0 ? { urbanDensity } : {}),
    };
    seedOverride = num(params, 'seed');
  } else {
    const seed = (opts.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 31)))();
    burg = demoBurg(seed);
    seedOverride = seed;
    random = true;
  }

  const style = params.get('style');
  const themeOverrides = style !== null
    ? (await decodeJsonParam(style)) as Partial<RenderTheme>
    : undefined;
  const paletteName = params.get('theme') ?? undefined;

  return {
    burg,
    ...(seedOverride !== undefined ? { seedOverride } : {}),
    ...(paletteName !== undefined ? { paletteName } : {}),
    ...(themeOverrides !== undefined ? { themeOverrides } : {}),
    random,
  };
}
```

Add to `src/index.ts`:

```typescript
export { parseSettlementUrl } from './url/params.js';
export type { ParsedSettlementUrl } from './url/params.js';
```

- [ ] **Step 4: Run tests, full suite, commit**

Run: `nix develop --command bash -c "npx vitest run tests/url-params.test.ts && npx vitest run"`
Expected: green.

```bash
git add src/url/params.ts src/index.ts tests/url-params.test.ts
git commit -m "URL parsing: i= envelope tier, flat tier, presentation params, demo default"
```

---

### Task 3: Web app + Netlify config

Chrome-free renderer: parse → generate → inject, SVG fills the viewport, error card on failure. Vite + vanilla TS, own `web/package.json`, `netlify.toml` at repo root.

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/style.css`
- Create: `netlify.toml`
- Modify: `.gitignore` (add `web/dist/` and `web/node_modules/`)

**Interfaces:**
- Consumes: `generateFromBurg`, `PALETTES`, `parseSettlementUrl`, `UrlCodecError` from `../../src/index.js` (source import — library changes appear instantly in the dev server; Vite compiles the TS).
- Produces: `web/dist/` static site; Netlify build contract `base=web`, `publish=dist`.

- [ ] **Step 1: Scaffold the web package**

`web/package.json`:

```json
{
  "name": "settlemaker-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

`web/tsconfig.json`:

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
  "include": ["src", "vite.config.ts", "../src"]
}
```

`web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  // The library is imported from ../src — allow it through Vite's fs guard.
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2022' },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>settlemaker</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app" role="img" aria-label="Generated settlement map"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/style.css`:

```css
html, body, #app { height: 100%; margin: 0; }
#app > svg { display: block; width: 100%; height: 100%; }
.error-card {
  max-width: 36rem; margin: 15vh auto 0; padding: 1.5rem 2rem;
  font-family: system-ui, sans-serif; color: #4a3324;
  background: #fdf6e3; border: 1px solid #c9b48a; border-radius: 8px;
}
.error-card h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
.error-card code { word-break: break-all; }
```

`web/src/main.ts`:

```typescript
import { generateFromBurg, PALETTES, parseSettlementUrl, UrlCodecError } from '../../src/index.js';

function showError(title: string, detail: string): void {
  const app = document.getElementById('app')!;
  const card = document.createElement('div');
  card.className = 'error-card';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  const code = document.createElement('code');
  code.textContent = detail;
  p.appendChild(code);
  card.append(h, p);
  app.replaceChildren(card);
}

async function main(): Promise<void> {
  try {
    const parsed = await parseSettlementUrl(new URLSearchParams(location.search));
    const palette = parsed.paletteName !== undefined ? PALETTES[parsed.paletteName] : undefined;
    if (parsed.paletteName !== undefined && palette === undefined) {
      showError('Unknown theme', `theme="${parsed.paletteName}" — known presets: ${Object.keys(PALETTES).join(', ')}`);
      return;
    }
    const { svg } = generateFromBurg(parsed.burg, {
      ...(parsed.seedOverride !== undefined ? { seed: parsed.seedOverride } : {}),
      svg: {
        ...(palette !== undefined ? { palette } : {}),
        ...(parsed.themeOverrides !== undefined ? { theme: parsed.themeOverrides } : {}),
      },
    });
    const app = document.getElementById('app')!;
    app.innerHTML = svg;
    app.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    document.title = `${parsed.burg.name} — settlemaker`;
  } catch (e) {
    if (e instanceof UrlCodecError) {
      showError(`Broken settlement link (${e.reason})`, e.message);
    } else {
      showError('Generation failed', e instanceof Error ? e.message : String(e));
    }
  }
}

void main();
```

`netlify.toml` (repo root):

```toml
[build]
  base = "web"
  command = "npm ci && npm run build"
  publish = "dist"
```

`.gitignore` — append:

```
web/node_modules/
web/dist/
```

- [ ] **Step 2: Install and build**

Run: `nix develop --command bash -c "cd web && npm install && npm run build"`
Expected: `web/dist/index.html` + hashed assets, exit 0. (First `npm install` writes `web/package-lock.json` — commit it; Netlify's `npm ci` needs it.)

- [ ] **Step 3: Smoke the built page in Node (no browser needed)**

The page logic beyond `parseSettlementUrl` (already unit-tested) is DOM injection. Assert the bundle is self-contained:

Run: `nix develop --command bash -c "node -e \"
const fs = require('fs');
const html = fs.readFileSync('web/dist/index.html', 'utf8');
if (!/type=\\\"module\\\"/.test(html)) throw new Error('no module script');
const js = fs.readdirSync('web/dist/assets').filter(f => f.endsWith('.js'));
if (js.length === 0) throw new Error('no bundled js');
const src = fs.readFileSync('web/dist/assets/' + js[0], 'utf8');
for (const marker of ['frame-clip', 'deflate-raw', 'data-bg']) {
  if (!src.includes(marker)) throw new Error('bundle missing library marker: ' + marker);
}
console.log('bundle ok:', js[0], Math.round(src.length/1024) + 'kb');
\""`
Expected: `bundle ok: …`.

- [ ] **Step 4: Visual check via dev server**

Run (background): `nix develop --command bash -c "cd web && npx vite preview --port 4173"` then open `http://localhost:4173/` (bare = random demo burg) and a real payload: generate one with `nix develop --command bash -c "npx tsx -e '…'"`-style script that prints `http://localhost:4173/?i=<encodeBurgParam(toprak)>` (write a small scratch script in the scratchpad; repo-relative imports may require running it from the repo root). Screenshot both via available browser tooling (playwright MCP) or rasterize the served SVG; a settlement must render full-viewport, and `?i=garbage` must show the error card. Record screenshots/paths in the report. Stop the preview server afterwards.

- [ ] **Step 5: Full suite + commit**

Run: `nix develop --command bash -c "npx vitest run"` (library suite unaffected but must stay green).

```bash
git add web netlify.toml .gitignore
git commit -m "web: chrome-free Vite renderer + Netlify config"
```

(Ensure `web/package-lock.json` is included and `web/dist`/`web/node_modules` are NOT.)

---

### Task 4: docs/url-api.md — the FMG adapter contract

The document Azgaar codes against. Everything in it must be copy-paste runnable against the shipped code.

**Files:**
- Create: `docs/url-api.md`

**Interfaces:**
- Consumes: Tasks 1–3 as shipped (verify names/values against source while writing, not from memory).

- [ ] **Step 1: Write the contract**

Create `docs/url-api.md` with these sections, in this order:

1. **Overview** — one paragraph: iframe-embeddable renderer, URL is the entire API, AFMG (Azgaar's Fantasy Map Generator — expand at first use) owns all surrounding UI. Base URL placeholder `https://<site>.netlify.app/`.
2. **Quick start** — three example URLs: bare (random demo), flat tier (`?name=Salt+Harbour&pop=4200&seed=7&port=1&walls=1&oceanBearing=135&harbourSize=large`), and a note that real integrations use `i=`.
3. **The `i=` payload (primary channel)** — envelope `{ v: 1, burg, seed? }`; encoding pipeline `JSON → UTF-8 → deflate-raw → base64url (no padding)`; the full `AzgaarBurgInput` interface copied verbatim from `src/input/azgaar-input.ts` (including `roadBearings`, `coastlineGeometry`, `biome`, `trade`, `urbanDensity` doc comments); a **copy-paste adapter snippet** — the actual `encodeJsonParam`-equivalent in plain browser JS:

```js
async function settlemakerUrl(base, burg, seed) {
  const payload = { v: 1, burg, ...(seed !== undefined ? { seed } : {}) };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; for (const b of packed) bin += String.fromCharCode(b);
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base}?i=${b64url}`;
}
```

4. **Flat parameters (human tier)** — a table of all 15 params with types/defaults, the boolean convention (`1/true/0/false`), and the rule that `i=` presence ignores every one of them.
5. **Presentation parameters** — `theme=<preset>` (list the actual `PALETTES` keys from source) and `style=<compressed JSON>` (same codec, payload is a partial theme object; link `docs/scene-schema.md` for the group/class vocabulary; list the `RenderTheme` keys). State: presentation params work in both tiers and never affect geometry.
6. **Guarantees** — determinism (same URL → byte-identical SVG); versioned envelope (unknown version → visible error, never a guess); errors render as a visible card with a machine-readable reason (`base64 | inflate | json | version | shape`); route fidelity, water fidelity, population budget (one line each, pointing at the spec).
7. **Evolution policy** — additive fields only; `v` bump on break; deprecations announced in this file.

- [ ] **Step 2: Verify every claim against source**

Grep-check: param names against `src/url/params.ts` `FLAT_DATA_PARAMS`; palette keys against `src/output/palette.ts`; the interface block against `src/input/azgaar-input.ts`; the JS snippet's pipeline against `src/url/codec.ts`. Fix drift in the doc, not the code.

- [ ] **Step 3: Commit**

```bash
git add docs/url-api.md
git commit -m "docs: url-api.md — the FMG adapter contract"
```

---

### Task 5: End-to-end verification

**Files:** none expected (verification only; report captures evidence).

- [ ] **Step 1: Library suite + build**

Run: `nix develop --command bash -c "npx vitest run && npm run build"`
Expected: all green, tsc exit 0.

- [ ] **Step 2: Web build from clean state**

Run: `nix develop --command bash -c "rm -rf web/dist && cd web && npm ci && npm run build"`
Expected: reproducible build (this is exactly what Netlify runs).

- [ ] **Step 3: Round-trip pipeline proof**

Scratch script (scratchpad or temp file at repo root, deleted after): encode the Toprak fixture with `encodeBurgParam`, then `parseSettlementUrl(new URLSearchParams('i=' + param))`, then `generateFromBurg` — assert the SVG is byte-identical to calling `generateFromBurg(toprak)` directly with the same seed handling, and print the full URL (with a placeholder host) plus its length. Include the URL in the report — it doubles as the first artifact to send Azgaar.

- [ ] **Step 4: Serve + eyeball**

`vite preview` again; screenshot bare URL, the Toprak `i=` URL, a `theme=classic` variant, and `?i=garbage` (error card). Attach to the report.

- [ ] **Step 5: Commit anything reconciled; report**

```bash
git status --short   # expect clean (report lives outside the tree)
```

---

## Deferred (do NOT implement in this plan)

- Netlify site creation/linking — user action (connect the GitHub repo, or `netlify deploy`); the repo is deploy-ready after Task 3.
- postMessage channel, pan/zoom, in-page controls — explicitly out of spec for v1.
- `style=` validation beyond JSON shape (unknown keys are ignored by the theme merge by construction).
- Scene/GeoJSON data-mode endpoint (AFMG-side assembly) — future, enabled by `docs/scene-schema.md`.
- FMG-side adapter PR — Azgaar's side; `docs/url-api.md` is the hand-off.
