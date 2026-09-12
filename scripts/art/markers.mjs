/** Hand-authored elevation markers; 64-unit, editable native SVG. */
export const markerTokens={
  '--sm-ink':'#33262e','--sm-stone':'#d6cbb4','--sm-lead':'#88959e',
  '--sm-timber':'#bd9872','--sm-void':'#62555f','--sm-canopy-a':'#6f8b65','--sm-canopy-b':'#a5b786',
  '--mk-stone-light':'#eee5d2','--mk-stone-dark':'#aaa799','--mk-iron':'#aab7be','--mk-steel-light':'#e1e8e6',
  '--mk-ember':'#b86e54','--mk-lava':'#d8754c','--mk-flame':'#ecc77e','--mk-steam':'#c8d6cf',
  '--mk-heat':'#c79378','--mk-water':'#78a6ab','--mk-water-light':'#c6dfd9',
  '--mk-gold':'#d4ad63','--mk-brass':'#b89055','--mk-halo':'#d6bc7e',
  '--mk-arcane':'#8e7a9f','--mk-arcane-light':'#cfbfd6','--mk-page':'#f5ecd7',
  '--mk-board-a':'#ad6b59','--mk-board-b':'#6b8796','--mk-party':'#be493d',
  '--mk-white':'#fcf9ed','--mk-pine':'#587869','--mk-sand':'#d8c393',
  '--mk-hide':'#9b7d62','--mk-hide-dark':'#77685b','--mk-skin':'#a4ad85',
  '--mk-froth':'#f8f0dc','--mk-black':'#4b454b',
};
const t=k=>`var(${k}, ${markerTokens[k]})`;
const C={ink:t('--sm-ink'),stone:t('--sm-stone'),pale:t('--mk-stone-light'),shade:t('--mk-stone-dark'),slate:t('--sm-lead'),wood:t('--sm-timber'),void:t('--sm-void'),leaf:t('--sm-canopy-a'),leafLight:t('--sm-canopy-b'),iron:t('--mk-iron'),steel:t('--mk-steel-light'),clay:t('--mk-board-a'),blue:t('--mk-board-b'),lava:t('--mk-lava'),flame:t('--mk-flame'),water:t('--mk-water'),foam:t('--mk-water-light'),gold:t('--mk-gold'),brass:t('--mk-brass'),halo:t('--mk-halo'),violet:t('--mk-arcane'),lavender:t('--mk-arcane-light'),page:t('--mk-page'),red:t('--mk-party'),white:t('--mk-white'),pine:t('--mk-pine'),sand:t('--mk-sand'),hide:t('--mk-hide'),darkHide:t('--mk-hide-dark'),skin:t('--mk-skin'),froth:t('--mk-froth'),black:t('--mk-black')};
const n=v=>Number(v.toFixed(2));
const p=(d,fill='none',width=1.15,stroke=C.ink,extra='')=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const line=(d,width=.55,stroke=C.ink,extra='')=>p(d,'none',width,stroke,extra);
const circle=(x,y,r,fill,width=0,stroke=C.ink)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const ellipse=(x,y,rx,ry,fill,width=0,stroke=C.ink)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const group=(body,transform)=>`<g transform="${transform}">${body}</g>`;
const star=(x,y,r=2.5,fill=C.gold)=>p(`M${x},${y-r}Q${x+.6},${y-.5} ${x+r},${y}Q${x+.6},${y+.5} ${x},${y+r}Q${x-.6},${y+.5} ${x-r},${y}Q${x-.6},${y-.5} ${x},${y-r}Z`,fill,0);
function halo(x,y,r){
  let s=ellipse(x,y,r,r,'none',.65,C.halo);
  for(let i=0;i<16;i++){const a=i*Math.PI/8,ri=r+2,ro=ri+(i%2?1.7:3);s+=line(`M${n(x+Math.cos(a)*ri)},${n(y+Math.sin(a)*ri)}L${n(x+Math.cos(a)*ro)},${n(y+Math.sin(a)*ro)}`,.8,C.halo);}
  return s;
}
const ripples=(y=54)=>line(`M5,${y}q7,-2 14,0t14,0t14,0t12,0`,1.1,C.water)+line(`M12,${y+4}q6,-1.6 12,0M35,${y+3}q8,2 15,0`,.7,C.foam);
const masonry=d=>line(d,.55,C.void,'opacity=".6"');
function sword(){return p('M29,38L28,15L32,6L36,15L35,38Z',C.iron,1.05)+p('M32,8L32,38H29L29,16Z',C.steel,0)+line('M32,11V36',.55)+p('M25,38Q32,35.6 39,38L38,41Q32,39 26,41Z',C.gold,.85)+p('M30,41H34L34.7,51H29.3Z',C.hide,.8)+line('M30,43.5L34,45M30,47L34,48.5',.5)+circle(32,54,2.7,C.brass,.85);}
function palm(){return p('M30,55Q34,37 30,22L33,21Q38,37 35,55Z',C.wood,.95)+line('M32,29l3,-.7M32.5,36l3,-.4M32.5,43l3,.2M32,50l3,.5',.55,C.darkHide)+p('M32,22Q16,8 6,29Q20,21 32,22Z',C.leaf,1)+p('M32,22Q11,19 10,37Q17,28 32,22Z',C.leafLight,.85)+p('M32,22Q30,3 18,9Q28,16 32,22Z',C.leafLight,.85)+p('M32,22Q48,7 58,28Q46,19 32,22Z',C.leaf,1)+p('M32,22Q51,20 53,37Q46,28 32,22Z',C.leafLight,.85)+p('M32,22Q35,7 47,8Q38,17 32,22Z',C.pine,.85)+line('M9,28Q19,17 30,22M35,22Q47,16 55,26',.5,C.pine)+circle(31,24,2,C.hide,.55)+circle(35,24,1.7,C.brass,.55);}
function skull(){return p('M21,27C17,23 17,17 21,13Q29,7 37,12C43,16 42,23 39,26L36,28V33Q30,36 24,33V28Z',C.page,1.05)+p('M22,20q3,-4 6,0l-1,5h-4ZM32,20q3,-4 6,0l-1,5h-4Z',C.void,.4)+p('M28,28l2,-4 2,4Z',C.void,0)+line('M25,31H35M27,30v4M31,30v4M34,30v3',.65)+line('M24,13l4,3-1,2',.5,C.shade);}

export const markerCatalog=[
 ['volcanoes','Volcano','nature'],['hot-springs','Hot springs','nature'],['water-sources','Water source','nature'],['mines','Mine','places'],['bridges','Bridge','places'],['lighthouses','Lighthouse','places'],
 ['waterfalls','Waterfall','nature'],['battlefields','Battlefield','lore'],['dungeons','Dungeon','places'],['lake-monsters','Lake monster','creatures'],['sacred-forests','Sacred forest','sacred'],['statues','Statue','places'],
 ['ruins','Ruins','places'],['libraries','Library','places'],['circuses','Circus','events'],['portals','Portal','lore'],['disturbed-burials','Disturbed burial','lore'],['necropolises','Necropolis','places'],
 ['encounters','Encounter','lore'],['party','Player party','travel'],['inns','Inn','places'],['sea-monsters','Sea monster','creatures'],['hill-monsters','Hill monster','creatures'],['sacred-mountains','Sacred mountain','sacred'],
 ['sacred-pineries','Sacred pinery','sacred'],['sacred-palm-groves','Sacred palm grove','sacred'],['brigands','Brigands','lore'],['pirates','Pirates','lore'],['jousts','Joust','events'],['fairs','Fair','events'],
 ['canoes','Canoe','travel'],['migration','Migration','creatures'],['dances','Dance','events'],['mirage','Mirage','nature'],['caves','Cave','nature'],['rifts','Rift','lore'],
].map(([kind,label,category])=>({id:`mk-${kind}`,kind,label,category}));

export function marker(kind){
  let s='';
  switch(kind){
    case 'volcanoes':
      s=p('M26,23C19,20 19,16 23,14C17,7 28,4 33,8C37,3 45,6 44,11C52,13 48,20 40,20L37,25Z',C.shade,.85)
       +p('M25,17Q28,13 32,16Q35,11 39,16L36,24H28Z',C.lava,0)
       +p('M5,56L14,44L22,22Q30,27 38,22L46,41L59,56Q34,60 5,56Z',C.slate,1.3)
       +p('M22,24L17,43L9,53L24,48L31,27Z',C.shade,0)
       +p('M34,26L40,40L50,52L57,55L45,40L38,24Z',C.void,0)
       +p('M22,22Q29,17 38,22Q32,27 22,22Z',C.void,.85)
       +p('M25,22Q28,24 30,22L30,34L27,42L28,49L24,44L27,33Z',C.lava,.6)
       +p('M34,23L35,33L40,39L42,49L38,44L37,39L32,34L32,23Z',C.lava,.5)
       +line('M28,25L28,33L26,39M34,29L34,33L38,39',.8,C.flame)
       +masonry('M17,47l-3,4M32,49l4,4M46,50l4,3')+circle(18,13,1,C.lava)+circle(45,25,1.2,C.flame);break;
    case 'hot-springs':
      s=p('M7,43L10,37L18,34L27,35L35,32L45,35L55,40L58,47L50,55L33,59L15,54L7,49Z',C.stone,1.1)
       +p('M11,45Q14,35 33,36Q52,36 55,45Q53,55 32,55Q14,54 11,45Z',t('--mk-heat'),.65)
       +ellipse(33,44,18,7.8,C.water,.75)+ellipse(33,42.8,14.5,5.4,C.foam,0)
       +p('M17,44Q25,39 45,41Q49,44 44,47Q27,50 17,44Z',C.water,0)
       +line('M21,44q7,2 13,0M34,47q6,0 9,-2',.65,C.white)
       +masonry('M10,48l7,2-2,4M47,52l-1,3M50,37l-2,4M22,34l1,3')
       +line('M20,31C12,24 25,21 19,14M31,28C24,21 39,15 32,7M43,32C36,26 47,23 44,16',2,t('--mk-steam'))
       +line('M21,28C17,24 26,20 22,16M33,25C29,20 39,16 35,11',.65,C.white);break;
    case 'water-sources':
      s=p('M10,53L14,47H50L55,53L52,58H12Z',C.stone,1.1)+p('M14,53H51L49,56H16Z',C.shade,0)
       +p('M28,31H36L38,48H25Z',C.stone,1)+p('M31,32H35L36,47H32Z',C.pale,0)
       +p('M17,30Q32,25 47,30Q44,40 32,40Q20,40 17,30Z',C.stone,1.1)
       +ellipse(32,30,15,3.6,C.water,.7)+ellipse(32,29.7,11.5,1.8,C.foam)
       +p('M28,16H36L35,28H29Z',C.stone,.85)+p('M25,14Q32,10 39,14L37,18H27Z',C.pale,.85)
       +circle(32,9,3,C.stone,.85)
       +line('M30,18Q17,10 13,29M34,18Q47,10 51,30M22,33Q17,41 19,47M42,33Q47,41 45,47',1.6,C.water)
       +line('M30,18Q20,12 16,24M34,18Q44,12 48,24',.55,C.foam)
       +ellipse(32,48,18,3.2,C.water,.7)+line('M20,49q10,2 22,-.3',.6,C.foam);break;
    case 'mines':
      s=p('M35,49L41,41L50,43L55,52L48,58H34L28,54Z',C.slate,1.1)
       +p('M41,42L43,50L50,44M43,50L48,57L53,51',C.iron,.6)
       +p('M11,53L16,44L26,43L30,53L24,58H12Z',C.shade,1)+p('M17,47l4,-3 2,5-3,4Z',C.gold,.6)
       +p('M20,13L25,11L47,49Q49,53 45,55L42,54Z',C.wood,1.1)
       +p('M24,16L26,17L44,50L43,52Z',C.pale,0)
       +p('M8,30Q13,13 29,9Q42,5 55,11Q41,9 29,18L16,29L9,34Z',C.iron,1.3)
       +p('M13,26Q24,11 45,10Q34,11 26,18L16,29Z',C.steel,0)
       +p('M25,12L29,12L32,17L28,20L25,17Z',C.void,.65)+line('M35,39l4,-2M38,45l4,-2',.65);break;
    case 'bridges':
      s=p('M4,50Q14,43 25,47T58,43L59,53Q42,60 27,54T5,56Z',C.water,0)
       +p('M8,28L16,23Q35,11 53,23L58,28L57,45L49,49V34Q35,22 20,36V49L10,54Z',C.shade,1.2)
       +p('M7,31Q31,10 54,28L52,49L44,51V39Q31,29 18,40V54L7,56Z',C.stone,1.3)
       +p('M7,31L11,25Q31,8 55,24L56,29L52,31Q31,15 9,35Z',C.pale,1)
       +p('M18,40Q31,29 44,39V43Q31,34 18,45Z',C.void,.55)
       +masonry('M8,40l7,-3M7,49l7,-3M46,36l7,-1M47,44l5,-1M15,23l2,6M25,18l1,6M36,18l-1,6M46,21l-2,5')
       +line('M19,50q9,3 17,0M29,55q9,2 19,-1',.9,C.foam);break;
    case 'lighthouses':
      s=p('M28,18L7,11L6,18L28,21ZM36,18L57,10L58,17L36,21Z',C.flame,0,'none','opacity=".6"')
       +p('M12,56L18,49L45,50L53,58H10Z',C.shade,1)
       +p('M24,26H39L44,52Q32,58 19,52Z',C.pale,1.15)
       +p('M34,27H39L44,52L35,54Z',C.stone,0)
       +p('M23,34H40L41,40H22Z',C.clay,.6)
       +p('M26,14H38V26H26Z',C.gold,1.1)+p('M29,15H34V24H29Z',C.flame,0)
       +line('M32,14V25M26,20H38',.6)+p('M22,27V24H42V27Z',C.slate,.9)
       +p('M23,14L26,11L32,6L40,12L42,15Z',C.slate,1.1)+p('M26,12L32,7L35,13Z',C.iron,0)
       +p('M28,53V47Q32,42 35,47V54Z',C.void,.75)
       +masonry('M24,30h5M37,44h4M21,48h4')+star(32,19,2,C.white);break;
    case 'waterfalls':
      s=p('M7,12L20,8L30,13L38,8L55,13L57,43L49,52L15,54L7,43Z',C.shade,1.2)
       +p('M8,15L19,12L18,43L10,48L8,36Z',C.stone,0)+p('M43,13L54,16L56,41L48,48L47,27Z',C.slate,0)
       +p('M19,13Q30,16 44,12L41,31L44,49Q31,55 18,48L22,32Z',C.water,.9)
       +p('M24,15L29,15L27,30L29,48L22,49L25,32Z',C.foam,0)
       +p('M36,15H40L36,32L39,48H34L32,33Z',C.foam,0)
       +ellipse(31,51,24,7,C.water,.9)+p('M16,49Q18,44 22,46Q23,40 27,45Q31,42 34,46Q40,41 42,47Q49,47 45,51Q32,56 17,52Z',C.foam,.55)
       +line('M19,52q12,3 23,-1M27,19l-1,11M38,22l-2,7',.7,C.white)
       +masonry('M8,25l7,-3-2,13M49,20l4,3M48,35l5,-2M13,40l4,-2')+p('M8,13Q28,7 54,13L50,17Q28,12 10,18Z',C.leaf,.8);break;
    case 'battlefields':
      s=group(sword(),'rotate(-36 32 32)')+group(sword(),'rotate(36 32 32)');break;
    case 'dungeons':
      s=p('M9,10L55,11L56,57H8Z',C.shade,1.25)+p('M12,13H52V53H12Z',C.stone,.75)
       +p('M20,19H44V55H20Z',C.void,.9)+p('M22,21H42V54H22Z',C.wood,.9)
       +p('M35,21H42V54H35Z',C.hide,0)+line('M28,22V53M35,22V53',.6,C.darkHide)
       +p('M22,29H42V32H22ZM22,43H42V46H22Z',C.slate,.7)
       +circle(25,30.5,.75,C.steel)+circle(39,30.5,.75,C.steel)+circle(25,44.5,.75,C.steel)+circle(39,44.5,.75,C.steel)
       +circle(37,37,2,C.brass,.7)+p('M36.4,36h1.2v3h-1.2Z',C.void,0)
       +p('M7,55L56,55L58,59H6Z',C.pale,1)
       +masonry('M10,23h9M10,37h9M10,49h9M45,25h9M45,39h10M29,11v7M44,11v7');break;
    case 'lake-monsters':
      s=p('M14,51Q28,56 30,43Q29,33 23,27Q19,23 25,18L31,13L45,13L55,22L42,25L50,31Q41,40 35,30Q42,48 30,54Q20,61 11,54L6,47Z',C.pine,1.25)
       +p('M25,18L30,7L36,14L42,8L44,15Z',C.leaf,.85)
       +p('M42,24L52,22L46,28L50,31L41,32L36,26Z',C.void,.65)
       +p('M44,24l2,4 1,-5M40,30l1,-3 2,4',C.page,.45)
       +p('M25,28Q36,34 34,44Q29,56 17,53Q29,51 28,43Z',C.leafLight,0)
       +p('M32,37L22,34L25,41L31,43Z',C.leaf,.7)+circle(39,19,2,C.gold,.65)+circle(39.5,19,.85,C.void)
       +line('M29,20q2,-2 4,-1M31,25q2,0 3,-1',.55)+p('M5,51Q15,47 25,51T59,50L57,56Q41,60 27,56T5,56Z',C.water,0)
       +ripples(53);break;
    case 'sacred-forests':
      s=halo(32,25,19)+p('M26,55Q31,42 27,28L32,25L37,30Q34,43 40,56L33,54Z',C.wood,1.1)
       +line('M31,48L32,34L23,27M33,38L41,30',.65,C.darkHide)
       +p('M12,30Q5,24 13,20Q9,13 19,13Q19,6 27,10Q34,3 40,12Q49,9 50,19Q59,23 53,30Q55,37 45,38Q39,44 33,38Q24,45 20,38Q10,40 12,30Z',C.leaf,1.15)
       +p('M13,25Q10,19 19,18Q17,11 25,13Q30,7 35,15Q42,9 45,18Q52,18 49,24Q45,29 39,26Q33,32 27,27Q20,33 13,25Z',C.leafLight,0)
       +p('M38,28Q45,25 50,29Q51,35 43,35Q38,39 34,34Z',C.pine,0)
       +line('M15,30q4,3 8,0M30,18q3,-2 5,0M39,31q4,2 7,0',.45,C.pine)
       +p('M23,57Q32,52 43,57', 'none',1,C.leaf)+star(32,6,2);break;
    case 'statues':
      s=p('M18,46H46L50,57H13Z',C.stone,1.1)+p('M18,48L42,49L46,55H16Z',C.pale,0)
       +p('M23,43L19,40L17,27L25,23V18L39,17V23L46,28L45,41L40,45Z',C.stone,1.2)
       +p('M33,22L39,22L45,29L44,40L37,44L34,32Z',C.shade,0)
       +p('M23,16Q20,5 30,5Q41,3 42,13L39,22L31,26L25,22Z',C.pale,1.05)
       +p('M34,8L40,10L39,20L33,23L34,17L31,16Z',C.shade,0)
       +line('M26,13l4,-.5M35,13h3M32,13l-1,5 3,.5M29,21l6,-.3M24,28l6,6 4,-7M23,33l2,7M41,31l-2,9',.65,C.void)
       +p('M18,44H46V48H18Z',C.slate,.85)+p('M12,56H51V60H12Z',C.shade,.9)
       +line('M22,52h14',.55,C.shade);break;
    case 'ruins':
      s=p('M9,56L10,12L16,11L17,6L22,9L22,15L29,12L28,32L35,29L39,33L42,29L45,40L53,42L56,56Z',C.stone,1.2)
       +p('M22,15L28,13L27,38L34,36L35,55H23Z',C.shade,0)
       +p('M10,12L16,11L17,6L22,9L22,15L16,17Z',C.pale,.7)
       +p('M39,54V44Q43,39 47,44V55Z',C.void,.85)+p('M14,24Q17,21 20,24V31H14Z',C.void,.65)
       +masonry('M11,20h11M11,36h12M11,45h12M17,36v8M24,24h4M30,40h6M35,46h4M49,47h5')
       +p('M6,57L10,52L17,56L21,53L27,59H5Z',C.shade,.85)+p('M47,59l5,-6 7,5Z',C.stone,.85)
       +line('M31,52Q30,39 35,32',.8,C.pine)
       +p('M32,45q-6,-5 -6,-1q2,5 6,1M33,39q6,-4 6,0q-3,3 -6,0M34,34q-5,-6 -6,-2q1,4 6,2',C.leaf,0);break;
    case 'libraries':
      s=p('M5,18Q18,13 30,20Q40,12 57,14L59,48Q45,46 32,55Q17,49 7,52Z',C.blue,1.15)
       +p('M5,18L8,51Q20,48 32,55L30,23Q18,14 5,18Z',C.clay,1)
       +p('M9,14Q20,12 30,19Q42,11 54,12L55,44Q42,44 32,51Q20,45 11,48Z',C.page,1.05)
       +p('M30,19L32,51Q40,43 55,44L53,40Q40,40 33,47Z',C.stone,0)
       +p('M10,15L13,44Q23,43 29,47L27,20Q18,14 10,15Z',C.white,0)
       +line('M30,20L32,50M14,22q6,-1 12,3M15,28q5,-.8 11,3M16,34q5,-.5 11,3M17,40q4,-.2 10,3M36,23q7,-5 14,-4M36,29q7,-4 14,-4M37,35q6,-3 13,-3M13,46q8,-1 17,4M35,48q9,-5 19,-4',.6,C.hide)
       +p('M43,14L47,13L47,32L44,29L41,33Z',C.clay,.55)
       +p('M7,20l2,0 .3,4-2,0ZM8,44l2,-.4 .3,4-2,.4ZM55,17h2v4h-2Z',C.gold,.4);break;
    case 'circuses':
      s=line('M31,7V16',1.15)+p('M31,6L45,10L31,13Z',C.clay,.8)
       +line('M13,32L5,56M50,32L59,56',.6,C.hide)
       +p('M12,34H52L55,56Q32,61 9,56Z',C.page,1.05)
       +p('M16,35H22L21,57L14,57ZM30,35H36L38,58L29,59ZM44,35H50L53,56L46,58Z',C.clay,0)
       +p('M10,34Q23,27 31,15Q41,28 54,34L52,39Q47,42 43,37Q38,42 33,38Q27,42 23,37Q16,42 11,38Z',C.page,1.15)
       +p('M31,15Q26,29 23,37Q18,40 16,39L18,31Q26,24 31,15ZM31,15Q38,28 43,37L48,39L49,32Q39,25 31,15Z',C.clay,.55)
       +p('M31,15Q30,27 30,38L35,39Q34,26 31,15Z',C.blue,.5)
       +p('M26,57V48Q31,42 37,48L40,58Z',C.void,.85)
       +p('M27,47L28,56L23,57Z',C.clay,.55)+p('M36,47L36,57L41,58Z',C.clay,.55)
       +line('M12,43l-1,10M50,44l2,9',.45,C.hide);break;
    case 'portals':
      s=p('M11,56V26Q12,8 31,5Q51,8 53,26V56Z',C.shade,1.2)
       +p('M14,54V26Q15,12 32,9Q47,13 49,26V54Z',C.stone,.7)
       +p('M21,55V27Q21,17 32,15Q43,18 43,27V55Z',C.void,1.1)
       +p('M24,52V29Q25,21 33,20Q41,24 40,35L40,52Z',C.violet,0)
       +p('M30,50Q40,41 30,35Q24,29 31,26Q37,24 36,30Q35,34 31,31Q35,37 38,40Q42,50 30,50Z',C.lavender,0)
       +line('M28,46Q39,39 29,33Q26,28 32,28',1,C.white)
       +p('M26,7L31,5L36,8L35,17L29,17Z',C.pale,.8)
       +masonry('M13,25l8,3M15,17l8,6M20,11l6,8M39,11l-3,8M46,17l-7,6M50,27h-7M12,38h9M12,47h9M44,37h8M44,46h8')
       +p('M8,55H56L58,59H6Z',C.pale,1)+star(36,22,1.9,C.white)+star(25,39,1.5,C.white);break;
    case 'disturbed-burials':
      s=p('M7,51Q11,40 24,40Q40,38 56,49L59,55Q29,61 6,56Z',C.hide,1.1)
       +p('M17,48Q30,40 45,48L44,54L22,55Z',C.void,.75)
       +group(skull(),'translate(1 11) rotate(-13 30 23)')
       +p('M10,50Q7,47 10,46Q12,46 12,49L29,54Q32,53 33,55Q33,58 30,57L11,52Q8,54 8,51Z',C.page,.8)
       +p('M40,51L48,41Q47,38 50,38Q53,39 51,42L45,52Q47,54 44,55Q42,55 42,53Z',C.stone,.75)
       +line('M14,39l-3,-6M13,37l4,-4M47,35l4,-6M49,33l-1,-4',.75,C.hide)
       +p('M10,55l6,-1 2,3-7,1ZM47,56l5,-3 4,3-3,2Z',C.stone,.65)+masonry('M20,57l4,-.3M38,56l3,1');break;
    case 'necropolises':
      s=p('M7,52L14,48L52,49L58,56L47,60H9Z',C.shade,.9)
       +p('M20,52V25Q20,13 33,13Q46,13 46,25V54Z',C.stone,1.15)
       +p('M24,51V26Q24,18 33,18Q41,18 41,26V52Z',C.pale,.7)
       +p('M31,26H34V30H38V33H34V43H31V33H27V30H31Z',C.shade,.6)
       +p('M7,52V37Q7,30 14,30Q20,30 20,37V53Z',C.slate,.95)
       +p('M47,54V35L53,32L58,36V55Z',C.stone,.95)
       +line('M11,37h5M13,35v10M50,40h5M50,44h4M28,47h9',.65,C.void)
       +p('M17,53H47V58H17Z',C.pale,.85)+p('M29,13V9H26V7H29V4H32V7H35V9H32V13Z',C.brass,.7)
       +p('M7,56q-1,-5 -3,-4M55,57q1,-5 4,-5','none',.9,C.leaf);break;
    case 'encounters':
      s=line('M49,57L52,18',2.1,C.wood)+line('M50,56L52,23',.55,C.brass)
       +p('M49,20L46,14L50,10L55,12L57,18L53,23Z',C.brass,.85)+circle(52,16,4,C.flame,.7)+star(52,16,2.6,C.white)
       +p('M24,28Q29,25 35,29L40,37L49,34L49,39L41,44L36,41L42,58Q30,62 13,57L19,39L13,44L10,40L19,30Z',C.violet,1.15)
       +p('M25,30L29,34L25,56L17,57L22,39Z',C.lavender,0)
       +p('M35,40L40,58L32,59L30,39Z',C.void,0)
       +p('M22,21Q29,17 35,22L33,31L27,33L23,28Z',C.pale,.9)
       +p('M25,25L33,25Q31,33 27,37L25,30Z',C.page,.55)
       +p('M14,22Q20,19 24,8L30,5L35,20Q40,21 40,24Q27,29 13,25Z',C.blue,1.1)
       +p('M24,8L27,7L24,21L18,23Z',C.iron,0)+p('M21,20Q27,22 35,20L36,23Q27,25 20,23Z',C.brass,.55)
       +line('M27,23h2M24,40l-5,12M30,43l-1,11',.55,C.void)
       +circle(48,36,1.7,C.pale,.55)+circle(11,41,1.6,C.pale,.55)+star(43,10,1.7)+star(58,27,1.4);break;
    case 'party':
      s=p('M15,58L17,10H20L19,58Z',C.black,.95)+circle(18.5,7,2.8,C.gold,.85)
       +p('M20,12C32,6 44,18 58,12L51,24L57,30C44,37 31,22 20,28Z',C.red,1.15)
       +p('M21,14Q31,11 40,17T54,16L49,23L54,28Q43,30 34,24T21,26Z','none',.7,C.gold)
       +p('M22,29Q34,27 43,35L51,35L43,43Q35,38 21,37Z',C.gold,.85)
       +p('M23,31Q34,31 42,38L46,36L42,42Q32,37 21,37Z',C.brass,0)
       +star(34,20,4,C.page)+line('M28,51l-3,5M22,58h-8',.8,C.brass);break;
    case 'inns':
      s=p('M43,24Q57,22 57,36Q57,47 44,45L43,40Q52,42 52,35Q52,28 44,30Z',C.brass,1.1)
       +p('M11,20Q27,16 44,20L46,54Q29,61 12,54Z',C.wood,1.25)
       +p('M14,22L22,21L22,55L15,53Z',C.pale,0)+p('M36,21L42,22L44,53L37,55Z',C.hide,0)
       +line('M23,23L23,55M34,23L35,56',.65,C.darkHide)
       +p('M11,27Q29,31 44,27L44.5,31Q29,35 11.5,31ZM12,47Q29,52 45.5,47L46,52Q29,58 12,52Z',C.brass,.85)
       +line('M14,29Q28,32 41,29M15,50Q29,54 43,50',.65,C.gold)
       +p('M10,20Q6,16 12,13Q11,7 18,10Q22,4 27,10Q32,5 38,10Q43,7 46,13Q51,14 47,20Q42,24 37,21Q32,25 28,22Q22,26 17,22Q13,25 10,20Z',C.froth,1.05)
       +p('M37,20Q42,18 43,23L42,31Q40,35 38,30Z',C.froth,.65)
       +circle(18,17,1.2,C.stone)+circle(32,14,.9,C.stone)+line('M18,39l1,-3M30,43l1,-4',.5,C.hide);break;
    case 'sea-monsters':
      s=p('M27,35C17,37 11,29 14,24C18,18 21,23 18,26C25,26 20,16 13,18C3,22 9,38 23,43L27,51L39,50C47,43 58,40 58,30C58,22 50,23 50,28C50,31 54,30 54,28C58,37 47,38 40,36Z',C.violet,1.15)
       +p('M26,32C17,19 22,6 33,5C45,7 49,20 40,33L38,40L27,40Z',C.violet,1.3)
       +p('M29,9Q20,20 29,29L32,36L35,28Q28,23 29,9Z',C.lavender,0)
       +p('M28,36C24,43 21,45 15,43C7,39 4,45 8,49C11,52 15,48 12,46C20,53 28,46 32,42C31,50 36,55 45,52C52,50 54,55 51,57C60,56 59,48 52,47C45,46 39,48 38,40Z',C.violet,1.1)
       +p('M27,38Q20,44 14,41M35,40Q35,50 47,49','none',1.7,C.lavender)
       +p('M25,29q3,-2 5,1l-1,3q-3,0 -4,-4ZM36,30q3,-3 6,-2q-1,5 -5,5Z',C.page,.7)
       +circle(28,30.5,.9,C.void)+circle(38,30.5,.9,C.void)
       +circle(13,34,.85,C.lavender)+circle(16,37,.85,C.lavender)+circle(19,39,.85,C.lavender)+circle(47,39,.85,C.lavender)
       +ripples(55);break;
    case 'hill-monsters':
      s=p('M43,48L48,22L52,22L49,50Z',C.wood,1)+p('M46,24L44,12L48,7L55,8L58,14L55,24Z',C.hide,1.1)
       +p('M49,10L52,9L55,14L53,22H50Z',C.wood,0)+line('M45,15l12,-1M46,20l9,-1',.7,C.darkHide)
       +p('M15,56L11,37Q13,29 22,29L37,29Q45,31 45,39L50,36L54,40Q49,48 43,46L44,58Z',C.skin,1.2)
       +p('M19,31L23,39L35,36L37,30L41,32L40,48L44,58L15,58L18,44L15,32Z',C.hide,1)
       +p('M18,19L15,15L21,15Q20,7 29,7Q39,7 38,16L44,15L40,22L38,29Q31,35 23,29Z',C.skin,1.1)
       +p('M32,10Q39,10 37,18L39,22L35,29L31,30L32,22Z',C.leaf,0)
       +line('M23,19l4,1M33,20l4,-1M29,22l-1,3 4,0',.8,C.void)
       +p('M23,26Q29,31 36,26L34,31H26Z',C.void,.6)+p('M24,28L22,23Q22,29 27,30ZM34,29L38,23Q38,30 32,31Z',C.page,.6)
       +p('M20,43L39,43V47H19Z',C.darkHide,.7)+p('M28,43H33V47H28Z',C.brass,.65)
       +masonry('M23,51l2,3M35,51l-1,5');break;
    case 'sacred-mountains':
      s=halo(32,24,17)+p('M5,56L17,32L24,38L34,14L47,39L51,32L59,56Z',C.slate,1.25)
       +p('M34,15L29,40L35,37L33,56H54L45,42Z',C.shade,0)
       +p('M34,15L24,37L29,34L33,38L36,31L41,35Z',C.white,.75)
       +p('M17,33L9,51L16,47L21,53L24,40Z',C.stone,0)
       +p('M41,36L46,40L50,52L40,47L35,53L36,40Z',C.void,0)
       +line('M23,49l4,-8M42,45l4,6M14,49l-3,4M31,44l-2,8',.55,C.pale)
       +star(34,10,3,C.gold)+line('M16,58q16,1 34,0',.65,C.shade);break;
    case 'sacred-pineries':
      s=halo(32,24,17)+p('M29,41H35L36,58H28Z',C.wood,.95)
       +p('M32,7Q28,18 21,25L26,25Q20,35 13,40L22,40Q16,49 9,53Q20,57 32,52Q44,57 56,52Q46,46 42,39L50,40Q41,32 37,25H43Q35,15 32,7Z',C.pine,1.15)
       +p('M32,9L30,24L25,23L31,16ZM29,27L24,36L18,39L28,37L32,31ZM30,41L24,49L14,52L28,50L33,44Z',C.leafLight,0)
       +p('M33,27L36,34L43,38L33,36ZM33,41L36,48L48,52L33,49Z',C.leaf,0)
       +line('M24,26q7,3 14,0M20,40q12,4 24,0M32,20V53',.55,C.void,'opacity=".55"')
       +p('M26,59q6,-3 13,0','none',.8,C.leaf)+star(32,5,1.6);break;
    case 'sacred-palm-groves':
      s=halo(34,23,16)+group(palm(),'translate(-4 17) scale(.64)')+group(palm(),'translate(5 0) scale(.94)')
       +p('M8,57Q30,49 56,56L51,59H14Z',C.sand,.7)
       +p('M19,56q-1,-4 -4,-4M48,56q1,-5 5,-5','none',.75,C.leaf)+line('M26,56h9',.55,C.brass);break;
    case 'brigands':
      s=group(sword(),'translate(20 -2) rotate(28 32 32) scale(.72)')
       +p('M18,19L16,10L23,13L28,8L32,14L39,11L37,20Q48,33 48,44Q47,56 30,58Q12,57 10,46Q8,35 18,19Z',C.hide,1.15)
       +p('M18,24Q10,40 16,48Q19,53 26,53Q19,41 25,26Z',C.wood,0)
       +p('M34,22Q44,38 41,46L33,53L43,50Q51,42 39,25Z',C.darkHide,0)
       +p('M17,19Q28,23 38,18L39,22Q27,27 17,23Z',C.brass,.75)
       +line('M20,21Q12,27 12,30M35,21q6,3 9,0M28,25l-1,10',.8,C.gold)
       +p('M22,39L34,37L36,47L24,49Z',C.wood,.6)+line('M23,40l2,2M27,39l2,2M32,39l2,1M25,46l-2,1M30,45l1,2',.5,C.darkHide)
       +ellipse(49,54,4,2,C.gold,.8)+ellipse(54,58,4.5,2,C.gold,.8)+circle(48,59,1.2,C.brass);break;
    case 'pirates':
      s=p('M10,58L12,7H15L14,58Z',C.wood,1)+circle(13.5,5,2,C.brass,.7)
       +p('M15,11Q26,6 38,12Q48,17 58,12L55,42Q46,47 36,41Q25,35 15,41Z',C.black,1.2)
       +p('M17,14Q26,10 32,13L29,36Q23,35 17,38Z',C.void,0)
       +p('M40,16Q48,20 56,16L53,39Q46,43 38,39Z',C.void,0)
       +group(skull(),'translate(13 10) scale(.68)')
       +line('M28,33L41,39M29,39L42,33',2,C.page)
       +circle(28,33,1,C.page)+circle(42,33,1,C.page)+circle(29,39,1,C.page)+circle(41,39,1,C.page)
       +line('M12,15h5M12,34h4M11,53h3',.75,C.brass);break;
    case 'jousts':
      s=p('M10,15Q30,10 49,16L48,39Q44,50 29,58Q14,51 10,39Z',C.brass,1.2)
       +p('M14,18Q31,14 45,19L44,39Q40,48 29,53Q18,48 14,38Z',C.clay,.85)
       +p('M30,16Q39,16 45,19L44,35H30ZM14,35H30V53Q18,48 14,38Z',C.blue,0)
       +line('M30,17V53M14,35H44',.7,C.gold)
       +circle(17,21,.8,C.gold)+circle(41,21,.8,C.gold)+circle(18,40,.8,C.gold)+circle(39,41,.8,C.gold)
       +p('M49,56L10,10L12,8L53,53Z',C.wood,.95)+p('M10,11L5,4L13,8L15,12Z',C.iron,.8)
       +p('M21,19L31,20L26,28Z',C.page,.7)+p('M22,20L25,21L28,26L26,28Z',C.clay,0)
       +p('M42,43L47,42L55,53L50,58L45,50Z',C.brass,.8)+line('M45,46l5,7',.6,C.gold);break;
    case 'fairs':
      s=p('M11,25H15V55H11ZM49,25H53V55H49Z',C.wood,.9)
       +p('M9,41H55V57H9Z',C.wood,1)+p('M12,45H51V54H12Z',C.pale,.65)
       +line('M17,46v8M28,45v9M41,45v9',.5,C.wood)
       +p('M12,13H52L59,27Q55,32 50,27Q45,33 41,27Q36,32 32,27Q27,33 23,27Q17,32 14,27Q8,32 5,27Z',C.page,1.15)
       +p('M14,13H22L20,27Q17,30 14,27L8,28ZM30,13H38L40,27Q36,31 32,27L28,28ZM46,13H52L59,27Q55,31 50,27Z',C.clay,.55)
       +p('M10,40H55V44H10Z',C.hide,.8)
       +p('M17,39L16,34H28L27,40Z',C.brass,.65)+circle(19,33,2.3,C.clay,.5)+circle(24,33,2.4,C.gold,.5)+circle(22,30,2.3,C.leafLight,.5)
       +p('M36,40L34,31L37,28L41,29L43,39Z',C.stone,.7)+line('M37,31l3,0',.6,C.hide)
       +p('M16,13V8H49V13Z',C.wood,.8)+line('M20,10.5H28M35,10.5H45',.5,C.pale);break;
    case 'canoes':
      s=ripples(54)+p('M5,38Q27,45 59,29Q57,46 43,51Q17,56 5,38Z',C.wood,1.2)
       +p('M6,37Q33,45 58,29Q54,39 36,43Q16,47 6,37Z',C.darkHide,1)
       +p('M12,38Q32,43 53,33Q44,41 28,42Q17,43 12,38Z',C.void,0)
       +p('M21,40l4,-2 4,5-4,1ZM38,37l4,-2 4,4-4,2Z',C.pale,.7)
       +line('M10,42Q26,53 51,40M20,49q10,1 18,-2',.6,C.hide)
       +p('M15,8L18,6L39,34L37,36Z',C.wood,.85)
       +p('M37,31Q39,29 41,33L49,43Q51,48 48,50Q45,50 43,47L35,36Q33,32 37,31Z',C.pale,1)
       +line('M38,33L47,46',.65,C.hide)+line('M47,53q6,-1 10,-4',.8,C.foam);break;
    case 'migration':
      s=p('M11,44L10,55L15,56L20,44ZM31,43L33,55L38,55L37,42Z',C.darkHide,1)
       +p('M8,32Q2,29 5,24Q9,21 11,26Q10,29 8,27','none',1.4,C.hide)
       +p('M9,35Q8,23 17,20L18,16L23,19L26,15L31,18L35,16L41,21L44,28L51,29L58,35L57,43L49,46L42,42Q34,49 18,46Q10,43 9,35Z',C.hide,1.25)
       +p('M14,29Q16,22 25,22Q35,21 38,27Q28,26 24,33Q15,39 14,29Z',C.wood,0)
       +p('M37,28L39,19L45,22L44,32Z',C.darkHide,.9)+p('M40,25L41,22L43,24L42,28Z',C.clay,0)
       +p('M46,30L53,32L56,36L54,42L48,43L45,38Z',C.wood,0)
       +ellipse(56,38,3.7,4,C.darkHide,.7)+circle(56,37,.7,C.void)+circle(57.5,39,.6,C.void)
       +circle(47,33,1,C.void)+p('M49,42Q42,38 46,35Q41,36 43,42Q45,46 49,42Z',C.page,.65)
       +p('M17,43L17,55H23L25,46M39,42L40,54H45L46,44',C.hide,.9)
       +line('M17,55h6M40,54h5M17,24l-2,3M23,23l-2,4M29,23l-2,3M21,39l-2,3M29,40l-2,3',.55,C.darkHide);break;
    case 'dances':
      s=p('M25,49L24,58L18,60L17,58L21,56L20,48ZM33,50L39,56L44,55L46,57L38,59L29,52Z',C.pale,.85)
       +p('M19,25L12,21L7,12L10,10L17,18L25,20L33,19L40,13L44,6L47,7L44,17L36,25L34,32L40,43L25,45L20,34Z',C.pale,1.05)
       +p('M21,24L27,27L33,23L34,34L25,39L20,34Z',C.blue,1)
       +p('M21,34L34,33Q37,43 52,48Q44,52 39,52Q34,58 29,54Q23,58 18,52Q10,53 7,48Q18,42 21,34Z',C.clay,1.15)
       +p('M24,36L29,35Q25,47 23,53L18,52L12,50Q22,43 24,36Z',C.pale,0)
       +p('M31,35L33,35Q37,43 45,49L40,50Q34,46 31,35Z',C.gold,0)
       +line('M22,38Q21,45 16,48M32,39Q32,47 36,51',.6,C.hide)
       +p('M23,13Q20,6 26,5Q34,5 33,13L30,20L25,18Z',C.pale,.9)
       +p('M23,13Q19,9 22,6Q25,2 29,5Q36,4 35,10L31,12L29,8L25,10Z',C.darkHide,.85)
       +line('M28,13h1M27,17l3,-1',.5,C.void)
       +circle(47,9,6,C.gold,.9)+circle(47,9,3.8,C.page,.55)+line('M43,6l1,2M49,12l2,1',.65,C.brass)
       +line('M7,15Q4,24 11,28M43,23Q50,26 54,19',.9,C.gold);break;
    case 'mirage':
      s=p('M6,46Q19,41 33,44Q48,41 59,45L55,53Q29,58 8,52Z',C.sand,0)
       +group(palm(),'translate(8 -1) scale(.75)')
       +p('M5,28Q21,25 38,30T60,29V43Q44,39 29,43T5,41Z',C.white,0,'none','opacity=".62"')
       +line('M7,41Q20,36 32,40T57,39M9,47Q21,43 35,47T58,45',1.4,C.water)
       +line('M15,52Q28,49 42,53M20,57Q29,55 36,57',1.1,C.foam)
       +p('M28,46Q33,48 29,54L34,55L35,48Z',C.leafLight,0,'none','opacity=".5"')
       +star(50,15,2,C.gold)+circle(14,14,3.3,C.flame,.55,C.gold);break;
    case 'caves':
      s=p('M5,56L10,37L19,24L30,22L43,27L52,38L59,57Z',C.shade,1.25)
       +p('M9,52L15,38L24,29L31,26L30,33L19,40L15,54Z',C.stone,0)
       +p('M17,55L20,40L29,33L38,35L45,42L48,57Z',C.void,1)
       +p('M21,41L25,42L26,50L30,39L34,43L36,38L41,42L41,47L45,44L38,35L29,33Z',C.slate,.65)
       +p('M17,55L19,49L22,52L24,48L27,56ZM38,57L40,51L43,55L45,49L47,57Z',C.slate,.6)
       +masonry('M11,47l4,-6M18,32l5,-4M46,32l-2,5 5,5M52,49l3,4')
       +p('M17,14Q21,4 27,12L29,9L31,12L34,9L37,12Q44,5 49,14Q43,12 42,19Q37,16 33,23L30,24Q27,18 23,20Q23,13 17,14Z',C.black,.95)
       +line('M20,13L28,16M46,13L36,16',.55,C.slate)+p('M8,58l4,-2 3,2M49,58l4,-2 5,2','none',.7,C.leaf);break;
    case 'rifts':
      s=p('M26,5L38,13L33,23L46,28L38,36L48,51L36,58L28,47L19,44L25,34L15,28L23,21L18,11Z',C.void,1.25)
       +p('M26,7L31,17L27,26L37,30L29,37L39,52L35,56L27,44L23,42L29,33L20,28L28,21L23,12Z',C.violet,0)
       +p('M27,11L33,18L29,26L38,30L32,37L41,51L35,47L28,37L34,30L25,26L30,18Z',C.lavender,0)
       +line('M27,12L32,18L28,26L37,30L30,37L39,50',1.05,C.white)
       +p('M10,18l5,-4 1,6-4,3ZM48,15l5,3-4,4-3,-3ZM10,44l6,-4 3,4-5,3ZM49,43l7,3-3,6-4,-3Z',C.shade,.8)
       +line('M13,30l-7,2M47,32l10,-3M23,50l-4,6',1,C.violet)
       +star(43,9,2,C.lavender)+star(19,54,1.5,C.gold);break;
    default:throw new Error(`Unknown marker: ${kind}`);
  }
  return `<g stroke-linecap="round" stroke-linejoin="round">${s}</g>`;
}
