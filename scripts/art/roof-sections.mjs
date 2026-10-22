/** Flatten compound roof primitives into the renderer's ordered, flat sections. */
export function appendRoofSection(sections, body) {
  const composite='<g data-roof-sections="true">';
  const parts=body.startsWith(composite)
    ? [...body.slice(composite.length,-4).matchAll(/<g\b[^>]*>[\s\S]*?<\/g>/g)].map(([part])=>part)
    : [body];
  if(!parts.length)throw new Error('A roof primitive must contain at least one section');
  for(const part of parts) {
    if((part.match(/<g\b/g)??[]).length!==1)throw new Error('Roof sections must contain flat SVG shapes');
    sections.push(part.replace(/ data-roof-section="\d+"/,'').replace(/^<g(?=[ >])/,`<g data-roof-section="${sections.length}"`));
  }
}

/** Flatten the rural author's nested groups without changing paint order.
 * Rural plans include rotated chapels and inherited pen attributes. Bake the
 * rotation into slope normals as well as preserving the SVG transform.
 * This deliberately accepts only the author's group/shape vocabulary.
 */
export function flattenRoofSections(body) {
  const stack=[{attrs:{},angle:0}], sections=[];
  let shapes='';
  const flush=()=>{
    if(!shapes.trim())return;
    const {attrs,angle}=stack.at(-1), out={...attrs};
    if(out['data-roof-axis']) {
      const axis=out['data-roof-axis'];
      out['data-roof-axis']=String((axis==='x'?0:axis==='y'?90:Number(axis))+angle);
    }
    sections.push(`<g data-roof-section="${sections.length}"${Object.entries(out).map(([k,v])=>` ${k}="${v}"`).join('')}>${shapes}</g>`);
    shapes='';
  };
  for(const part of body.split(/(<g\b[^>]*>|<\/g>)/)) {
    if(part.startsWith('<g')) {
      flush();
      const parent=stack.at(-1), attrs={...parent.attrs};
      let angle=parent.angle;
      for(const [,key,value]of part.matchAll(/([\w-]+)="([^"]*)"/g)) {
        if(key==='data-roof-sections'||key==='data-roof-section')continue;
        if(key==='transform') {
          if(!/^rotate\(-?[\d.]+(?:[, ][\d.]+){2}\)$/.test(value))throw new Error(`Unsupported rural transform: ${value}`);
          angle+=Number(/rotate\(([-\d.]+)/.exec(value)[1]);
          attrs.transform=[attrs.transform,value].filter(Boolean).join(' ');
        } else attrs[key]=value;
      }
      stack.push({attrs,angle});
    } else if(part==='</g>') {
      flush();
      if(stack.length===1)throw new Error('Unbalanced rural groups');
      stack.pop();
    } else shapes+=part;
  }
  flush();
  if(stack.length!==1)throw new Error('Unbalanced rural groups');
  return `<g data-roof-sections="true">${sections.join('')}</g>`;
}
