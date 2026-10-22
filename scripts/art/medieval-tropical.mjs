/** Fired-clay hip roofs: gently uneven eaves, small tiles and timber ridge vents.
 * Geometry stays inside each surveyed panel, including very narrow gallery roofs.
 * Separate side/end face pairs let the renderer light every slope in world space.
 */
export function tropicalRoof(family, variant = 0, options = {}) {
  const scale = options.detailScale ?? 1;
  const ink = 'var(--sm-city-roof-ink, #68574b)';
  const roof = 'var(--sm-city-tropical-roof, #a26d57)';
  const light = 'var(--sm-city-tropical-light, #c89474)';
  const wall = 'var(--sm-city-tropical-wall, #d4d9cf)';
  const timber = 'var(--sm-city-tropical-accent, #648f88)';
  const sections = [];
  let sil = '';
  const f = n => Number(n.toFixed(3));
  const section = (body, axis) => sections.push(`<g data-roof-section="${sections.length}"${axis ? ` data-roof-axis="${axis}"` : ''} stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
  const rounded = (points, radius) => points.map((p, i) => {
    const toward = q => {
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const t = length ? Math.min(.22, radius / length) : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t].map(f).join(',');
    };
    return `${i ? 'L' : 'M'}${toward(points[(i + points.length - 1) % points.length])}Q${p.map(f).join(',')} ${toward(points[(i + 1) % points.length])}`;
  }).join(' ') + 'Z';

  for (const [index, panel] of family.panels.entries()) {
    const [x0, y0, x1, y1] = panel.slice(0, 4).map(v => v / scale);
    const turned = panel[4] === 'x';
    const across = (turned ? y1 - y0 : x1 - x0);
    const along = (turned ? x1 - x0 : y1 - y0);
    // This proportional inset also works on the tiny roofs above vents/porches.
    const inset = Math.min(.75, across * .1, along * .1);
    const w = across - 2 * inset, h = along - 2 * inset;
    if (w <= 0 || h <= 0) continue;
    const local = ([u, v]) => (turned ? [x0 + inset + v, y0 + inset + u] : [x0 + inset + u, y0 + inset + v]).map(v => v * scale);
    const shape = (points, fill, width = .45, extra = '', radius = 0) => {
      const coords = points.map(local);
      const d = radius ? rounded(coords, radius * scale) : coords.map((p, i) => `${i ? 'L' : 'M'}${p.map(f).join(',')}`).join(' ') + 'Z';
      return `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${f(width * scale)}" ${extra}/>`;
    };
    const line = (points, width = .25, opacity = .32) => `<path d="${points.map(local).map((p, i) => `${i ? 'L' : 'M'}${p.map(f).join(',')}`).join(' ')}" fill="none" stroke="${ink}" stroke-width="${f(width * scale)}" opacity="${opacity}"/>`;
    const n = ((variant + index * 3) % 8 + 8) % 8;
    const irregular = Math.min(1.8, w * .065, h * .065);
    const corners = [[irregular * (.2 + n % 3 * .4), irregular * (.3 + n % 2 * .45)], [w - irregular * (.2 + n % 3 * .3), irregular * (n % 2 ? .2 : .8)], [w - irregular * (.3 + n % 4 * .22), h - irregular * (.2 + n % 3 * .2)], [irregular * (.15 + n % 2 * .3), h - irregular * (n % 2 ? .9 : .25)]];
    const ridge = w * [.48, .53, .46, .5, .54, .47, .51, .49][n];
    const hip = Math.min(w * [.43, .37, .48, .4, .45, .34, .46, .39][n], h * .27);
    const a = [ridge, hip], b = [ridge + irregular * .2, h - hip * .94];
    const radius = Math.min(1.7, w * .08, h * .08);
    const sideFaces = [[corners[0], a, b, corners[3]], [a, corners[1], corners[2], b]];
    const endFaces = [[corners[0], corners[1], a], [b, corners[2], corners[3]]];
    section(shape(corners, roof, .5, 'stroke-opacity=".65"', radius));
    sil += `<path d="${rounded(corners.map(local), radius * scale)}" fill="currentColor" stroke="currentColor" stroke-width="${f(.5 * scale)}"/>`;

    // Slopes stop at the shared hips. A narrow roof-colour rim softens the eave.
    section(sideFaces.map((points, i) => shape(points, i ? roof : light, 0, `data-roof-face="${i ? 'positive' : 'negative'}"`, radius * .65)).join(''), turned ? 'y' : 'x');
    section(endFaces.map((points, i) => shape(points, i ? roof : light, 0, `data-roof-face="${i ? 'positive' : 'negative'}"`, radius * .65)).join(''), turned ? 'x' : 'y');

    // Each short mark must sit inside its own facet; no clipping IDs and no
    // texture crossing the hips, eaves or the empty centre of a courtyard.
    const inside = (point, polygon, margin = .65) => {
      let sign = 0;
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j], q = polygon[(j + 1) % polygon.length];
        const cross = (q[0] - p[0]) * (point[1] - p[1]) - (q[1] - p[1]) * (point[0] - p[0]);
        if (Math.abs(cross) < margin * Math.hypot(q[0] - p[0], q[1] - p[1])) return false;
        const current = Math.sign(cross);
        if (sign && current !== sign) return false;
        sign = current;
      }
      return true;
    };
    let texture = '';
    for (const [facetIndex, original] of [...sideFaces, ...endFaces].entries()) {
      const swap = facetIndex >= 2;
      const facet = swap ? original.map(([u, v]) => [v, u]) : original;
      const convert = p => swap ? [p[1], p[0]] : p;
      const lowX = Math.min(...facet.map(p => p[0])), highX = Math.max(...facet.map(p => p[0]));
      const lowY = Math.min(...facet.map(p => p[1])), highY = Math.max(...facet.map(p => p[1]));
      for (let course = 0, u = lowX + 1.8; u < highX - .7; u += 2.8, course++) {
        for (let tile = 0, v = lowY + 1 + (course % 2) * 2; v < highY - .7; v += 4.1, tile++) {
          if ((course + tile + n) % 9 === 0) continue;
          const mark = [[u, v], [u + .13, v + 1.7], [u, v + 3.6]];
          if (mark.every(p => inside(p, facet))) texture += line(mark.map(convert), .25, .29);
          const joint = [[u, v], [u + 2.25, v + .12]];
          if ((tile + n) % 4 !== 0 && joint.every(p => inside(p, facet))) texture += line(joint.map(convert), .22, .26);
        }
      }
    }
    texture += [corners[0], corners[1]].map(p => line([p, a], .45, .42)).join('');
    texture += [corners[2], corners[3]].map(p => line([p, b], .45, .42)).join('');
    texture += line([a, [ridge + irregular * .08, h * .5], b], .65, .5);
    for (let v = hip + 1.3; v < h - hip - .6; v += 4.1)
      texture += line([[ridge - .5, v], [ridge + .6, v + .1]], .4, .45);
    section(texture);

    if (options.features !== false && w > 11 && h > 21) {
      // Low, airy ridge vent: dark timber louvres under a tiny tiled cover.
      const length = Math.min(9 + n % 3 * 1.6, (h - 2 * hip) * .55);
      const half = Math.min(2.3, w * .09);
      const start = h * .5 - length * .5, end = start + length;
      section(shape([[ridge - half, start], [ridge + half, start + .1], [ridge + half, end + .8], [ridge - half, end + .7]], wall, .35, '', .35)
        + shape([[ridge - half + .35, start + .5], [ridge + half - .35, start + .6], [ridge + half - .35, end + .45], [ridge - half + .35, end + .35]], timber, 0));
      let louvres = '';
      for (let v = start + 1; v < end; v += 1.6) louvres += line([[ridge - half + .4, v], [ridge + half - .4, v + .08]], .26, .6);
      section(louvres);
      section(shape([[ridge - half - .2, start], [ridge, start - .3], [ridge, end - .5], [ridge - half - .2, end]], light, .25, 'data-roof-face="negative"', .2)
        + shape([[ridge, start - .3], [ridge + half + .2, start + .05], [ridge + half + .2, end + .05], [ridge, end - .5]], roof, .25, 'data-roof-face="positive"', .2), turned ? 'y' : 'x');
    }
    if (family.key === 'shop-house' && options.features !== false && w > 15 && h > 20) {
      // A cloth-covered street threshold identifies the shop without extending
      // beyond its roof silhouette or borrowing space from the neighbouring lot.
      section(shape([[w * .17, h - 4.1], [w * .81, h - 4], [w * .83, h - 2.15], [w * .15, h - 2.3]], timber, .35, 'stroke-opacity=".65"', .45)
        + line([[w * .32, h - 3.9], [w * .31, h - 2.5]], .22, .4)
        + line([[w * .5, h - 3.9], [w * .5, h - 2.4]], .22, .4)
        + line([[w * .67, h - 3.9], [w * .68, h - 2.4]], .22, .4));
    }
  }
  return {body: `<g data-roof-sections="true">${sections.join('')}</g>`, sil};
}
