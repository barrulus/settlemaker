/** Limewashed terrace roofs for the surveyed city panels.
 * Plaster stays matte; only the narrow parapet faces receive directional light.
 * The shared commerce/landmark authors can insert this flat group as a section.
 */
export function desertRoof(family, variant = 0, options = {}) {
  const scale = options.detailScale ?? 1;
  const ink = 'var(--sm-city-roof-ink, #68574b)';
  const roof = 'var(--sm-city-desert-roof, #d8cbb6)';
  const light = 'var(--sm-city-desert-light, #f0e6d4)';
  const wall = 'var(--sm-city-desert-wall, #b5aaa0)';
  const accent = 'var(--sm-city-desert-accent, #6c9c9e)';
  const fmt = value => Number(value.toFixed(2));
  const rounded = (points, radius) => points.map((p, i) => {
    const toward = q => {
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const t = length ? Math.min(.25, radius / length) : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t].map(fmt).join(',');
    };
    return `${i ? 'L' : 'M'}${toward(points[(i + points.length - 1) % points.length])} Q${p.map(fmt).join(',')} ${toward(points[(i + 1) % points.length])}`;
  }).join(' ') + 'Z';
  let body = '', sil = '';
  for (const [panelIndex, panel] of family.panels.entries()) {
    const [x0, y0, x1, y1] = panel;
    const q = ((variant + panelIndex * 3 + (panel[4] === 'x' ? 2 : 0)) % 8 + 8) % 8;
    // Detail scale controls the plaster and masonry marks, never panel extent.
    const s = Math.min(scale, (x1 - x0) / 8, (y1 - y0) / 8);
    const x = x0 + .65 * s, y = y0 + .65 * s;
    const w = (x1 - x0) / s - 1.3, h = (y1 - y0) / s - 1.3;
    let flipX = false, flipY = false;
    const local = p => [x + (flipX ? w - p[0] : p[0]) * s, y + (flipY ? h - p[1] : p[1]) * s];
    const shape = (points, fill, width = 0, extra = '', radius = .6) =>
      `<path d="${rounded(points.map(local), radius * s)}" fill="${fill}" stroke="${ink}" stroke-width="${fmt(width * s)}" ${extra}/>`;
    const line = (points, width = .25, opacity = .25) =>
      `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${local(p).map(fmt).join(',')}`).join(' ')}" fill="none" stroke="${ink}" stroke-width="${fmt(width * s)}" opacity="${opacity}"/>`;
    const circle = (u, v, radius, fill, width = 0, extra = '') => {
      const [cx, cy] = local([u, v]);
      return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(radius * s)}" fill="${fill}" stroke="${ink}" stroke-width="${fmt(width * s)}" ${extra}/>`;
    };
    const drift = [.25, .8, .45, 1.1, .55, .95, .35, .7][q];
    const outer = [[drift, .35], [w - .45, 0], [w, h * .49], [w - drift, h - .45], [.25, h], [0, h * .57]];
    const edge = rounded(outer.map(local), 1.65 * s);
    body += `<path d="${edge}" fill="${light}" stroke="${ink}" stroke-width="${fmt(.45 * s)}" stroke-opacity=".48"/>`;
    sil += `<path d="${edge}" fill="currentColor" stroke="currentColor" stroke-width="${fmt(.45 * s)}"/>`;

    const p = 1.65 + q % 3 * .18;
    const inner = [[p + drift * .3, p], [w - p, p + .2], [w - p - .12, h - p], [p + .18, h - p - .2]];
    body += shape(inner, roof, .22, 'stroke-opacity=".3"', 1.1);
    // These are opposing upright parapet faces, not two invented roof slopes.
    // Keep the walking terrace out of the renderer's paired roof-face recolour.
    body += shape([[p + drift * .3, p], [p + .7, p + .65], [p + .75, h - p - .65], [p + .18, h - p - .2]], light, 0, 'data-roof-face="negative"', .3);
    body += shape([[w - p, p + .2], [w - p - .65, p + .8], [w - p - .72, h - p - .65], [w - p - .12, h - p]], roof, 0, 'data-roof-face="positive"', .3);

    // Uneven lime repairs and a few hairline cracks avoid a ruled paving grid.
    if (w > 11 && h > 13) {
      for (let i = 0; i < 3; i++) {
        const u = p + 2 + ((q * 7 + i * 13) % 19) / 19 * (w - 2 * p - 7);
        const v = p + 3 + ((q * 3 + i * 11) % 23) / 23 * (h - 2 * p - 8);
        body += shape([[u, v], [u + 2.9, v - .25], [u + 3.6, v + 1.5], [u + 1.1, v + 2]], light, 0, 'opacity=".21"', .9);
        if ((q + i) % 2 === 0) body += line([[u, v + 3.1], [u + 1.2, v + 2.9], [u + 2, v + 3.4]], .22, .18);
      }
    }
    // Broken coping joints are sparse and alternate rather than striping roofs.
    for (let v = 4 + q % 3; v < h - 3; v += 8.7) {
      body += line([[.7, v], [p - .25, v + .13]], .24, .28);
      if (Math.round(v + q) % 3) body += line([[w - p + .25, v + .8], [w - .7, v + 1]], .24, .25);
    }
    for (let u = 4 + q % 2; u < w - 3; u += 9.3)
      body += line([[u, .65], [u + .15, p - .25]], .22, .24);

    if (options.features === false || w < 17 || h < 18) continue;
    // Access and domestic details occupy different corners between neighbours.
    flipX = q % 2 === 1;
    flipY = q % 4 >= 2;
    // Small roof-access hatch; timber rather than a glass industrial rooflight.
    const hx = p + 2.3 + (q % 2) * Math.min(5, w * .15), hy = p + 3.2;
    body += shape([[hx - .5, hy - .5], [hx + 4.5, hy - .35], [hx + 4.35, hy + 5.4], [hx - .6, hy + 5.2]], wall, .3);
    body += shape([[hx, hy], [hx + 3.8, hy + .12], [hx + 3.7, hy + 4.7], [hx - .1, hy + 4.5]], roof, .25);
    body += line([[hx + 1.2, hy + .4], [hx + 1.1, hy + 4.2]], .25, .45);
    body += line([[hx + 2.6, hy + .4], [hx + 2.5, hy + 4.2]], .25, .4);
    body += circle(hx + 3.1, hy + 2.6, .2, ink);

    // Jars, a folded mat, or a little cloth canopy give terraces human use.
    const jx = w - p - 3.2, jy = h - p - 3.4;
    body += circle(jx, jy, 1.25, wall, .22);
    body += circle(jx, jy, .68, light, .18);
    body += circle(jx, jy, .34, roof);
    if (q % 3 === 0) {
      body += circle(jx - 2.7, jy + .3, .92, wall, .2);
      body += circle(jx - 2.7, jy + .3, .4, light, .15);
    }
    const shade = q === 1 || q === 4 || q === 7 || family.key === 'shop-house';
    if (shade && w > 23 && h > 28) {
      const sx = p + 3, sy = h - p - 10, sw = Math.min(12, w - p * 2 - 7);
      // Material requests affect the optional screen only: plaster is the
      // regional roof material even when a shared caller asks for slate/tile.
      const cloth = options.material === 'shingle' ? wall : accent;
      body += shape([[sx, sy], [sx + sw, sy + .4], [sx + sw - .7, sy + 6], [sx + .45, sy + 6.5]], cloth, .25, 'opacity=".66"', .7);
      body += line([[sx + .45, sy + 3.1], [sx + sw * .53, sy + 3.5], [sx + sw - .8, sy + 3.25]], .28, .26);
      for (const [u, v] of [[sx, sy], [sx + sw, sy + .4], [sx + .45, sy + 6.5], [sx + sw - .7, sy + 6]])
        body += circle(u, v, .32, wall, .18);
    }
  }
  return {body: `<g data-roof-material="plaster" data-roof-axis="x" stroke-linejoin="round" stroke-linecap="round">${body}</g>`, sil};
}
