import { blend, cssHex, type RenderTheme } from './render-theme.js';

interface RoofLighting {
  body: string;
  attributes: (rotationDeg: number, shadow: RenderTheme['shadowOffset'], stretch?: number) => string;
  uses?: (rotationDeg: number, shadow: RenderTheme['shadowOffset'], stretch?: number) => string;
}

/** Two inherited paints let rotated instances share one detailed roof section.
 * Use SVG presentation attributes so exported/rasterized SVG needs no CSS vars.
 * Compound buildings keep a separate slope axis for each authored section.
 */
export function prepareRoofLighting(body: string, resolvePaint: (paint: string) => string, id?: string): RoofLighting | undefined {
  if (id && body.startsWith('<g data-roof-sections="true">')) {
    // Authoring contract: each section is a flat group of paths. Preserve its
    // paint order so lanterns and dormers can sit above the main roof panels.
    const sections = [...body.matchAll(/<g data-roof-section="\d+"[^>]*>[\s\S]*?<\/g>/g)]
      .map(([part], i) => ({ id: `${id}-roof-${i}`, lighting: prepareRoofLighting(part, resolvePaint)
        ?? { body: part, attributes: () => '' } }));
    if (!sections.length) return undefined;
    return {
      body: sections.map(s => `<g id="${s.id}">${s.lighting.body}</g>`).join(''),
      attributes: () => '',
      uses: (rotation, shadow, stretch) => sections.map(s => `<use href="#${s.id}"${s.lighting.attributes(rotation, shadow, stretch)}/>`).join(''),
    };
  }
  const axis = /data-roof-axis="(x|y|-?\d+(?:\.\d+)?)"/.exec(body)?.[1];
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
    attributes(rotationDeg, { dx, dy }, stretch = 1) {
      let angle = (rotationDeg + (axis === 'y' ? 90 : 0)) * Math.PI / 180;
      if (axis !== 'x' && axis !== 'y') {
        const normal = Number(axis) * Math.PI / 180;
        // Cone facets use oblique normals. Transform these by inverse scale
        // before rotating, so stretched round towers retain coherent light.
        angle = rotationDeg * Math.PI / 180 + Math.atan2(Math.sin(normal) / (stretch > 0 ? stretch : 1), Math.cos(normal));
      }
      const length = Math.hypot(dx, dy);
      // The negative roof face points toward the light when the positive
      // slope axis points along the ground shadow. Axis-aligned normals
      // are unchanged by scaling, while oblique normals are handled above.
      const incidence = length ? Math.max(-1, Math.min(1, (dx * Math.cos(angle) + dy * Math.sin(angle)) / length)) : 0;
      return ` fill="${shade(.36 * (1 + incidence))}" color="${shade(.36 * (1 - incidence))}"`;
    },
  };
}
