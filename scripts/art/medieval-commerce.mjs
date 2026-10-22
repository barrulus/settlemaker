import { medievalHousing } from './medieval-housing.mjs';
import { appendRoofSection } from './roof-sections.mjs';

export const commerceForms = new Set(['inn', 'warehouse', 'guildhall']);

/** Existing surveyed panels and courtyard voids, with house-scale roof detail. */
export function medievalCommerce(family, options = {}) {
  const drawRoof=options.roof??medievalHousing;
  const ink='var(--sm-city-roof-ink, #68574b)';
  const wall='var(--sm-city-temperate-wall, #d6c7ad)';
  const timber='var(--sm-city-temperate-accent, #9f8c6c)';
  const roof='var(--sm-city-temperate-roof, #967d68)';
  const path=(d,fill,sw=.45)=>`<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const sections=[];
  let sil='';
  const section=body=>appendRoofSection(sections,body);
  const detail=(body)=>section(`<g stroke-linejoin="round">${body}</g>`);
  const panel=(bounds,variant,scale,material)=>{
    const art=drawRoof({key:family.key,panels:[bounds]},variant,{detailScale:scale,material,features:false});
    section(art.body);
    return art.sil;
  };
  if(family.key==='inn') {
    // Roof valleys connect adjoining wings while retaining the open court.
    const joins=['M3,18H18V22H3Z','M46,18H61V22H46Z','M3,42H18V46H3Z','M46,42H61V46H46Z'];
    detail(joins.map(d=>path(d,roof,0)).join(''));
    sil+=joins.map(d=>`<path d="${d}" fill="currentColor"/>`).join('');
  }
  for(const [i,bounds] of family.panels.entries())
    sil+=panel(bounds,[0,1,4,2,7][i%5],family.key==='inn'?.45:.8,family.key==='inn'?'tile':family.key==='warehouse'?'shingle':'slate');

  if(family.key==='inn') {
    // A kitchen stack, stable doors and a modest cloth sign identify the inn.
    // All stay on occupied wings: the central court and carriage passage are clear.
    detail(path('M6,8.5l2.4,.1 -.1,3.5 -2.5,-.2Z',wall,.3)
      +path('M6.5,9l1.4,.1 -.1,1 -1.4,-.1Z',ink,0)
      +path('M48,25l3,.1 -.2,1.8 -2.8,-.1Z',timber,.3)
      +path('M48,32l3,-.1 -.1,1.8 -2.9,.1Z',timber,.3)
      +path('M6,58Q6,57.5 6.6,57.5L17,57.8l.4,2.2 -11,-.2Z',timber,.3)
      +path('M8,57.8l.1,1.8M11,57.8l.1,1.8M14,57.9l.1,1.8','none',.18));
  }
  if(family.key==='warehouse') {
    // Timber loading dormers replace the old industrial-looking roof lights.
    for(const [x,y] of [[18,19],[44,36]]) {
      detail(path(`M${x-2.5},${y+1}h5l-.2,4.5 -4.7,-.1Z`,wall,.4)
        +path(`M${x-1.5},${y+2}h3v2.8h-3Z`,timber,.3)
        +path(`M${x},${y+2}v2.7`,'none',.25));
      panel([x-3,y-3,x+3,y+2],0,.22,'shingle');
    }
    detail(path('M13,55.3l10,.1 -.1,2.3 -10,-.1Z',timber,.4)
      +path('M39,55.3l10,-.1 .1,2.3 -10,.1Z',timber,.4)
      +path('M18,55.6v1.7M44,55.5v1.7','none',.25));
  }
  if(family.key==='guildhall') {
    // An oak-framed lantern above the broad slate roof, plus a recessed porch.
    detail(path('M27,27l10,.1 -.2,12.5 -9.7,-.2Z',wall,.5)
      +path('M28,35.4l8,.1v2.6l-8,-.1Z',timber,.4)
      +path('M30.6,35.5v2.4M33.5,35.5v2.4','none',.3));
    panel([26,24,38,35,'x'],0,.28,'slate');
    detail(path('M26,50l12,.1 -.2,3.3 -11.6,-.1Z',wall,.4)
      +path('M29,51l6,.1 -.1,2 -5.9,-.1Z',timber,.35)
      +path('M10,15l3,.1 -.1,4 -3,-.1Z',wall,.4)
      +path('M10.6,15.6l1.8,.1v1.2l-1.8,-.1Z',ink,0));
  }
  return {body:`<g data-roof-sections="true">${sections.join('')}</g>`,sil};
}
