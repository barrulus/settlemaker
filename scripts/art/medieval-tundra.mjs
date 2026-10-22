import { medievalHousing } from './medieval-housing.mjs';

const palette = {roof:'#7d8589',light:'#a4adb0',wall:'#c5c4b9',accent:'#91806d'};
const regional = body => body.replace(/var\(--sm-city-temperate-(roof|light|wall|accent),[^)]+\)/g,
  (_, name) => `var(--sm-city-tundra-${name}, ${palette[name]})`);
const snow = 'var(--sm-snow, #f2f6f8)';
const snowShade = 'var(--sm-city-tundra-snow-shade, #d6e1e6)';
const fmt = value => Number(value.toFixed(2));

/** Exposed timber shingles and irregular snow banks on steep, handmade roofs.
 * Snow has its own paired faces, so it follows world-space roof lighting
 * without turning the underlying shingles white. All drifts stay inside the
 * surveyed panel, and stacks are painted last to keep the flues open.
 */
export function tundraRoof(family, variant = 0, options = {}) {
  const scale = options.detailScale ?? 1;
  const sections = [];
  let sil = '';
  const section = body => sections.push(body.replace(/^<g(?=[ >])/,`<g data-roof-section="${sections.length}"`));
  for(const [i,panel] of family.panels.entries()) {
    const q = (variant+i*3)%8;
    // Author panels separately: cross wings need their own lighting axes.
    const f = {key:'tundra-roof',panels:[panel]};
    const roofOptions = {...options,material:'shingle',features:false};
    const base = medievalHousing(f,q,roofOptions);
    section(regional(base.body));
    sil += base.sil;
    const [x0,y0,x1,y1] = panel.slice(0,4).map(v => v/scale);
    const horizontal = panel[4] === 'x';
    const w = (horizontal ? y1-y0 : x1-x0)-1.6;
    const h = (horizontal ? x1-x0 : y1-y0)-1.6;
    const ridge = w*[.46,.53,.43,.5,.55,.45,.52,.48][q];
    const local = (u,v) => (horizontal ? [x0+.8+v,y0+.8+u] : [x0+.8+u,y0+.8+v])
      .map(n => fmt(n*scale)).join(',');
    let banks = '';
    // Snow gathers near both eaves, leaving a varied band of shingle exposed
    // at the ridge. Curving melt edges replace rectangular white patches.
    for(const sign of [-1,1]) {
      const edge = sign<0?2.25:w-2.25;
      const span = sign<0?ridge-edge:edge-ridge;
      if(span<=1.5||h<12)continue;
      const depth = span*(.43+((q+(sign>0?2:0))%4)*.09);
      const inner = edge-sign*depth;
      const upper = 7.5+(q%3)*.6;
      const lower = h-3.5-(q%2)*.7;
      if(lower<=upper+2)continue;
      const along = t => upper+(lower-upper)*t;
      const patches=(q+(sign>0?1:0))%3===0?[[0,.43],[.57,1]]:[[0,1]];
      for(const [from,to] of patches) {
        const start=along(from),end=along(to);
        const at=t=>start+(end-start)*t;
        banks += `<path d="M${local(edge,start+.8)}Q${local(edge-sign*.4,start-.4)} ${local(edge-sign*depth*.36,start)}Q${local(inner-sign*.7,at(.18))} ${local(inner+sign*.7,at(.31))}Q${local(inner+sign*1.8,at(.4))} ${local(inner+sign*.3,at(.52))}Q${local(inner-sign*.65,at(.66))} ${local(inner+sign*.85,at(.78))}Q${local(inner+sign*1.25,end)} ${local(edge-sign*.4,end)}Q${local(edge,end-.4)} ${local(edge,end-1.5)}Z" fill="${sign<0?snow:snowShade}" stroke="none" data-roof-face="${sign<0?'negative':'positive'}"/>`;
      }
      // A little detached melt remnant makes repeated roof banks less uniform.
      const u = ridge+sign*Math.max(1.3,span*.2);
      const v = along(.3+q*.045);
      banks += `<path d="M${local(u,v)}Q${local(u+sign*.8,v+.5)} ${local(u+sign*.4,v+1.7)}" fill="none" stroke="${snow}" stroke-width="${fmt(.65*scale)}" stroke-linecap="round" opacity=".72"/>`;
    }
    if(banks)section(`<g data-roof-snow="true" data-roof-axis="${horizontal?'y':'x'}">${banks}</g>`);
    if(options.features!==false) {
      // The primitive appends its stack/dormer details after the roof. Keep
      // these above the snow, with a drift against the stack's lower edge.
      const full = medievalHousing(f,q,{...roofOptions,features:true}).body;
      const prefix = base.body.slice(0,-4);
      const features = full.slice(prefix.length,-4);
      const cx=q%2?Math.max(4,ridge-5):Math.min(w-5,ridge+5),cy=7+(q%3)*6;
      const drift = `<path d="M${local(cx-.6,cy+2.9)}Q${local(cx+1,cy+3)} ${local(cx+3.1,cy+3.5)}Q${local(cx+3.4,cy+5.7)} ${local(cx+1.5,cy+5.3)}L${local(cx-.7,cy+4.8)}Z" fill="${snow}" stroke="none"/>`;
      section(`<g stroke-linejoin="round" stroke-linecap="round">${drift}${regional(features)}</g>`);
    }
  }
  if(family.key==='shop-house')section(`<g><path d="M20,50L43,49.6Q43.6,49.6 43.7,50.3L44,53.4Q44,54 43.4,54L19.6,54.4Q19,54.4 19.1,53.8L19.8,50.5Z" fill="var(--sm-city-tundra-accent, ${palette.accent})" stroke="var(--sm-city-roof-ink, #68574b)" stroke-width=".5" stroke-linejoin="round"/></g>`);
  return {body:`<g data-roof-sections="true">${sections.join('')}</g>`,sil};
}

/** Give tower and lantern caps a snow crown without covering stone courts.
 * Existing cap faces remain visible around the lower rim; the duplicated,
 * inset faces keep their original normal axes, including conical diagonals.
 */
export function finishTundra(_family, art) {
  let body = art.body.replace(/<g data-roof-section="\d+"[^>]*>[\s\S]*?<\/g>/g, group => {
    if(group.includes('data-roof-material=')||group.includes('data-roof-snow='))return group;
    const axis = /data-roof-axis="([^"]+)"/.exec(group)?.[1];
    const faces = [...group.matchAll(/<path\b[^>]*data-roof-face="(negative|positive)"[^>]*\/>/g)];
    if(!axis||faces.length!==2)return group;
    const apex = /\bd="M([\d.]+),([\d.]+)/.exec(faces[0][0]);
    if(!apex)return group;
    const [cx,cy] = apex.slice(1).map(Number);
    const crown = faces.map(([face,sign]) => face
      .replace(/fill="[^"]+"/,`fill="${sign==='negative'?snow:snowShade}"`)
      .replace('/>',` transform="translate(${cx},${cy}) scale(.76) translate(${-cx},${-cy})"/>`)).join('');
    return `${group}<g data-roof-section="0" data-roof-snow="true" data-roof-axis="${axis}">${crown}</g>`;
  });
  let index=0;
  body=body.replace(/data-roof-section="\d+"/g,()=>`data-roof-section="${index++}"`);
  return {...art,body};
}
