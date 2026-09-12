/** Commons and park ground: light botanical marks, a single soft earth edge. */
export const greenPalettes = {
  temperate: {turf:'#a8bc83',light:'#c4d09e',edge:'#81906b'},
  desert: {turf:'#cbbb94',light:'#e1d1ae',edge:'#a59577'},
  tundra: {turf:'#bdc6bc',light:'#e4e9e2',edge:'#949f97'},
  tropical: {turf:'#88ae79',light:'#b2c894',edge:'#698b65'},
  coastal: {turf:'#b8c4a0',light:'#d4dcc0',edge:'#909e86'},
};
export function greenGround(d, biome='temperate', {unit=1,bounds=[0,0,64,64],id='green',seed=0}={}) {
  const b=greenPalettes[biome]?biome:'temperate',p=greenPalettes[b];
  const t=k=>`var(--sm-green-${b}-${k}, ${p[k]})`;
  const n=v=>Number(v.toFixed(3)),[x,y,w,h]=bounds;
  const clip=`green-${id.replace(/[^\w-]/g,'-')}`;
  let detail='';
  const count=Math.min(36,Math.max(5,Math.round(w*h/(unit*unit*70))));
  for(let i=0;i<count;i++){
    const px=x+w*((i*.61803398875+seed*.013)%1),py=y+h*((i*.41421356237+.23+seed*.027)%1);
    const r=unit*(.5+(i%3)*.17);
    detail+=`<path d="M${n(px-r)},${n(py)}q${n(r)},${n(-r*.8)} ${n(r*2)},0" fill="none" stroke="${i%3?t('light'):t('edge')}" stroke-width="${n(.22*unit)}" stroke-linecap="round" opacity=".58"/>`;
  }
  return `<g data-green-biome="${b}"><path d="${d}" fill="${t('turf')}" stroke="${t('edge')}" stroke-width="${n(.45*unit)}" stroke-linejoin="round"/><defs><clipPath id="${clip}"><path d="${d}"/></clipPath></defs><g clip-path="url(#${clip})">${detail}</g></g>`;
}
