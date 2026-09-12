// Frozen compatibility data for existing generator APIs.
// Current artwork is authored in scripts/art and built by scripts/build-runtime-art.mjs.

export type RefinedSymbolClass = 'fixed' | 'mark' | 'canopy' | 'pattern';
export type RefinedSymbolZBand = 'ground' | 'parcel' | 'route' | 'structure' | 'canopy' | 'overlay';
export interface RefinedSymbolMeta {
  cls: RefinedSymbolClass;
  viewBox: [number, number, number, number];
  footprint: [number, number] | null;
  anchor: [number, number];
  rotation?: 'invariant' | 'free' | 'locked' | 'snap-cardinal';
  zBand: RefinedSymbolZBand;
  minScale: number;
  tags: string[];
}

export const REFINED_MANIFEST: Record<string, RefinedSymbolMeta> = {
  "sm-house": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling"
    ]
  },
  "sm-house-tiled": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8.6,
      6.9
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling"
    ]
  },
  "sm-house-large-tiled": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      13.5,
      10.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling",
      "wealthy"
    ]
  },
  "sm-longhouse": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      7.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "rural"
    ]
  },
  "sm-hut-straw": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.4,
      6.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-hut-mud": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.4,
      6.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-hut-round": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.4,
      6.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-inn": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      17,
      15
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.45,
    "tags": [
      "commerce",
      "lodging"
    ]
  },
  "sm-cathedral": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      42,
      26
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.25,
    "tags": [
      "faith",
      "landmark"
    ]
  },
  "sm-chapel": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      14,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "faith"
    ]
  },
  "sm-temple": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      22,
      17
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "faith",
      "classical"
    ]
  },
  "sm-stone-circle": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      30,
      30
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "faith",
      "ancient"
    ]
  },
  "sm-kit-wall": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-corner": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      12
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-gate": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "route"
    ]
  },
  "sm-kit-tower-drum": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.4,
      6.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-tower-square": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.6,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-keep": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      15,
      11
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "dwelling"
    ]
  },
  "sm-well": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      3.6,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.5,
    "tags": [
      "amenity"
    ]
  },
  "sm-tree-deciduous": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      7,
      7
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-tree-deciduous-small": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      5.4,
      5.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-tree-conifer": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.2,
      6.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-house--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling"
    ]
  },
  "sm-hut--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      5.8,
      5.8
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-longhouse--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      8.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "rural"
    ]
  },
  "sm-well--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      3.6,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.5,
    "tags": [
      "amenity"
    ]
  },
  "sm-house--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling"
    ]
  },
  "sm-hut--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.4,
      6.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-longhouse--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      7.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "rural"
    ]
  },
  "sm-well--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      3.6,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.5,
    "tags": [
      "amenity"
    ]
  },
  "sm-house--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      9,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling"
    ]
  },
  "sm-hut--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.4,
      6.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-longhouse--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      17,
      9.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "rural"
    ]
  },
  "sm-well--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      3.6,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.5,
    "tags": [
      "amenity"
    ]
  },
  "sm-house--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "dwelling"
    ]
  },
  "sm-hut--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      5.4,
      4.8
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "poor"
    ]
  },
  "sm-boathouse--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.4,
    "tags": [
      "dwelling",
      "rural"
    ]
  },
  "sm-well--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      3.6,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.5,
    "tags": [
      "amenity"
    ]
  },
  "sm-palm-date--desert": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.6,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-olive--desert": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      5.4,
      5.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-scrub--desert": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      4.4,
      4.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-conifer--tundra": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.2,
      6.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.4,
    "tags": [
      "vegetation"
    ]
  },
  "sm-snag--tundra": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.2,
      6.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.4,
    "tags": [
      "vegetation"
    ]
  },
  "sm-palm-fan--tropical": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      7.2,
      7.2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-broadleaf--tropical": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      7,
      7
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-dune-grass--coastal": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      4,
      4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "canopy",
    "minScale": 0.45,
    "tags": [
      "vegetation"
    ]
  },
  "sm-tamarisk--coastal": {
    "cls": "canopy",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      5.4,
      5.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "canopy",
    "minScale": 0.3,
    "tags": [
      "vegetation"
    ]
  },
  "sm-inn--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      17,
      15
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.45,
    "tags": [
      "commerce",
      "lodging"
    ]
  },
  "sm-chapel--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      14,
      14
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "faith",
      "landmark"
    ]
  },
  "sm-inn--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      17,
      15
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.45,
    "tags": [
      "commerce",
      "lodging"
    ]
  },
  "sm-chapel--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      7.4,
      14.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "faith"
    ]
  },
  "sm-inn--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      17,
      15
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.45,
    "tags": [
      "commerce",
      "lodging"
    ]
  },
  "sm-chapel--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      12
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "faith",
      "landmark"
    ]
  },
  "sm-inn--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      17,
      15
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.45,
    "tags": [
      "commerce",
      "lodging"
    ]
  },
  "sm-chapel--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      14,
      10.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "faith"
    ]
  },
  "sm-kit-wall--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-gate--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "route"
    ]
  },
  "sm-kit-tower--desert": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.6,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-wall--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-gate--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "route"
    ]
  },
  "sm-kit-tower--tundra": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.6,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-wall--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-gate--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "route"
    ]
  },
  "sm-kit-tower--tropical": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.6,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-wall--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      3.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.3,
    "tags": [
      "fortification"
    ]
  },
  "sm-kit-gate--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      7.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "snap-cardinal",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "route"
    ]
  },
  "sm-kit-tower--coastal": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6.6,
      6.6
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "invariant",
    "zBand": "structure",
    "minScale": 0.35,
    "tags": [
      "fortification",
      "navigation",
      "landmark"
    ]
  },
  "sm-green-round-a": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      30,
      30
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-round-b": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      30,
      30
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-lens-a": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      40,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-lens-b": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      40,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-lens-long-a": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      56,
      14
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-lens-long-b": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      56,
      14
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-triangle-a": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      34,
      30
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-triangle-b": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      34,
      30
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-square-a": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      34,
      26
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-square-b": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      34,
      26
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-d-a": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      32,
      24
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-green-d-b": {
    "cls": "fixed",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      32,
      24
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.25,
    "tags": [
      "open-ground",
      "green"
    ]
  },
  "sm-field-plough": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "arable"
    ]
  },
  "sm-field-stubble": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "arable",
      "harvested"
    ]
  },
  "sm-field-fallow": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "fallow"
    ]
  },
  "sm-field-pasture": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      12,
      12
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "pasture"
    ]
  },
  "sm-field-orchard": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      24,
      24
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "orchard"
    ]
  },
  "sm-field-vine": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      16,
      16
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "vine"
    ]
  },
  "sm-field-paddy--tropical": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      24,
      24
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "paddy",
      "irrigated"
    ]
  },
  "sm-field-irrigated--desert": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      24,
      24
    ],
    "anchor": [
      32,
      32
    ],
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "field",
      "arable",
      "irrigated"
    ]
  },
  "sm-edge-hedge": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8,
      2
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "boundary",
      "hedge"
    ]
  },
  "sm-edge-wall": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      8,
      1.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "boundary",
      "drystone"
    ]
  },
  "sm-edge-fence": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      6,
      1.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "boundary",
      "fence"
    ]
  },
  "sm-edge-ditch": {
    "cls": "pattern",
    "viewBox": [
      0,
      0,
      64,
      64
    ],
    "footprint": [
      10,
      2.4
    ],
    "anchor": [
      32,
      32
    ],
    "rotation": "free",
    "zBand": "parcel",
    "minScale": 0.3,
    "tags": [
      "boundary",
      "ditch"
    ]
  }
};
