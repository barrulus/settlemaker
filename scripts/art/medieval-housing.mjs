/** Eight bounded, hand-drawn appearances for the existing temperate housing slots.
 * Both roof and shadow use the same contours. No randomness at render time.
 */
export const housingForms = new Set(['row-house-a','row-house-b','shop-house','tenement']);
export const housingVariantCount = 8;

export function medievalHousing(family, variant = 0) {
  const n = variant % housingVariantCount;
  const material = ['slate','tile','shingle'][n % 3];
  const ink = 'var(--sm-city-roof-ink, #68574b)';
  const roof = 'var(--sm-city-temperate-roof, #967d68)';
  const light = 'var(--sm-city-temperate-light, #b09a80)';
  const wall = 'var(--sm-city-temperate-wall, #d6c7ad)';
  const fmt = v => Number(v.toFixed(2));
  const d = points => points.map(([x,y],i)=>`${i?'L':'M'}${fmt(x)},${fmt(y)}`).join(' ');
  const rounded = (points, radii) => points.map((p,i)=>{
    const radius=Array.isArray(radii)?radii[i]:radii;
    const toward=q=>{
      const length=Math.hypot(q[0]-p[0],q[1]-p[1]);
      const t=length?Math.min(.25,radius/length):0;
      return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t].map(fmt).join(',');
    };
    return `${i?'L':'M'}${toward(points[(i+points.length-1)%points.length])} Q${p.map(fmt).join(',')} ${toward(points[(i+1)%points.length])}`;
  }).join(' ')+'Z';
  const polygon = (points, fill, width=.55, extra='', radius=0) => `<path d="${radius?rounded(points,radius):d(points)+'Z'}" fill="${fill}" stroke="${ink}" stroke-width="${width}" ${extra}/>`;
  const line = (points, width=.3, opacity=.4) => `<path d="${d(points)}" fill="none" stroke="${ink}" stroke-width="${width}" opacity="${opacity}"/>`;
  let body = '', sil = '';
  for (const [panelIndex,panel] of family.panels.entries()) {
    const [x0,y0,x1,y1,axis] = panel;
    const rotated = axis === 'x';
    const w = (rotated ? y1-y0 : x1-x0)-1.6, h = (rotated ? x1-x0 : y1-y0)-1.6;
    const local = ([u,v]) => rotated ? [x0+.8+v,y0+.8+u] : [x0+.8+u,y0+.8+v];
    const shape = (points,fill,width=.55,extra='',radius=0) => polygon(points.map(local),fill,width,extra,radius);
    const stroke = (points,width,opacity) => line(points.map(local),width,opacity);
    const q = (n+panelIndex*3)%8;
    const taper = [.3,1.3,.7,1.7,.5,1.1,1.5,.8][q];
    const ridge = w*[.46,.53,.43,.5,.55,.45,.52,.48][q];
    const top = .4+(q%3)*.55, bottom = h-.4-(q%2)*.7;
    // A stepped rear corner on some houses leaves room for a lower addition.
    const step = q===3||q===6;
    const outline = [[taper,top],[w-1.2,0],[w-.2,h*.47],[w-taper,bottom],[.2,h],[0,h*.56]];
    if(step)outline.splice(1,1,[w-4,0],[w-4,5],[w-.6,5]);
    // Small, varied curves soften the eaves without losing the irregular plan.
    const corner=1.6+(q%3)*.2;
    body += shape(outline,roof,.7,'',corner);
    sil += `<path d="${rounded(outline.map(local),corner)}" fill="currentColor" stroke="currentColor" stroke-width=".7"/>`;
    const rt=[ridge,top+.5], rb=[ridge+(q%2?.8:-.6),bottom-.1];
    // Keep both planes explicit: the renderer lights them in world space.
    // These default fills also keep the standalone artwork catalogue readable.
    // Round only the exterior corners; both faces still meet at the ridge.
    body += shape([outline[0],rt,rb,...outline.slice(-2)],light,0,'data-roof-face="negative"',[corner,0,0,corner,corner]);
    body += shape([rt,...outline.slice(1,-2),rb],roof,0,'data-roof-face="positive"',[0,...outline.slice(1,-2).map(()=>corner),0]);
    // Courses run parallel to the ridge. Short staggered joints and occasional
    // missing marks suggest tiles/shingles without the old cross-roof stripes.
    for (const side of [-1,1]) {
      const span = side<0 ? ridge-2 : w-ridge-2;
      const pitch = material==='tile'?3.1:material==='slate'?3.7:2.8;
      for(let course=0,u=2;u<span;u+=pitch,course++) {
        const x=ridge+side*u;
        const tileLength=material==='shingle'?6.4:4.6;
        for(let j=0,y=3+(course%2)*tileLength/2;y<h-3;y+=tileLength,j++) {
          if(step&&x>w-5&&y<7)continue;
          if((j+course+q)%7===0)continue;
          const end=Math.min(h-2,y+tileLength-.45);
          const bend=Math.sin(j*2+course+q)*.22;
          body+=stroke([[x,y],[x+bend,(y+end)/2],[x+.1,end]],material==='tile'?.32:.26,.34);
          if((j+q)%3!==0)body+=stroke([[x,y],[x+side*Math.min(pitch-.5,span-u),y+.2]],.25,.28);
          if((j*3+course+q)%13===0)body+=shape([[x,y+.4],[x+side*(pitch-.6),y+.6],[x+side*(pitch-.7),end-.4],[x,end-.5]],light,0,'opacity=".22"');
        }
      }
    }
    body+=stroke([rt,[ridge+.15,h*.48],rb],.85,.65);
    // A few ridge caps, rather than a ruler-straight black spine.
    for(let y=4;y<h-3;y+=5.3)body+=stroke([[ridge-.65,y],[ridge+.7,y+.15]],.45,.55);
    body+=stroke([[w-.5,Math.max(6,top)],[w-taper,bottom-corner]],.8,.48);
    if(step) {
      const addition=[[w-4,1],[w-1,1.3],[w-.6,6],[w-4,5.4]];
      body+=shape(addition,roof,.45,'data-roof-face="positive"',.65);
      sil+=`<path d="${rounded(addition.map(local),.65)}" fill="currentColor" stroke="currentColor" stroke-width=".45"/>`;
    }
    // Stacks differ in location and angle but remain fully within the roof.
    const cx=q%2?Math.max(4,ridge-5):Math.min(w-5,ridge+5), cy=7+(q%3)*6;
    body+=shape([[cx,cy],[cx+2.7,cy+.2],[cx+2.5,cy+4],[cx-.2,cy+3.8]],wall,.45);
    body+=shape([[cx+.5,cy+.65],[cx+2.1,cy+.75],[cx+2,cy+1.8],[cx+.4,cy+1.7]],ink,0);
    if(q===2||q===5) {
      // Modest dormer, inset in the roof plane and independent of the stack.
      const dx=sideSafe(ridge,w),dy=h*.7;
      body+=shape([[dx-2.4,dy],[dx,dy-2],[dx+2.5,dy+.2],[dx+2.2,dy+3],[dx-2.2,dy+2.8]],roof,.45,'',.4);
      body+=stroke([[dx,dy-1.5],[dx,dy+2.6]],.45,.55);
    }
  }
  if(family.key==='shop-house')body+=polygon([[20,50],[43,49.6],[44,54],[19,54.4]],'var(--sm-city-temperate-accent, #9f8c6c)',.5,'',.6);
  return {body:`<g data-roof-material="${material}" data-roof-axis="${family.panels[0][4]==='x'?'y':'x'}" stroke-linejoin="round" stroke-linecap="round">${body}</g>`,sil};
}

function sideSafe(ridge,w) { return Math.max(4,Math.min(w-4,ridge*.48)); }
