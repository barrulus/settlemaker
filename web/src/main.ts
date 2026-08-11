import { generateFromBurg, PALETTES, parseSettlementUrl, UrlCodecError } from '../../src/index.js';
import { initAnalytics, trackInteractionOnce, viewContext } from './analytics.js';
import { attachPanZoom } from './pan-zoom.js';

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
  // Report the view before rendering, so a settlement that fails to generate
  // still counts as a visit — those are the ones worth knowing about.
  const context = viewContext();
  initAnalytics(context);

  try {
    const parsed = await parseSettlementUrl(new URLSearchParams(location.search));
    const palette = parsed.paletteName !== undefined && Object.hasOwn(PALETTES, parsed.paletteName)
      ? PALETTES[parsed.paletteName]
      : undefined;
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
    // Safe: the assembler embeds no input-derived strings (names are never rendered; theme values are sanitized). Re-audit before ever rendering burg names into the SVG.
    app.innerHTML = svg;
    const root = app.querySelector('svg');
    root?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    document.title = `${parsed.burg.name} — settlemaker`;

    // Chrome only for a visitor who actually landed here. Inside an iframe this
    // is the machine endpoint and must stay bare — an embedder asked for a map,
    // not for our buttons intercepting their scroll.
    if (context === 'top' && root !== null) {
      attachPanZoom(root, trackInteractionOnce());
    }
  } catch (e) {
    if (e instanceof UrlCodecError) {
      showError(`Broken settlement link (${e.reason})`, e.message);
    } else {
      showError('Generation failed', e instanceof Error ? e.message : String(e));
    }
  }
}

void main();
