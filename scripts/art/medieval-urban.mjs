import { medievalHousing } from './medieval-housing.mjs';
import { appendRoofSection } from './roof-sections.mjs';

export const urbanForms = new Set(['terrace','corner','courtyard-u','courtyard','workshop','bathhouse','market-hall']);

/** Remaining temperate street buildings, within their surveyed roof panels. */
export function medievalUrban(family, options = {}) {
  const drawRoof=options.roof??medievalHousing;
  const ink='var(--sm-city-roof-ink, #68574b)';
  const wall='var(--sm-city-temperate-wall, #d6c7ad)';
  const timber='var(--sm-city-temperate-accent, #9f8c6c)';
  const roof='var(--sm-city-temperate-roof, #967d68)';
  const path=(d,fill='none',width=.35,extra='')=>`<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${width}" ${extra}/>`;
  const sections=[];
  let sil='';
  const section=body=>appendRoofSection(sections,body);
  const detail=body=>section(`<g stroke-linejoin="round" stroke-linecap="round">${body}</g>`);
  const panel=(bounds,variant,scale,material,features=false)=>{
    const art=drawRoof({key:family.key,panels:[bounds]},variant,{detailScale:scale,material,features});
    section(art.body);
    return art.sil;
  };
  // Small valleys bridge roof insets at occupied wing junctions. These never
  // cross the courtyard or carriage passage, including in the shadow shape.
  const joins={
    terrace:['M20,11H24V53H20Z','M40,11H44V53H40Z'],
    corner:['M9,22H23V26H9Z'],
    'courtyard-u':['M5,18H19V22H5Z','M45,18H59V22H45Z'],
    courtyard:['M5,16H17V20H5Z','M47,16H59V20H47Z','M5,44H17V48H5Z','M47,44H59V48H47Z'],
    workshop:['M10,25H53V29H10Z'],
  }[family.key]??[];
  detail(joins.map(d=>path(d,roof,0)).join(''));
  sil+=joins.map(d=>`<path d="${d}" fill="currentColor"/>`).join('');

  const court=['corner','courtyard-u','courtyard'].includes(family.key);
  for(const [i,bounds] of family.panels.entries()) {
    const material=family.key==='workshop'&&i===1?'shingle':family.key==='courtyard'?'slate':'tile';
    const scale=court?.4:family.key==='market-hall'?.55:.65;
    sil+=panel(bounds,[0,4,1,2,7][i%5],scale,material,family.key==='terrace'||court);
  }

  // Raised timber vents have their own lit roof faces, just like larger wings.
  const vent=(x,y,w,h)=>{
    detail(path(`M${x},${y+1}h${w}l-.15,${h} -${w-.3},-.1Z`,wall,.3)
      +path(`M${x+.7},${y+h-1.2}h${w-1.4}v1.5h-${w-1.4}Z`,timber,.25));
    for(let u=x+1.5;u<x+w-1;u+=1.7)
      detail(path(`M${u},${y+h-1.1}v1.2`,'none',.2,'opacity=".65"'));
    panel([x-.3,y-1,x+w+.3,y+h-1.3,'x'],0,.2,'shingle');
  };
  if(family.key==='terrace') {
    // Separate thresholds and one modest dormer distinguish the three homes.
    for(const [x,y] of [[11,53.4],[31,53.8],[51,53.1]])
      detail(path(`M${x-2},${y}l4,.1 -.1,1 -3.8,-.1Z`,timber,.25));
    vent(27,38,5,4);
  }
  if(family.key==='corner') {
    detail(path('M10.5,47l3.8,.15 -.1,5 -3.5,-.15Z',wall,.3)
      +path('M11.2,47.7l2.2,.1 -.1,1.2 -2.1,-.1Z',ink,0)
      +path('M47,21l6,-.1 -.1,1.4 -5.8,.1Z',timber,.3));
  }
  if(family.key==='courtyard-u'||family.key==='courtyard') {
    // Inset timber galleries overlook the court; its centre stays unpainted.
    const closed=family.key==='courtyard';
    const y=closed?15.7:17.7;
    detail(path(`M23,${y}l17,-.1v1.2l-17,.1Z`,timber,.25));
    for(let x=25;x<40;x+=4.7)detail(path(`M${x},${y+.1}v.9`,'none',.2));
    if(closed) {
      detail(path('M23,57.4l2.2,.1v1.2h-2.2ZM38.5,57.5l2.3,-.1v1.2h-2.3Z',wall,.25));
    } else {
      detail(path('M6,56l10,.1 -.1,1.8 -9.8,-.1Z',timber,.25));
    }
  }
  if(family.key==='workshop') {
    // Masonry forge stack and low timber shed, without industrial roof lights.
    detail(path('M14,12Q14,11.5 14.6,11.5L20.8,11.8l-.3,8 -6.4,-.3Z',wall,.4)
      +path('M15.3,13.1l4,.15 -.1,2.2 -3.8,-.1Z',ink,0)
      +path('M14.4,17.2l5.8,.2M17.3,17.3v1.7','none',.22,'opacity=".5"')
      +path('M35,52l13,.1 -.15,2.2 -12.7,-.1Z',timber,.3)
      +path('M39.2,52.3v1.5M43.7,52.3v1.5','none',.22));
    vent(35,35,9,4.5);
  }
  if(family.key==='bathhouse') {
    vent(19,29,9,5);
    vent(37,29.5,7,4.5);
    detail(path('M12,13l3.4,.1 -.1,5 -3.2,-.2Z',wall,.35)
      +path('M12.6,13.7l2,.1v1.3l-2,-.1Z',ink,0)
      +path('M26,51.8l12,.1 -.2,2.3 -11.6,-.1Z',wall,.3)
      +path('M29,52.3l6,.1v1.3l-6,-.1Z',timber,.25));
  }
  if(family.key==='market-hall') {
    // Open timber arcade along the eaves, with an airy louvred ridge lantern.
    detail(path('M6,47.8Q31,48.6 58,47.7L57.8,50.4Q31,51 6.2,50.5Z',timber,.3));
    for(const [x,y] of [[8,48.2],[16,48.4],[24.5,48.6],[33,48.6],[41,48.5],[49.5,48.3],[56,48]])
      detail(path(`M${x},${y}l1.2,.05 -.05,1.8 -1.15,-.05Z`,wall,.22));
    vent(24,29.2,16,4.8);
  }
  return {body:`<g data-roof-sections="true">${sections.join('')}</g>`,sil};
}
