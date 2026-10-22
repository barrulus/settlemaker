import { medievalHousing } from './medieval-housing.mjs';

const palette = {
  roof:'#84918d', light:'#b2b9ad', wall:'#d0c8b5', accent:'#99866d',
};
const regional = body => body.replace(/var\(--sm-city-temperate-(roof|light|wall|accent),[^)]+\)/g,
  (_, name) => `var(--sm-city-coastal-${name}, ${palette[name]})`);
const fmt = value => Number(value.toFixed(2));

/** Salt-weathered timber roofs, with softly uneven eaves and wooden ridge caps.
 * The house primitive supplies the bounded silhouettes and staggered shingles;
 * raised roof access remains small timber dormers, rather than glazed panels.
 */
export function coastalRoof(family, variant = 0, options = {}) {
  const art = medievalHousing(family, variant, {...options, material:'shingle'});
  const scale = options.detailScale ?? 1;
  const ink = 'var(--sm-city-roof-ink, #68574b)';
  const timber = `var(--sm-city-coastal-accent, ${palette.accent})`;
  let caps = '';
  for (const [i,panel] of family.panels.entries()) {
    const [x0,y0,x1,y1] = panel.slice(0,4).map(v => v / scale);
    const horizontal = panel[4] === 'x';
    const w = (horizontal ? y1-y0 : x1-x0)-1.6;
    const h = (horizontal ? x1-x0 : y1-y0)-1.6;
    const q = (variant+i*3)%8;
    const ridge = w*[.46,.53,.43,.5,.55,.45,.52,.48][q];
    const local = (u,v) => (horizontal ? [x0+.8+v,y0+.8+u] : [x0+.8+u,y0+.8+v])
      .map(n => fmt(n*scale)).join(',');
    // Short, overlapping boards follow the imperfect ridge. Leave a little
    // exposed shingle between caps, rather than adding an unbroken black line.
    for(let v=3.4,j=0;v<h-4;v+=6.7,j++) {
      const end = Math.min(h-3,v+6.1);
      const drift = (q%2?.8:-.6)*v/h;
      const u = ridge+drift;
      caps += `<path d="M${local(u-.52,v)}Q${local(u,v-.2)} ${local(u+.56,v+.12)}L${local(u+.63,end)}Q${local(u,end+.15)} ${local(u-.43,end-.1)}Z" fill="${timber}" stroke="${ink}" stroke-width="${fmt(.22*scale)}" stroke-opacity=".55" stroke-linejoin="round"/>`;
      if(j%2===0)caps += `<path d="M${local(u-.24,v+1.1)}L${local(u+.28,v+1.2)}" fill="none" stroke="${ink}" stroke-width="${fmt(.18*scale)}" opacity=".45"/>`;
    }
  }
  return {body:regional(art.body.replace('</g>',`${caps}</g>`)),sil:art.sil};
}
