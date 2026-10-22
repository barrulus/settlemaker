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
