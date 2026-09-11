/** Crop the already-rendered document without changing its internal viewport.
 * This also keeps historical renderers' viewport-dependent symbols identical
 * between their overview and detail images; the baseline artwork stays intact. */
export function cropReviewSvg(svg: string, box: [number, number, number, number]): string {
  const root = svg.match(/<svg\b([^>]*)>/);
  const viewBox = root?.[1].match(/\bviewBox="([^"]+)"/);
  if (!root || !viewBox) throw new Error('Review SVG needs a root viewBox');
  const [x, y, width, height] = viewBox[1].trim().split(/[\s,]+/).map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Invalid review SVG viewBox');
  }
  const attrs = root[1].replace(/\s(?:x|y|width|height)="[^"]*"/g, '');
  return svg.replace(root[0], `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}"><svg${attrs} x="${x}" y="${y}" width="${width}" height="${height}">`) + '</svg>';
}
