// Symbol library sheet. Everything renders from the shipped sprite plus its
// metadata sidecar — the grid, the filters and the scale floors are all read
// from symbols.json, so a new batch drops in without touching this file.
// The village specimen is the exception: its composition is hand-placed.

import { trackEvent } from './umami.js';

const BASE = '/symbols/batch001';
const SVGNS = 'http://www.w3.org/2000/svg';

interface SymbolMeta {
  cls: string;
  // null for pattern and mark symbols: they have no fixed footprint, they fill
  // or scale to whatever parcel they are laid over.
  footprint: [number, number] | null;
  anchor: [number, number];
  rotation: string;
  zBand: string;
  tags: string[];
  minScale: number;
  viewBox: [number, number, number, number];
  materials?: string[];
  scaleTo?: string;
  /** Per-symbol credit. Carried in symbols.json so it survives a fork of the set. */
  author?: string;
  license?: string;
}

interface Catalog {
  batch: string;
  grid: number;
  markGrid: number;
  strokeWidth: number;
  license?: string;
  attribution?: string;
  symbols: Record<string, SymbolMeta>;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = (name: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

// ---- glyph table ---------------------------------------------------------

/**
 * How big a symbol gets drawn, which differs by class: fixed symbols carry a
 * footprint in map units, marks scale to their lot, patterns just fill the
 * parcel they are laid over. Reported alongside the legibility floor, since
 * those two together decide where a symbol can be placed.
 */
function sizeRule(meta: SymbolMeta): string {
  if (meta.footprint) return `${meta.footprint[0]}×${meta.footprint[1]}u`;
  if (meta.scaleTo) return meta.scaleTo;
  return `fills ${meta.zBand}`;
}

function buildGrid(catalog: Catalog): void {
  const grid = $<HTMLDivElement>('grid');
  const ids = Object.keys(catalog.symbols).sort();

  for (const id of ids) {
    const meta = catalog.symbols[id];
    const [, , vw, vh] = meta.viewBox;

    const tile = document.createElement('a');
    tile.className = 'tile';
    tile.dataset.cls = meta.cls;
    tile.dataset.minScale = String(meta.minScale);
    tile.href = `${BASE}/symbols/${id}.svg`;
    tile.setAttribute('download', '');
    tile.setAttribute('aria-label', `${id} — ${meta.cls}, ${meta.zBand} band. Download SVG.`);

    const box = document.createElement('div');
    box.className = 'glyph';
    const svg = el('svg', { viewBox: `0 0 ${vw} ${vh}` });
    svg.appendChild(el('use', { href: `#${id}` }));
    box.appendChild(svg);

    const name = document.createElement('div');
    name.className = 'id';
    name.textContent = id.replace(/^sm-/, '');

    const meta2 = document.createElement('div');
    meta2.className = 'meta';
    meta2.textContent = `${sizeRule(meta)} · ≥${meta.minScale}`;

    // Credit belongs on the artefact, not on maps drawn with it — see the
    // Rendered Output Exception in web/public/symbols/LICENSE.
    const by = document.createElement('div');
    by.className = 'byline';
    by.textContent = meta.author ? `by ${meta.author}` : '';

    tile.append(box, name, meta2, by);
    grid.appendChild(tile);
  }

  grid.addEventListener('click', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLAnchorElement>('.tile');
    if (tile) trackEvent('symbol-download', { symbol: tile.href.split('/').pop() ?? '' });
  });
}

/** Re-render at a new pixel size and flag anything now under its scale floor. */
function applySize(px: number): void {
  const scale = px / 64;
  document.documentElement.style.setProperty('--px', `${px}px`);
  $<HTMLOutputElement>('size-out').textContent = `${px}px`;

  let below = 0;
  for (const tile of document.querySelectorAll<HTMLElement>('.tile')) {
    const under = scale < Number(tile.dataset.minScale);
    tile.classList.toggle('below', under);
    if (under && !tile.classList.contains('hidden')) below++;
  }
  $<HTMLParagraphElement>('floor-note').textContent = below
    ? `${below} symbol${below === 1 ? '' : 's'} below the legibility floor at this size.`
    : '';
}

function buildFilters(catalog: Catalog): void {
  const classes = [...new Set(Object.values(catalog.symbols).map((s) => s.cls))].sort();
  const chips = $<HTMLDivElement>('filters');
  let active = 'all';

  const render = (): void => {
    for (const tile of document.querySelectorAll<HTMLElement>('.tile')) {
      tile.classList.toggle('hidden', active !== 'all' && tile.dataset.cls !== active);
    }
    for (const b of chips.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.cls === active));
    }
    applySize(Number($<HTMLInputElement>('size').value)); // recount the floor
  };

  for (const cls of ['all', ...classes]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.cls = cls;
    b.textContent = cls;
    b.setAttribute('aria-pressed', String(cls === 'all'));
    b.addEventListener('click', () => {
      active = cls;
      render();
      trackEvent('symbol-filter', { cls });
    });
    chips.appendChild(b);
  }
}

// ---- village specimen ----------------------------------------------------

// Deterministic PRNG: the specimen must be identical on every load, or it stops
// being a specimen and becomes a slot machine.
let seed = 20260806;
const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

function place(host: SVGElement, id: string, x: number, y: number, s = 1, rot = 0, shadow = false): void {
  const c = (id === 'sm-mark-church' ? 32 : 64) / 2;
  if (shadow) {
    // The shadow offset sits OUTSIDE the rotation, so light direction stays
    // constant no matter which way the symbol faces.
    const g = el('g', { transform: `translate(${x + 3.5},${y + 4.5}) scale(${s})`, color: '#46303c', opacity: 0.2 });
    const r = el('g', { transform: `rotate(${rot}) translate(${-c},${-c})` });
    r.appendChild(el('use', { href: `#${id}-sil` }));
    g.appendChild(r);
    host.appendChild(g);
  }
  const g = el('g', { transform: `translate(${x},${y}) scale(${s})` });
  const r = el('g', { transform: `rotate(${rot}) translate(${-c},${-c})` });
  r.appendChild(el('use', { href: `#${id}` }));
  g.appendChild(r);
  host.appendChild(g);
}

function placeArea(host: SVGElement, id: string, x: number, y: number, w: number, h: number, rot = 0): void {
  const g = el('g', {
    transform: `translate(${x},${y}) rotate(${rot}) scale(${w / 64},${h / 64}) translate(-32,-32)`,
  });
  g.appendChild(el('use', { href: `#${id}` }));
  host.appendChild(g);
}

function buildVillage(): void {
  const v = document.getElementById('village') as unknown as SVGElement;
  v.appendChild(el('rect', { width: 900, height: 460, fill: 'var(--parchment)' }));
  v.appendChild(el('path', {
    d: 'M900,0 L900,190 Q740,205 640,150 Q560,104 600,0 Z',
    fill: 'var(--water)', stroke: 'none',
  }));

  const K = 0.55; // everything drawn smaller than nominal so it stays legible at map scale

  const FIELD_IDS = ['sm-field', 'sm-field', 'sm-field-fallow', 'sm-field-harvested'];
  for (let i = 0; i < 7; i++) {
    const x = 30 + i * 52, y = 290 + rnd() * 40;
    const w = (44 + rnd() * 14) * K, h = (86 + rnd() * 46) * K;
    placeArea(v, FIELD_IDS[Math.floor(rnd() * FIELD_IDS.length)], x + w / 2, y + h / 2, w, h, -8 + rnd() * 16);
  }

  placeArea(v, 'sm-orchard', 780, 330, 90 * K, 90 * K, 4);
  placeArea(v, 'sm-vineyard', 690, 380, 80 * K, 60 * K, -6);
  placeArea(v, 'sm-park', 250, 250, 70 * K, 70 * K, 0);
  placeArea(v, 'sm-town-square', 372, 236, 46 * K, 46 * K, 0);

  v.appendChild(el('path', {
    d: 'M0,250 Q220,232 400,196 T760,120',
    fill: 'none', stroke: 'var(--road)', 'stroke-width': 13, 'stroke-linecap': 'round',
  }));
  placeArea(v, 'sm-road-cobbled', 340, 214, 60 * K, 22 * K, -12);
  placeArea(v, 'sm-road-dirt', 70, 258, 60 * K, 22 * K, -4);
  place(v, 'sm-bridge', 668, 138, 0.55 * K, -32, true);

  const HOUSE_IDS = ['sm-house', 'sm-house-tiled', 'sm-house-large-tiled',
    'sm-hut-mud', 'sm-hut-round', 'sm-hut-straw', 'sm-longhouse'];
  for (let i = 0; i < 44; i++) {
    const t = i / 44;
    const bx = 40 + t * 700 + (rnd() - 0.5) * 90;
    const by = 232 - t * 104 + (rnd() - 0.5) * 130;
    if (bx > 600 && by < 170) continue; // keep the water clear
    const w = 13 + rnd() * 13, h = 17 + rnd() * 15, a = (rnd() - 0.5) * 70;
    place(v, HOUSE_IDS[Math.floor(rnd() * HOUSE_IDS.length)], bx, by, ((w + h) / 2 / 48) * K, a, true);
  }

  const TREE_IDS = ['sm-tree-deciduous', 'sm-tree-deciduous-round', 'sm-tree-conifer'];
  for (const [cx, cy, n] of [[120, 120, 16], [470, 360, 14]] as const) {
    for (let i = 0; i < n; i++) {
      place(v, TREE_IDS[Math.floor(rnd() * TREE_IDS.length)],
        cx + (rnd() - 0.5) * 180, cy + (rnd() - 0.5) * 120,
        (0.42 + rnd() * 0.16) * K, rnd() * 360, true);
    }
  }

  const LANDMARKS: Array<[string, number, number, number, number, boolean]> = [
    ['sm-mill-water', 645, 196, 0.80, 24, true],
    ['sm-mill-wind', 150, 300, 0.72, 0, true],
    ['sm-well', 392, 214, 0.42, 0, true],
    ['sm-market-cross', 352, 232, 0.46, 0, true],
    ['sm-mark-church', 455, 178, 0.60, 0, false],
    ['sm-castle', 75, 180, 0.85, 8, true],
    ['sm-tower', 55, 130, 0.55, 0, true],
    ['sm-cathedral', 520, 145, 0.65, -6, true],
    ['sm-temple', 300, 165, 0.55, 0, true],
    ['sm-town-hall', 372, 260, 0.55, 4, true],
    ['sm-market', 420, 230, 0.55, -4, true],
    ['sm-inn', 410, 260, 0.50, 6, true],
    ['sm-stables', 195, 300, 0.50, -10, true],
    ['sm-mine', 60, 340, 0.55, 0, true],
    ['sm-dump', 820, 260, 0.45, 0, true],
    ['sm-docks', 700, 150, 0.50, -20, true],
    ['sm-amphitheatre', 570, 320, 0.60, 0, true],
    ['sm-racetrack', 260, 390, 0.40, 0, false],
  ];
  for (const [id, x, y, s, rot, shadow] of LANDMARKS) place(v, id, x, y, s * K, rot, shadow);
}

// ---- boot ----------------------------------------------------------------

async function main(): Promise<void> {
  // The sprite must be inlined, not <img>-referenced: cross-document <use> is
  // not resolved by browsers, and the CSS custom properties that recolour it
  // only cascade into same-document nodes. innerHTML is safe here — the sprite
  // is a first-party static asset shipped in this build, not user input.
  const [sprite, catalog] = await Promise.all([
    fetch(`${BASE}/symbols.svg`).then((r) => r.text()),
    fetch(`${BASE}/symbols.json`).then((r) => r.json() as Promise<Catalog>),
  ]);
  $<HTMLDivElement>('sprite-host').innerHTML = sprite;

  $('fact-batch').textContent = catalog.batch;
  $('fact-count').textContent = String(Object.keys(catalog.symbols).length);
  $('fact-grid').textContent = `${catalog.grid}u`;
  $('fact-stroke').textContent = `${catalog.strokeWidth}u`;

  buildGrid(catalog);
  buildFilters(catalog);
  buildVillage();

  const size = $<HTMLInputElement>('size');
  size.addEventListener('input', () => applySize(Number(size.value)));
  applySize(Number(size.value));
}

void main();
