import {biomes,floraCatalog,flora,svg,xml} from './landscape.mjs';
import {farmCatalog,fieldTile,farmParcel,parcelForms} from './farms.mjs';
const $=id=>document.getElementById(id),label=s=>s.replaceAll('-',' '),seeds=[11,42,74];let current;
const options=(el,values)=>el.innerHTML=values.map(v=>`<option value="${v}">${label(v)}</option>`).join('');
options($('biome'),Object.keys(biomes));
function tilePreview(a,id='preview-tile',angle=0){return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><pattern id="${id}" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">${a.body}</pattern></defs><rect width="128" height="128" fill="url(#${id})"/></svg>`;}
function updateKinds(){const b=$('biome').value,c=$('category').value;options($('kind'),(c==='flora'?floraCatalog[b]:farmCatalog[b]).map(s=>s.kind));render();saved();}
function render(){
  const b=$('biome').value,c=$('category').value,k=$('kind').value,seed=Math.max(0,Math.min(4294967295,Math.trunc(Number($('seed').value)||0))),winter=b==='tundra'&&$('snow').checked;
  $('snow-control').hidden=c!=='flora'||b!=='tundra';$('form-control').hidden=c!=='farm';$('angle-control').hidden=c==='flora';
  current=c==='flora'?flora(b,k,{seed,winter}):c==='field'?fieldTile(b,k,{seed}):farmParcel(b,k,{seed,form:$('form').value,angle:Number($('angle').value),id:'live-farm'});
  $('live').innerHTML=c==='field'?tilePreview(current,'live-tile',Number($('angle').value)):svg(current,{title:label(k)});$('live').style.background=biomes[b].ground;
  $('live-title').textContent=label(k);$('site').textContent=current.site;
  $('details').textContent=c==='flora'?`${current.layer} · suggested ${current.nominalFootprint[0]} m footprint · ${current.season==='snow'?'snow state':'growing season'}`:c==='field'?'Four by four repeats of the same borderless tile.':`${current.natural?'Natural land-use area':current.smallPlot?'Small sheltered cultivation':'Cultivated parcel'} · ${current.irrigation?current.dryChannels?'empty irrigation channels':'connected irrigation channels':'no built-in water supply'} · ${current.form} boundary`;
  $('download-note').textContent=c==='field'?'Download is the unrotated, seamless 32 × 32 tile. Apply crop direction to your pattern fill.':'Download includes this seed and the visible form.';
}
function saved(){
  const b=$('biome').value,c=$('category').value,winter=b==='tundra'&&$('snow').checked,catalog=c==='flora'?floraCatalog[b]:farmCatalog[b];
  $('count').textContent=`/ ${catalog.length} types`;
  $('grid').innerHTML=catalog.map((spec,i)=>{
    let samples='';const count=c==='field'?1:3;
    for(let v=0;v<count;v++){
      const form=Object.keys(parcelForms)[v],id=c==='flora'?`sm-flora-${spec.kind}-${'abc'[v]}${winter?'-snow':''}--${b}`:c==='field'?`sm-field-${spec.kind}--${b}`:`sm-farm-${spec.kind}-${form}--${b}`;
      const a=c==='flora'?flora(b,spec.kind,{seed:seeds[v],winter}):c==='field'?fieldTile(b,spec.kind):farmParcel(b,spec.kind,{form,angle:form==='riverside'?-16:form==='terrace'?12:0,id:`saved-${b}-${i}-${v}`});
      samples+=`<div class="sample">${c==='field'?tilePreview(a,`saved-tile-${b}-${i}`):svg(a,{title:label(spec.kind)})}<a href="individual/${id}.svg" download>${c==='flora'?`Variant ${'ABC'[v]}`:c==='field'?'Seamless tile':form} SVG</a></div>`;
    }
    return`<article><div class="art" style="background:${biomes[b].ground}">${samples}</div><div class="caption"><h3>${label(spec.kind)}</h3><p>${xml(spec.site)}</p><button data-kind="${spec.kind}">Explore variations</button></div></article>`;
  }).join('');
  for(const button of $('grid').querySelectorAll('button'))button.addEventListener('click',()=>{$('kind').value=button.dataset.kind;render();$('live-title').scrollIntoView({behavior:'smooth',block:'center'});});
}
for(const id of ['biome','category'])$(id).addEventListener('change',updateKinds);
for(const id of ['kind','seed','form','angle'])$(id).addEventListener('input',render);
$('snow').addEventListener('input',()=>{render();saved();});
$('next').addEventListener('click',()=>{$('seed').value=(Number($('seed').value)+1)>>>0;render();});
$('download').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([svg(current,{title:label(current.kind)})],{type:'image/svg+xml'})),a=document.createElement('a');a.href=u;a.download=`sm-${current.category}-${current.kind}--${current.biome}-${current.form??current.season??'tile'}-seed-${current.seed}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
updateKinds();
