/**
 * A caller-supplied `VillageTheme.tokens` value is untrusted input and must
 * not be able to escape the CSS rule it is written into.
 *
 * WHY (raised by the settlemaker-web session 2026-09-07, taken here as a
 * library-boundary responsibility rather than a per-consumer one): the village
 * renderer emits `:root{--key:value;...}` by string concatenation, and the web
 * consumer does `app.innerHTML = svg`. The city branch already whitelist-
 * validates its equivalent (`sanitizeThemeOverrides` in src/url/params.ts,
 * which its own comment calls "the only gate between a `style=` URL param and
 * injected SVG/CSS"). The village branch had no such gate, so a token value
 * carrying `;}` could close the rule and the block and append arbitrary CSS.
 *
 * Fixing it in the library rather than in each consumer means a consumer
 * cannot forget: settlemaker-web, questables and any future caller inherit it.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import { TEMPERATE_THEME } from '../../src/village/theme.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const BURG: AzgaarBurgInput = {
  name: 'Ashford', population: 300, port: false, citadel: false, walls: false,
  plaza: true, temple: true, shanty: false, capital: false,
};

function renderWithTokens(tokens: Record<string, string | number>): string {
  return renderVillage(generateVillage(BURG, 7), 2, { ...TEMPERATE_THEME, tokens });
}

/** The `:root{...}` rule the renderer emits, and nothing after it. */
function rootRule(svg: string): string {
  return /:root\{([^}]*)\}/.exec(svg)?.[1] ?? '';
}

describe('village theme tokens are sanitized at the library boundary', () => {
  it('keeps legitimate hex colours and numbers', () => {
    const svg = renderWithTokens({ '--sm-ink': '#123456', '--sm-sw': 3 });
    expect(rootRule(svg)).toContain('--sm-ink:#123456');
    expect(rootRule(svg)).toContain('--sm-sw:3');
  });

  it('drops a value that would close the rule and inject a new one', () => {
    const svg = renderWithTokens({ '--sm-ink': '#000;} body{display:none' });
    expect(svg).not.toContain('body{display:none');
    // and the token falls back to the built-in rather than emitting garbage
    expect(rootRule(svg)).toContain('--sm-ink:#33262e');
  });

  it('drops url() and expression payloads', () => {
    const svg = renderWithTokens({
      '--sm-ink': 'url(javascript:alert(1))',
      '--sm-stone': 'expression(alert(1))',
    });
    expect(svg).not.toContain('javascript:');
    expect(svg).not.toContain('expression(');
  });

  it('drops a malformed key rather than writing it into the rule', () => {
    const svg = renderWithTokens({ '--sm-ink;} body{color:red': '#fff' });
    expect(svg).not.toContain('body{color:red');
  });

  it('drops a non-finite number', () => {
    const svg = renderWithTokens({ '--sm-sw': Number.POSITIVE_INFINITY });
    expect(rootRule(svg)).not.toContain('Infinity');
  });

  it('leaves an untampered village byte-identical', () => {
    // The gate-approved temperate look must not move because of this change.
    const plain = renderVillage(generateVillage(BURG, 7), 2);
    const themed = renderVillage(generateVillage(BURG, 7), 2, TEMPERATE_THEME);
    expect(themed).toBe(plain);
  });
});
