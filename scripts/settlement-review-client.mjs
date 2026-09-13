const fixtures=globalThis.settlementReviewFixtures, manifest=globalThis.settlementReviewManifest;
const cache=new Map(),pending=new Map();
globalThis.settlementReviewRegister=(key,model)=>{
  cache.delete(key);cache.set(key,model);while(cache.size>3)cache.delete(cache.keys().next().value);
  pending.get(key)?.resolve(model);pending.delete(key);
};
function load(key){
  if(cache.has(key))return Promise.resolve(cache.get(key));
  if(pending.has(key))return pending.get(key).promise;
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  pending.set(key,{promise,resolve,reject});
  const script=document.createElement('script');script.src=`data/${key}.js`;
  script.onerror=()=>{pending.delete(key);script.remove();reject(Error(`Could not load ${key}`));};
  script.onload=()=>{script.remove();if(pending.has(key)){pending.delete(key);reject(Error(`Invalid map data: ${key}`));}};
  document.head.append(script);return promise;
}
const workerURL=URL.createObjectURL(new Blob([globalThis.settlementReviewWorker],{type:'text/javascript'}));
let worker,workerError,jobId=0;const jobs=new Map(),workerScenes=new Map();
function startWorker(){
  worker?.terminate();for(const job of jobs.values())job.reject(Error('Cancelled'));jobs.clear();
  workerScenes.clear();workerError=null;
  worker=new Worker(workerURL);
  worker.onmessage=({data})=>{const job=jobs.get(data.id);jobs.delete(data.id);if(data.error)job?.reject(Error(data.error));else job?.resolve(data);};
  worker.onerror=()=>{workerError=Error('Could not start the map renderer');for(const job of jobs.values())job.reject(workerError);jobs.clear();};
}
function render(key,scene,bounds,width,theme){
  if(workerError)return Promise.reject(workerError);
  const id=++jobId;
  const upload=workerScenes.has(key)?undefined:scene;
  workerScenes.delete(key);workerScenes.set(key,true);while(workerScenes.size>3)workerScenes.delete(workerScenes.keys().next().value);
  return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});worker.postMessage({id,key,scene:upload,bounds,width,theme});});
}
const controls=Object.fromEntries(['biome','theme','view','population','seed'].map(id=>[id,document.getElementById(id)]));
const maps=document.getElementById('maps'),status=document.getElementById('status'),viewer=document.getElementById('viewer');
const number=n=>n.toLocaleString('en-GB');
const census=meta=>`Whole settlement: ${number(meta.buildingsInsideWalls)} residential buildings inside walls + ${number(meta.buildingsOutsideWalls)} outside (${number(meta.residentialBuildings)} total). Residents: ${number(meta.residents.insideWalls.assigned)} inside / ${number(meta.residents.outsideWalls.assigned)} outside · ${number(meta.residents.unassigned)} unassigned`;
let generation=0,observer,urls=[],activeMap,viewRevision=0,viewerURL;
function closeViewer(){viewRevision++;activeMap=null;viewer.close();if(viewerURL)URL.revokeObjectURL(viewerURL);viewerURL=null;document.getElementById('viewer-map').removeAttribute('src');}
async function drawViewer(){
  const revision=++viewRevision,active=activeMap;if(!active)return;
  document.getElementById('viewer-summary').textContent=census(manifest[active.key]);
  document.getElementById('viewer-status').textContent='Drawing…';
  try{
    const {blob}=await render(active.key,active.scene,active.bounds,Math.min(1400,innerWidth),active.theme??controls.theme.value);
    if(revision!==viewRevision)return;
    const url=URL.createObjectURL(blob),img=document.getElementById('viewer-map');
    img.src=url;await img.decode();if(revision!==viewRevision){URL.revokeObjectURL(url);return;}
    if(viewerURL)URL.revokeObjectURL(viewerURL);viewerURL=url;
    const download=document.getElementById('download-view');download.href=url;download.download='settlement-view.svg';
    document.getElementById('viewer-status').textContent=`View width ${number(Math.round(active.bounds.max_x-active.bounds.min_x))} m`;
  }catch(e){if(revision===viewRevision)document.getElementById('viewer-status').textContent=e.message;}
}
function moveView(scale=1,dx=0,dy=0){
  if(!activeMap)return;const b=activeMap.bounds,w=b.max_x-b.min_x,h=b.max_y-b.min_y;
  const x=(b.min_x+b.max_x)/2+dx*w,y=(b.min_y+b.max_y)/2+dy*h;
  activeMap.bounds={min_x:x-w*scale/2,max_x:x+w*scale/2,min_y:y-h*scale/2,max_y:y+h*scale/2};drawViewer();
}
document.getElementById('zoom-in').onclick=()=>moveView(.5);
document.getElementById('zoom-out').onclick=()=>moveView(2);
for(const [id,dx,dy] of [['pan-left',-.35,0],['pan-right',.35,0],['pan-up',0,-.35],['pan-down',0,.35]])document.getElementById(id).onclick=()=>moveView(1,dx,dy);
document.getElementById('fit-view').onclick=()=>{if(activeMap){activeMap.bounds={...activeMap.original};drawViewer();}};
document.getElementById('close-viewer').onclick=closeViewer;
viewer.addEventListener('cancel',e=>{e.preventDefault();closeViewer();});
document.getElementById('open-large').onclick=async()=>{
  const revision=++viewRevision;
  viewer.showModal();document.getElementById('viewer-title').textContent='City · 200,000 residents';
  document.getElementById('viewer-status').textContent='Loading city…';
  try{
    const model=await load('city-200000');if(revision!==viewRevision)return;
    const radius=manifest['city-200000'].centreRadius;
    activeMap={key:'city-200000',scene:model.scene,theme:'natural',bounds:{min_x:-radius,min_y:-radius,max_x:radius,max_y:radius},original:model.scene.bounds};
    drawViewer();
  }catch(error){if(revision===viewRevision)document.getElementById('viewer-status').textContent=error.message;}
};
async function update(){
  const current=++generation;closeViewer();observer?.disconnect();startWorker();urls.forEach(URL.revokeObjectURL);urls=[];
  maps.replaceChildren();
  const selected=fixtures.filter(f=>(controls.population.value==='all'||f.population===Number(controls.population.value))&&(controls.seed.value==='all'||f.seed===Number(controls.seed.value)));
  const entries=selected.map(f=>{const key=`${controls.biome.value}-${f.preset}-${f.population}-${f.seed}`;return{f,key,meta:manifest[key]};});
  const view=controls.view.value,theme=controls.theme.value;
  const radius=Math.max(...entries.map(({meta})=>view==='centre'?meta.centreRadius:meta.radius));
  status.textContent=`${selected.length} maps · ${view==='fit'?'Each landscape fits its own panel':'Every panel uses the same metres per pixel'}. Previews load as you scroll. Click a map to zoom.`;
  const callbacks=new Map();
  // Only one preview is assembled/decoded at a time. Controls remain usable,
  // and changing them terminates obsolete worker jobs rather than queuing more.
  let queue=Promise.resolve();
  observer=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){observer.unobserve(item.target);const callback=callbacks.get(item.target);queue=queue.then(callback).catch(()=>{});}},{rootMargin:'160px'});
  for(const {f,key,meta} of entries){
    const bounds=view==='fit'?meta.bounds:{min_x:-radius,min_y:-radius,max_x:radius,max_y:radius};
    const figure=document.createElement('figure'),caption=document.createElement('figcaption'),button=document.createElement('button'),img=document.createElement('img'),stats=document.createElement('p'),scale=document.createElement('p');
    caption.textContent=`${f.preset==='city'?'City':'Village'} · ${number(f.population)} residents · seed ${f.seed}`;
    img.alt=caption.textContent;button.className='map-button';button.disabled=true;button.append(img);
    const r=meta.residents;stats.className=r.unassigned?'stats shortage':'stats';
    stats.textContent=census(meta);
    scale.className='scale';scale.textContent='Preview waiting…';figure.append(caption,button,stats,scale);maps.append(figure);
    callbacks.set(figure,async()=>{
      if(current!==generation)return;
      try{
        scale.textContent='Loading preview…';const model=await load(key);if(current!==generation)return;
        const {blob}=await render(key,model.scene,bounds,Math.max(320,Math.min(900,figure.clientWidth)),theme);if(current!==generation)return;
        const url=URL.createObjectURL(blob);urls.push(url);img.src=url;await img.decode();if(current!==generation)return;
        figure.dataset.ready='true';button.disabled=false;
        scale.textContent=`View width ${number(Math.round(bounds.max_x-bounds.min_x))} m · capacity ${number(r.capacity)} residents`;
        button.onclick=async()=>{
          try{
            const latest=await load(key);if(current!==generation)return;
            activeMap={key,scene:latest.scene,bounds:{...bounds},original:bounds};viewer.showModal();document.getElementById('viewer-title').textContent=caption.textContent;drawViewer();
          }catch(error){if(current===generation)scale.textContent=error.message;}
        };
      }catch(error){if(current===generation){scale.textContent=error.message;figure.dataset.error='true';}}
    });observer.observe(figure);
  }
}
for(const control of Object.values(controls))control.addEventListener('change',update);
update();
