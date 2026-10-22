import { blend, cssHex, type RenderTheme } from './render-theme.js';

/** Two inherited paints let rotated instances share one detailed roof glyph.
 * Use SVG presentation attributes so exported/rasterized SVG needs no CSS vars.
 * The marked planes in a housing glyph all share its local slope axis.
 */
export function prepareRoofLighting(body: string, resolvePaint: (paint: string) => string): {
  body: string;
  attributes: (rotationDeg: number, shadow: RenderTheme['shadowOffset']) => string;
} | undefined {
  const axis = /data-roof-axis="([xy])"/.exec(body)?.[1];
  if (!axis) return undefined;
  let base = '', light = '';
  const litBody = body.replace(/<path\b[^>]*data-roof-face="(negative|positive)"[^>]*\/>/g, (path, face: string) => {
    return path.replace(/fill="([^"]*)"/, (_: string, paint: string) => {
      if (face === 'negative') light = resolvePaint(paint);
      else base = resolvePaint(paint);
      return `fill="${face === 'negative' ? 'inherit' : 'currentColor'}"`;
    });
  });
  if (!base || !light) return undefined;
  const rgb = (paint: string): number | undefined => {
    if (/^#[\da-f]{3}$/i.test(paint)) return parseInt([...paint.slice(1)].map(c => c + c).join(''), 16);
    return /^#[\da-f]{6}$/i.test(paint) ? parseInt(paint.slice(1), 16) : undefined;
  };
  const darkRgb = rgb(base), lightRgb = rgb(light);
  const shade = (amount: number) => darkRgb === undefined || lightRgb === undefined
    ? base : cssHex(blend(darkRgb, lightRgb, amount));
  return {
    body: litBody,
    attributes(rotationDeg, { dx, dy }) {
      const angle = (rotationDeg + (axis === 'y' ? 90 : 0)) * Math.PI / 180;
      const length = Math.hypot(dx, dy);
      // The negative roof face points toward the light when the positive
      // slope axis points along the ground shadow. Scaling along either
      // local axis does not change these axis-aligned plane normals.
      const incidence = length ? Math.max(-1, Math.min(1, (dx * Math.cos(angle) + dy * Math.sin(angle)) / length)) : 0;
      return ` fill="${shade(.36 * (1 + incidence))}" color="${shade(.36 * (1 - incidence))}"`;
    },
  };
}
