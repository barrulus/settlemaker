// Human-facing builder for the /fmg image endpoint. Collects form values,
// constructs the flat-parameter URL (the same contract documented in
// docs/url-api.md), previews it in an iframe, and hands out the direct link.
import { PALETTES } from '../../src/output/palette.js';
import { trackEvent } from './umami.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const frame = $<HTMLIFrameElement>('frame');
const openLink = $<HTMLAnchorElement>('open');
const copied = $<HTMLParagraphElement>('copied');

// Theme presets come from the library so the list can never drift.
const themeSelect = $<HTMLSelectElement>('theme');
for (const name of Object.keys(PALETTES)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  if (name === 'default') opt.selected = true;
  themeSelect.appendChild(opt);
}

const checkbox = (id: string): boolean => $<HTMLInputElement>(id).checked;
const text = (id: string): string => $<HTMLInputElement>(id).value.trim();

/** What people actually build — the parameters, never the settlement name. */
function trackGenerate(source: 'submit' | 'dice'): void {
  trackEvent('generate', {
    source,
    pop: Math.max(10, Number(text('pop')) || 300),
    theme: themeSelect.value,
    port: checkbox('port'),
    walls: checkbox('walls'),
    seeded: text('seed') !== '',
  });
}

function buildImageUrl(): string {
  const p = new URLSearchParams();
  p.set('name', text('name') || 'Settlement');
  p.set('pop', String(Math.max(10, Number(text('pop')) || 300)));
  if (text('seed') !== '') p.set('seed', text('seed'));

  for (const flag of ['walls', 'plaza', 'temple', 'citadel', 'capital', 'shanty', 'trade', 'port']) {
    if (checkbox(flag)) p.set(flag, '1');
  }
  if (checkbox('port')) {
    if (text('oceanBearing') !== '') p.set('oceanBearing', text('oceanBearing'));
    p.set('harbourSize', $<HTMLSelectElement>('harbourSize').value);
  }

  const theme = themeSelect.value;
  if (theme !== 'default') p.set('theme', theme);
  if (text('urbanDensity') !== '') p.set('urbanDensity', text('urbanDensity'));
  if (text('biome') !== '') p.set('biome', text('biome'));

  return `/fmg?${p.toString()}`;
}

function generate(): void {
  const url = buildImageUrl();
  frame.src = url;
  openLink.href = url;
  copied.textContent = '';
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  generate();
  trackGenerate('submit');
});

$<HTMLButtonElement>('copy').addEventListener('click', () => {
  const absolute = new URL(buildImageUrl(), location.origin).toString();
  // The real conversion: someone taking the URL away to embed it.
  trackEvent('copy-link');
  void navigator.clipboard.writeText(absolute).then(
    () => { copied.textContent = `Copied: ${absolute}`; },
    () => { copied.textContent = absolute; }, // clipboard blocked → show it instead
  );
});

$<HTMLInputElement>('port').addEventListener('change', () => {
  $<HTMLDivElement>('port-opts').classList.toggle('hidden', !checkbox('port'));
});

// Dice button: pick a fresh seed and re-render immediately, so repeated clicks
// walk through variants of the same settlement.
$<HTMLButtonElement>('reseed').addEventListener('click', () => {
  $<HTMLInputElement>('seed').value = String(Math.floor(Math.random() * 1_000_000));
  generate();
  trackGenerate('dice');
});

// Log-uniform over 50–20,000 rather than flat over the field's full 10–200,000:
// a flat roll would return a city nine times in ten, and settlements of this era
// skew heavily small. Rounded to a readable figure for its magnitude.
$<HTMLButtonElement>('repop').addEventListener('click', () => {
  const raw = Math.exp(Math.log(50) + Math.random() * (Math.log(20000) - Math.log(50)));
  const step = raw < 500 ? 10 : raw < 5000 ? 50 : 500;
  $<HTMLInputElement>('pop').value = String(Math.round(raw / step) * step);
  $<HTMLInputElement>('pop').dispatchEvent(new Event('input')); // refresh the >50k warning
  generate();
  trackGenerate('dice');
});

$<HTMLButtonElement>('clear-seed').addEventListener('click', () => {
  $<HTMLInputElement>('seed').value = '';
  generate();
});

$<HTMLInputElement>('pop').addEventListener('input', () => {
  const pop = Number(text('pop')) || 0;
  $<HTMLParagraphElement>('pop-warn').classList.toggle('hidden', pop <= 50000);
});

// First render on load.
generate();
