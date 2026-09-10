/**
 * The refined set's own token values (symbols/refined/symbols.json →
 * tokens), so every fill class resolves without a stylesheet needing to
 * guess a colour: the sprite markup already carries
 * `fill="var(--sm-timber, #d9c39a)"` inline, and this block only has to
 * supply the CSS variable to re-tint it. Values copied by hand from
 * symbols.json (not imported — the manifest module carries placement
 * metadata, not the token/colour table), matched 1:1 against the keys
 * integration.md documents.
 */
export const SM_TOKENS: Record<string, string | number> = {
  '--sm-ink': '#33262e', '--sm-sw': 2, '--sm-stone': '#e8dcc0', '--sm-timber': '#d9c39a',
  '--sm-void': '#6b5460', '--sm-yard': '#dfd3b3', '--sm-lead': '#8d99a6', '--sm-lead-ink': '#5c6670',
  '--sm-canopy-a': '#4f7f43', '--sm-canopy-b': '#74a552', '--sm-canopy-shade': '#3a6338',
  '--sm-canopy-vein': '#2c5330', '--sm-portcullis': '#d8bd7e', '--sm-mud': '#c99a63',
  '--sm-mud-dark': '#b3854f', '--sm-thatch': '#d8bd7e', '--sm-snow': '#f2f6f8',
  '--sm-shingle': '#a89a86', '--sm-yard-sand': '#d9c48f', '--sm-dry': '#9aa86a', '--sm-dry-b': '#b8bf7e',
  '--sm-olive': '#7f9463', '--sm-olive-b': '#9aac78', '--sm-needle': '#33613c', '--sm-needle-b': '#4a7c48',
  '--sm-frond': '#3f7a3c', '--sm-leaf': '#2f6b34', '--sm-tamarisk': '#5d8a5e', '--sm-tamarisk-b': '#82a878',
  '--sm-common': '#a8bf6d', '--sm-soil': '#dcc39e', '--sm-furrow': '#c2a37c', '--sm-crop': '#cbc190',
  '--sm-paddy': '#a9c6c2', '--sm-common-band': '#8aa855',
};

/**
 * Class categories in the refined sprites, by what their markup already
 * carries inline (checked against symbols/refined/{symbols,symbols-biomes,
 * symbols-parcel}.svg):
 *
 * - FILL classes (sm-stone, sm-timber, ...) already carry
 *   `fill="var(--sm-x, #hex)"` inline, so they render correctly with no
 *   stylesheet at all — but never a stroke, so they need `stroke:
 *   var(--sm-ink)` here or a building reads as an unbordered flat.
 * - LINE classes (sm-hatch, sm-ridge, sm-spire) carry neither: their
 *   markup is bare `<path d="M... L...">` strokes. Without `fill:none`
 *   here, the SVG default (solid black fill) would paint the enclosed
 *   area of a zigzag hatch line rather than leave it as a line.
 * - Everything else used by the temperate deck (sm-yard, and every
 *   canopy-* / green-* class) already carries BOTH fill and stroke inline
 *   and needs no rule at all — left out deliberately, not missed.
 *
 * Unlike batch001, no `-sil` twin in this set duplicates the body's
 * classed children: every one is a single flat
 * `fill="currentColor" stroke="currentColor"` shape (see
 * scripts/extract-refined-glyphs.ts's structure-band sil requirement), so
 * there is no `.sm-sil .sm-x{...}` override to write here.
 */
const SM_FILL_INK_CLASSES = [
  'sm-stone', 'sm-timber', 'sm-void', 'sm-lead', 'sm-mud', 'sm-mud-dark', 'sm-shingle', 'sm-snow',
  'sm-thatch', 'sm-tamarisk', 'sm-tamarisk-b', 'sm-leaf', 'sm-frond', 'sm-olive', 'sm-olive-b',
  'sm-dry', 'sm-dry-b', 'sm-needle', 'sm-needle-b', 'sm-yard-sand',
];
const SM_LINE_INK_CLASSES = ['sm-hatch', 'sm-ridge', 'sm-spire'];

/** A custom property name: `--` then letters, digits and hyphens only. */
const SM_TOKEN_KEY = /^--[a-z0-9-]+$/i;
/** `#rgb` .. `#rrggbbaa`. */
const SM_TOKEN_HEX = /^#[0-9a-f]{3,8}$/i;
/** The only bare words a token may carry. */
const SM_TOKEN_KEYWORDS = new Set(['none', 'transparent', 'currentColor']);

/**
 * Whitelist caller-supplied theme tokens before they are concatenated into
 * the `:root{...}` rule.
 *
 * Every value here is untrusted: it is written into CSS by string
 * concatenation and consumers render the result with `innerHTML`, so a value
 * containing `;}` could close the declaration and the block and append rules
 * of its own. Anything that is not a hex colour, a finite number or one of a
 * few keywords is DROPPED rather than escaped — the built-in token then
 * applies, which degrades to the stock look instead of to broken CSS. This
 * mirrors `sanitizeThemeOverrides` on the city branch, which guards the
 * equivalent `style=` payload.
 */
export function sanitizeVillageTokens(
  tokens?: Record<string, string | number>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (tokens == null) return out;
  for (const [k, v] of Object.entries(tokens)) {
    if (!SM_TOKEN_KEY.test(k)) continue;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
      continue;
    }
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (SM_TOKEN_HEX.test(s) || SM_TOKEN_KEYWORDS.has(s)) out[k] = s;
  }
  return out;
}

export const refinedStyle = (tokens?: Record<string, string | number>): string => [
  `:root{${Object.entries({ ...SM_TOKENS, ...sanitizeVillageTokens(tokens) })
    .map(([k, v]) => `${k}:${v}`).join(';')}}`,
  ...SM_FILL_INK_CLASSES.map((c) => `.${c}{stroke:var(--sm-ink,#33262e);stroke-linejoin:round;stroke-linecap:round}`),
  ...SM_LINE_INK_CLASSES.map((c) => `.${c}{fill:none;stroke:var(--sm-ink,#33262e);stroke-linecap:round}`),
  // Pass 5: field furrow and edge-stamp line strokes carry no class of
  // their own (bare `fill="none" stroke-width="..."` paths, unlike the
  // sm-hatch/sm-ridge family above) — their colour comes entirely from
  // CSS, so without these rules they render invisible (default SVG stroke
  // is `none`, not black — still wrong, just a different failure than the
  // classed lines' flat-black one). Scoped by the def id prefix this
  // renderer itself assigns (defBlock's `<g id="${glyph}">`) since the
  // vendored markup gives no class to hook a selector to. Canopy glyphs
  // already carry inline fill+stroke like the greens do (nothing to add).
  `g[id^="sm-field-"] path[fill="none"]{stroke:var(--sm-furrow,#c2a37c);stroke-linecap:round}`,
  `g[id^="sm-edge-"] path[fill="none"]{stroke:var(--sm-ink,#33262e);stroke-linecap:round}`,
  // Edge stamps' FILLED shapes (hedge foliage, wall stones, fence posts)
  // carry `fill="var(--sm-x, #hex)"` inline but no stroke, same gap
  // SM_FILL_INK_CLASSES closes for buildings — same fix, scoped the same
  // way since these paths carry no class either.
  `g[id^="sm-edge-"] path[fill^="var(--sm-"]{stroke:var(--sm-ink,#33262e);stroke-linejoin:round;stroke-linecap:round}`,
].join('');

