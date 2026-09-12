/** Original top-down vector artwork. Run: node scripts/generate-copperline.mjs */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('symbols/refined/symbols.json', root), 'utf8')).symbols;
const palette = {
  ink: '#293b40', steel: '#879ca0', light: '#cad4ce', dark: '#526c73',
  copper: '#bc8050', brass: '#e1b96e', glass: '#91d2d0', glassLine: '#d9efdf',
  paving: '#c2c8ba', seam: '#a7b2a5', green: '#658778', leaf: '#8ca68a',
};
const paint = key => `var(--cl-${key}, ${palette[key]})`;
const rect = (x, y, w, h, fill = 'steel', radius = 0, sw = 1.6) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${paint(fill)}" stroke="${paint('ink')}" stroke-width="${sw}"/>`;
const path = (d, fill = 'none', sw = 1.2, stroke = 'ink') =>
  `<path d="${d}" fill="${fill === 'none' ? 'none' : paint(fill)}" stroke="${paint(stroke)}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
const circle = (x, y, r, fill = 'copper', sw = 1.2) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${paint(fill)}" stroke="${paint('ink')}" stroke-width="${sw}"/>`;
const fan = (x, y, r = 4) => circle(x, y, r, 'dark') + circle(x, y, r * .7, 'light', .6)
  + path(`M${x-r*.5} ${y-r*.5}l${r} ${r}m0 ${-r}l${-r} ${r}`, 'none', .7) + circle(x, y, .8, 'brass', 0);
const glass = (x, y, w, h) => rect(x, y, w, h, 'glass', .3, .8)
  + path(`M${x+w/2} ${y}v${h}M${x} ${y+h/2}h${w}`, 'none', .65, 'glassLine');
const rivets = (x, y, w, h) => [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b]) => circle(a,b,.65,'brass',0)).join('');
const roof = (x, y, w, h, fill = 'steel') => rect(x,y,w,h,fill,1)
  + rect(x+2.5,y+2.5,w-5,h-5,fill,.3,.65) + rivets(x+1.2,y+1.2,w-2.4,h-2.4);
const door = (x, y, w = 8) => rect(x,y,w,2.5,'brass',0,.7);
const pipe = d => path(d,'none',3.2,'ink') + path(d,'none',1.8,'copper');
const art = {};
const names = {};
function add(id, name, body, silhouette) {
  art[id] = { body: `<g stroke-linejoin="round" stroke-linecap="round">${body}</g>`,
    ...(silhouette ? { sil: silhouette } : {}) };
  names[id] = name;
}
const boxSil = (x,y,w,h,r=1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="currentColor"/>`;
const diskSil = (x,y,r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`;

// Residential ink stays inside the original house frontage (roughly x=12..52).
add('sm-house', 'Workshop residence', roof(13,17,38,30) + glass(18,22,17,10)
  + fan(43,26) + pipe('M39 36H45V42H35') + door(27,47), boxSil(12,16,40,34));
add('sm-house-tiled', 'Solar terrace', roof(12,17,40,31,'light') + glass(17,22,24,14)
  + path('M25 22V36M33 22V36','none',.7) + fan(46,25,2.5) + rect(19,40,22,3,'copper',0,.7)
  + door(28,48), boxSil(11,16,42,35));
add('sm-house-large-tiled', 'Engineering headquarters', roof(8,14,48,36,'light')
  + glass(14,20,20,24) + roof(38,20,12,24,'dark') + fan(44,27,3.5) + fan(44,37,3.5)
  + door(26,50,12), boxSil(7,13,50,40));
add('sm-longhouse', 'Sawtooth factory', roof(8,22,48,20,'copper')
  + [12,23,34,45].map(x => rect(x,25,7,13,'light',0,.7) + glass(x,25,3,13)).join('')
  + door(27,42,10), boxSil(7,21,50,25));
add('sm-hut-straw', 'Prefab cabin', roof(14,15,36,35) + glass(19,20,17,12)
  + fan(43,24,3) + pipe('M21 40H41V35') + door(28,50), boxSil(13,14,38,39));
add('sm-hut-round', 'Pressure dome home', circle(32,32,20,'copper',1.8)
  + circle(32,32,16,'light',.8) + path('M17 26Q32 18 47 26M17 38Q32 46 47 38','none',.8)
  + glass(24,25,16,14) + door(28,51), diskSil(32,32,21)+boxSil(27,49,10,5));
add('sm-hut-mud', 'Service pod', roof(15,14,34,37,'copper') + circle(32,29,10,'light')
  + fan(32,29,7) + rect(22,43,20,4,'dark',0,.8) + door(28,51), boxSil(14,13,36,41));
add('sm-inn', 'Transit hotel', path('M10 12H54V52H40V30H24V52H10Z','light',1.8)
  + glass(15,17,34,8) + glass(15,32,5,15) + glass(44,32,5,15)
  + rect(27,34,10,13,'paving',0,.6) + circle(32,40,3,'green',.7)
  + door(26,26,12), '<path d="M9 11H55V53H39V31H25V53H9Z" fill="currentColor"/>');
add('sm-chapel', 'Turbine exchange', roof(17,10,30,43,'light') + pipe('M21 18H43V46H21')
  + fan(32,24,8) + fan(32,42,6) + door(27,53,10), boxSil(16,9,32,47));
add('sm-cathedral', 'Central generating station', roof(8,17,48,32,'copper')
  + glass(22,22,20,22) + [16,48].map(x => fan(x,26,4.5)+fan(x,39,4.5)).join('')
  + pipe('M25 13H46V20M19 47V53H38') + circle(17,13,5,'light') + circle(17,13,2.7,'dark')
  + circle(47,53,5,'light') + circle(47,53,2.7,'dark'), boxSil(7,16,50,34)+diskSil(17,13,6)+diskSil(47,53,6));
add('sm-temple', 'Research observatory', roof(10,17,44,32,'light') + circle(32,32,17,'copper',1.6)
  + circle(32,32,13,'glass',.8) + path('M22 22L42 42M24 20L44 40','none',2,'light')
  + circle(45,20,4,'brass') + door(27,49,10), boxSil(9,16,46,36)+diskSil(32,32,18));
add('sm-stone-circle', 'District heat manifold', circle(32,32,23,'paving',.7)
  + circle(32,32,16,'copper',2) + circle(32,32,11,'dark')
  + [0,60,120,180,240,300].map(a => `<g transform="rotate(${a} 32 32)">${pipe('M32 16V10')+rect(28,6,8,7,'light',1,.8)}</g>`).join('')
  + fan(32,32,8), diskSil(32,32,24));
add('sm-well', 'Public water pump', rect(17,17,30,30,'paving',3,.8) + circle(32,32,11,'copper',1.6)
  + circle(32,32,7,'glass') + pipe('M32 32H47V41') + circle(32,32,2,'brass'), boxSil(16,16,32,32,3));
add('sm-boathouse--coastal', 'Dry dock workshop', roof(8,22,48,20,'dark') + glass(12,25,30,5)
  + path('M14 39V33H50V39','none',2,'brass') + [17,29,41].map(x=>rect(x,35,8,5,'copper',0,.6)).join(''), boxSil(7,21,50,22));

// Continuous barriers retain the kit's full 64-unit pitch.
add('sm-kit-wall', 'Steel security barrier', rect(0,25,64,14,'light',0,1)
  + path('M0 29H64M0 35H64','none',1,'dark') + [8,24,40,56].map(x=>rect(x,24,3,16,'steel',0,.7)).join(''), boxSil(0,24,64,16,0));
add('sm-kit-corner', 'Barrier elbow', path('M0 25H39V64H25V39H0Z','light',1)
  + path('M0 29H35V64M0 35H29V64','none',1,'dark'), '<path d="M0 24H40V64H24V40H0Z" fill="currentColor"/>');
add('sm-kit-gate', 'Checkpoint', rect(0,27,64,10,'light',0,1) + roof(8,17,14,30)
  + roof(42,17,14,30) + glass(11,21,8,10) + glass(45,21,8,10)
  + rect(22,30,20,4,'brass',0,.8) + path('M25 30L29 34M33 30L37 34','none',1.8),
  boxSil(0,26,64,12,0)+boxSil(7,16,16,32)+boxSil(41,16,16,32));
add('sm-kit-tower-drum', 'Cooling tower', circle(32,32,21,'light',1.8) + circle(32,32,16,'copper')
  + fan(32,32,12) + [0,90,180,270].map(a=>`<g transform="rotate(${a} 32 32)">${rect(29,11,6,5,'steel',0,.7)}</g>`).join(''), diskSil(32,32,22));
add('sm-kit-tower-square', 'Communications mast', roof(14,14,36,36,'light')
  + path('M21 21L43 43M43 21L21 43','none',3,'steel') + circle(32,32,9,'copper')
  + circle(32,32,5,'glass') + path('M32 18V46M18 32H46','none',1.1), boxSil(13,13,38,38));
add('sm-kit-keep', 'Central control complex', roof(9,14,46,36,'dark') + glass(17,20,30,22)
  + roof(11,16,9,11,'light') + roof(44,16,9,11,'light') + fan(15.5,21.5,2.5) + fan(48.5,21.5,2.5)
  + door(25,50,14), boxSil(8,13,48,40));

add('sm-tree-deciduous', 'Street tree', circle(32,32,20,'green',.9)
  + circle(27,27,12,'leaf',0) + path('M23 39Q34 44 43 33','none',1,'dark'));
add('sm-tree-deciduous-small', 'Planter tree', rect(16,16,32,32,'paving',4,.65)
  + circle(32,32,14,'green',.8) + circle(28,28,9,'leaf',0));
add('sm-tree-conifer', 'Formal evergreen', path('M32 10L43 18L49 32L42 45L32 53L21 45L15 32L21 19Z','green',.8)
  + path('M32 16V47M24 25L32 31L40 25M23 36L32 41L41 36','none',1,'leaf'));

const greenShapes = {
  round: 'M8 32C8 17 20 9 33 10C49 10 56 21 55 34C54 49 43 55 29 54C15 53 8 45 8 32Z',
  lens: 'M5 32Q31 12 59 32Q32 52 5 32Z',
  'lens-long': 'M4 32Q32 20 60 32Q32 44 4 32Z',
  triangle: 'M29 9Q32 5 35 10L56 48Q59 54 51 54H13Q6 54 9 48Z',
  square: 'M13 13H51Q56 13 56 19V46Q56 51 50 51H14Q8 51 8 45V19Q8 13 13 13Z',
  d: 'M8 49V34C8 6 56 6 56 34V49Z',
};
for (const [shape,d] of Object.entries(greenShapes)) for (const variant of ['a','b']) {
  add(`sm-green-${shape}-${variant}`, `Paved ${shape} ${variant}`,
    path(d,'paving',2.2,'seam') + (variant === 'a'
      ? circle(25,31,.65,'seam',0)+circle(37,35,.65,'seam',0)
      : circle(28,34,.65,'seam',0)+circle(40,31,.65,'seam',0)));
}
// Periodic tiles: all details are inset; full-span lines meet their opposite edge.
const tile = body => rect(0,0,64,64,'paving',0,0)+body;
add('sm-field-plough', 'Solar array', tile([8,36].map(y=>[6,36].map(x =>
  rect(x,y,22,14,'dark',0,.45) + glass(x+1,y+1,20,12)).join('')).join('')));
add('sm-field-stubble', 'Container yard', tile([8,36].map((y,i)=>[6,36].map(x =>
  rect(x,y,22,14,i?'steel':'copper',0,.5) + path(`M${x+5} ${y+2}v10m6 -10v10m6 -10v10`,'none',.5,'light')).join('')).join('')));
add('sm-field-fallow', 'Concrete service yard', tile(path('M0 16H64M0 48H64M16 0V16M48 16V48M16 48V64','none',.5,'seam')));
add('sm-field-pasture', 'Managed lawn', rect(0,0,64,64,'leaf',0,0)
  + [8,24,40,56].map(y=>path(`M0 ${y}H64`,'none',.45,'green')).join(''));
add('sm-field-orchard', 'Tank farm', tile([16,48].map(y=>[16,48].map(x=>
  circle(x,y,8,'light',.65)+circle(x,y,5.5,'steel',.45)+path(`M${x-5} ${y}h10`,'none',.5,'light')).join('')).join('')));
add('sm-field-vine', 'Greenhouse beds', tile([7,37].map(y=>glass(5,y,54,20)).join('')));
add('sm-field-paddy--tropical', 'Water treatment beds', tile([7,37].map(y=>
  rect(5,y,54,20,'glass',1,.6)+path(`M8 ${y+7}H56M8 ${y+13}H56`,'none',.6,'glassLine')).join('')));
add('sm-field-irrigated--desert', 'Cooled growing beds', tile([8,40].map(y=>rect(4,y,56,16,'leaf',0,.5)).join('')
  + path('M0 2H64M0 34H64','none',2,'glass')));
add('sm-edge-hedge', 'Clipped hedge', rect(0,28,64,8,'green',0,.6)
  + path('M0 31H64','none',1.2,'leaf'));
add('sm-edge-wall', 'Concrete kerb', rect(0,29,64,6,'light',0,.7)
  + path('M16 29V35M48 29V35','none',.6,'seam'));
add('sm-edge-fence', 'Wire security fence', path('M0 29H64M0 35H64','none',.7,'dark')
  + [0,16,32,48].map(x=>path(`M${x} 29l8 6l8 -6M${x} 35l8 -6l8 6`,'none',.45,'steel')).join('')
  + [8,40].map(x=>rect(x,27,1.5,10,'dark',0,.4)).join(''));
add('sm-edge-ditch', 'Storm drain', rect(0,28,64,8,'dark',0,.5)
  + [4,12,20,28,36,44,52,60].map(x=>path(`M${x} 29v6`,'none',.7,'steel')).join(''));

// Every biome slot is covered, so selecting another terrain cannot leak old roofs.
for (const [id,meta] of Object.entries(manifest)) {
  if (art[id]) continue;
  const base = id.split('--')[0];
  const target = art[base] ? base : base === 'sm-hut' ? 'sm-hut-straw'
    : base === 'sm-kit-tower' ? 'sm-kit-tower-square'
    : meta.zBand === 'canopy' ? (/conifer|snag/.test(id) ? 'sm-tree-conifer' : /scrub|grass/.test(id) ? 'sm-tree-deciduous-small' : 'sm-tree-deciduous')
    : undefined;
  if (!target) throw new Error(`Missing Copperline artwork: ${id}`);
  art[id] = { ...art[target] };
}
const tokens = Object.fromEntries(Object.entries(palette).map(([k,v])=>[`--cl-${k}`,v]));
Object.assign(tokens, {
  '--sm-ink': palette.ink, '--sm-stone': palette.light, '--sm-timber': palette.steel,
  '--sm-void': palette.dark, '--sm-lead': palette.steel, '--sm-common': palette.paving,
  '--sm-common-band': palette.seam, '--sm-soil': palette.paving, '--sm-furrow': palette.seam,
  '--sm-canopy-a': palette.green, '--sm-canopy-b': palette.leaf, '--sm-yard': palette.paving,
});
const skin = {
  version: 1, id: 'copperline', name: 'Copperline', tokens,
  village: { ground: '#b5bfaf', water: '#709ca2', waterEdge: '#526f78', shadowColor: '#263c42', shadowOpacity: .2 },
  city: { paper: '#b5bfaf', water: '#709ca2', waterEdge: '#526f78', fieldFill: '#c2c8ba', fieldFurrow: '#a7b2a5',
    greenFill: '#8ca68a', treeFill: '#658778', roadCore: '#d4d7ca', roadCasing: '#87938d',
    buildingFill: '#879ca0', buildingStroke: '#293b40', landmarkFill: '#bc8050', shadowColor: '#263c42', shadowOpacity: .2 },
  glyphs: art,
  biomes: {
    industrial: { base: 'temperate', aliases: ['copperline', 'industrial district'] },
    steampunk: { base: 'temperate', aliases: ['brassworks', 'steam city'],
      tokens: { '--cl-steel': '#9c8e78', '--cl-light': '#ded0aa', '--cl-dark': '#615951', '--cl-copper': '#b97543',
        '--cl-brass': '#f0ca77', '--cl-glass': '#9eb8a5', '--cl-paving': '#d1c2a3', '--cl-seam': '#b5a58b',
        '--sm-common': '#d1c2a3', '--sm-common-band': '#b5a58b', '--sm-furrow': '#b5a58b' },
      village: { ground: '#baaf91', water: '#819e99', waterEdge: '#607d7a' },
      city: { paper: '#baaf91', water: '#819e99', waterEdge: '#607d7a', roadCore: '#dfd2b3', roadCasing: '#9d917b',
        buildingFill: '#9c8e78', landmarkFill: '#b97543', fieldFill: '#d1c2a3', fieldFurrow: '#b5a58b' } },
    modern: { base: 'temperate', aliases: ['technology park', 'modern city'],
      tokens: { '--cl-steel': '#9eafb8', '--cl-light': '#e1e9e5', '--cl-dark': '#456879', '--cl-copper': '#658995',
        '--cl-brass': '#efc971', '--cl-glass': '#83c8e3', '--cl-glassLine': '#e5f5fa', '--cl-paving': '#d1d9d3',
        '--cl-seam': '#b6c2bd', '--sm-common': '#d1d9d3', '--sm-common-band': '#b6c2bd', '--sm-furrow': '#b6c2bd' },
      village: { ground: '#b9caba', water: '#80afc5', waterEdge: '#628da3' },
      city: { paper: '#b9caba', water: '#80afc5', waterEdge: '#628da3', roadCore: '#e3e7de', roadCasing: '#99aaa7',
        buildingFill: '#9eafb8', landmarkFill: '#658995', fieldFill: '#d1d9d3', fieldFurrow: '#b6c2bd' } },
  },
};
// Token names must be lowercase under the portable skin contract.
const normalize = value => JSON.parse(JSON.stringify(value).replaceAll('--cl-glassLine', '--cl-glass-line'));
const definition = normalize(skin);
mkdirSync(new URL('symbols/copperline/', root), { recursive: true });
writeFileSync(new URL('docs/examples/copperline.skin.json', root), JSON.stringify(definition,null,2)+'\n');
const symbols = Object.entries(definition.glyphs).map(([id,g]) =>
  `<symbol id="${id}" viewBox="0 0 64 64">${g.body}</symbol>`
  + (g.sil ? `\n<symbol id="${id}-sil" viewBox="0 0 64 64">${g.sil}</symbol>` : '')).join('\n');
writeFileSync(new URL('symbols/copperline/symbols.svg', root), `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">\n${symbols}\n</svg>\n`);

// A self-contained contact sheet with resolved paint for SVG viewers/rasterizers.
const resolvePaint = (markup, selected) => markup.replace(/var\((--[a-z-]+),\s*[^)]+\)/g, (_,key)=>selected[key]);
const displayIds = Object.keys(names);
const cols = 6, rows = Math.ceil(displayIds.length/cols), height = 282+rows*132+68;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc">
<title id="title">Copperline — industrial settlement artwork</title><desc id="desc">Top-down SVG buildings, infrastructure and landscape tiles. Three material palettes: industrial, steampunk and modern.</desc>
<rect width="1200" height="${height}" fill="#f0eee5"/>
<g font-family="sans-serif" fill="#293b40"><text x="40" y="49" font-size="13" letter-spacing="3">SETTLEMAKER / VECTOR BIOME 01</text>
<text x="40" y="98" font-size="46" font-weight="700">COPPERLINE</text>
<text x="41" y="127" font-size="15">Rooftop machinery · copper pipework · glass roofs · engineered grounds</text>`;
Object.entries(definition.biomes).forEach(([key,preset],i)=>{
  const selected = {...definition.tokens,...preset.tokens};
  sheet += `<rect x="${40+i*382}" y="152" width="366" height="97" rx="6" fill="${preset.village?.ground ?? definition.village.ground}"/>`
    + `<text x="${56+i*382}" y="178" font-size="12" font-weight="700" letter-spacing="2">${key.toUpperCase()}</text>`
    + ['sm-house','sm-kit-tower-drum','sm-temple'].map((id,j)=>`<g transform="translate(${167+i*382+j*72} 174)">${resolvePaint(definition.glyphs[id].body,selected)}</g>`).join('');
});
displayIds.forEach((id,i)=>{
  const x=40+(i%cols)*188, y=282+Math.floor(i/cols)*132;
  sheet += `<rect x="${x}" y="${y}" width="180" height="122" rx="5" fill="#e1e3d7"/>`
    + `<g transform="translate(${x+58} ${y+7})">${definition.glyphs[id].sil ? `<g transform="translate(2 3)" color="#293b40" opacity=".15">${definition.glyphs[id].sil}</g>` : ''}${resolvePaint(definition.glyphs[id].body,definition.tokens)}</g>`
    + `<text x="${x+90}" y="${y+88}" text-anchor="middle" font-size="11" font-weight="700">${names[id]}</text>`
    + `<text x="${x+90}" y="${y+106}" text-anchor="middle" font-size="8.5" fill="#627570">${id}</text>`;
});
sheet += `<text x="40" y="${height-25}" font-size="12">${Object.keys(art).length} covered slots / ${displayIds.length} distinct drawings / 64 × 64 units / structure shadows included</text></g></svg>\n`;
writeFileSync(new URL('symbols/copperline/preview.svg',root),sheet);
console.log(`Copperline: ${Object.keys(art).length} slots. Preview: ${fileURLToPath(new URL('symbols/copperline/preview.svg',root))}`);
