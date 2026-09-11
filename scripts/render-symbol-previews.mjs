/** Raster review exports only. Source glyphs remain fully editable SVG. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root=fileURLToPath(new URL('../symbols/',import.meta.url));
const groups={city:['catalogue','assemblies','religious','palace-kit','castle-kit','compounds'],
  village:['temperate','desert','tundra','tropical','coastal','scenes'],
  infrastructure:['walls','bridges','henges','henge-variations'],
  landscape:['temperate','desert','tundra','tropical','coastal','fields','tundra-snow','scenes']};
for(const[dir,names]of Object.entries(groups))for(const name of names){
  const input=`${root}/${dir}/${name}.svg`;
  // librsvg support for CSS custom properties varies. Preview the declared
  // fallback palette explicitly; browser-facing source retains custom properties.
  const svg=readFileSync(input,'utf8').replace(/var\(--[^,]+,\s*([^\)]+)\)/g,'$1');
  await sharp(Buffer.from(svg)).png().toFile(`${root}/${dir}/${name}.png`);
}
console.log(`Refreshed ${Object.values(groups).flat().length} SVG-library PNG review sheets.`);
