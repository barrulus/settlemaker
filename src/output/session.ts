import { createLegacySettlementModel, type GenerateSettlementOptions } from './legacy-model.js';
import { createSettlementModel, type SettlementOptions } from '../settlement/generate.js';
import { renderPhysicalScene, exportSettlement } from '../settlement/output.js';
import type { SettlementModel } from '../settlement/model.js';
import { mapToGenerationParams, type AzgaarBurgInput } from '../input/azgaar-input.js';
import { paletteForTheme, type ThemeName } from './palette.js';
import type { RenderTheme } from './render-theme.js';
import { assembleSvg, type AssembleOptions } from './assemble-svg.js';
import { buildScene } from '../scene/build-scene.js';
import { createSceneIndex } from '../scene/spatial-index.js';
import { SCENE_VERSION, type Scene } from '../scene/scene.js';
import { SETTLEMAKER_VERSION, GEOJSON_SCHEMA_VERSION, generateGeoJson } from './geojson-builder.js';
import { renderVillage } from '../village/render.js';
import { generateVillageGeoJson } from '../village/geojson.js';
import type { LocalBounds } from '../generator/bounds.js';
import type { WaterContextResult } from '../input/water-context.js';
import type { OriginShift } from '../generator/origin-shift.js';
import type { FeatureCollection } from 'geojson';
import type { GenerationStageTiming } from '../generator/timing.js';

declare const __SETTLEMAKER_BUILD_REVISION__: string;
/** Browser builds inject a digest of their actual sources, including uncommitted work.
 * Plain tsc/source consumers have a clearly labelled non-artifact fallback. */
export const BUILD_INFO = Object.freeze({
  protocolVersion: 1, engineVersion: SETTLEMAKER_VERSION, sceneVersion: SCENE_VERSION,
  revision: typeof __SETTLEMAKER_BUILD_REVISION__ === 'string' ? __SETTLEMAKER_BUILD_REVISION__ : `source-${SETTLEMAKER_VERSION}`,
});
export interface SessionAppearance {
  /** null restores the biome's natural palette, independent of the initial options. */
  theme?: ThemeName | null;
  style?: Partial<RenderTheme>;
}
export interface SessionViewOptions {
  bounds?: LocalBounds;
  width?: number;
  detail?: 'auto' | 'full';
  appearance?: SessionAppearance;
  /** Default 1.5 display pixels. Set zero to retain exact physical road depiction. */
  overviewRoadMinPixels?: number;
}
export interface SettlementSessionMetadata {
  kind: 'planned' | 'settlement' | 'village';
  sceneRevision: string;
  engineVersion: string;
  protocolVersion: number;
  buildRevision: string;
  sceneVersion?: number;
  modelVersion?: number;
  generatorRevision?: string;
  exportSchema: {name:string;version:number};
  planner: 'physical-city' | 'physical-village' | 'legacy-city' | 'legacy-village';
  seed: number;
  coordinateSystem: 'local_metres_y_down' | 'legacy_city_mesh_y_down' | 'legacy_village_svg_y_down';
  scaleProvenance: 'physical_layout_v1' | 'legacy_city_estimate' | 'village_render_scale';
  metersPerUnit: number;
  originalBounds: LocalBounds;
  /** Legacy city internal-to-output translation; never relabelled as metres. */
  originShift?: OriginShift;
  /** Village SVG x=(metres-originX)*pixelsPerMetre, likewise y. */
  villageTransform?: {originX:number;originY:number;pixelsPerMetre:number};
  supportsViewport: boolean;
  diagnostics: string[];
  degradedFlags: string[];
  waterContextResult?: WaterContextResult;
  residents?: SettlementModel['residents'];
  timings: GenerationStageTiming[];
}
export interface SettlementSession {
  readonly metadata: SettlementSessionMetadata;
  /** Treat as immutable; model mutations invalidate spatial indexes. */
  readonly scene?: Scene;
  renderView(options?: SessionViewOptions): string;
  renderFull(appearance?: SessionAppearance): string;
  exportGeoJson(): FeatureCollection;
}
let sessionSequence=0;
function inputFingerprint(input: unknown): string {
  const text=JSON.stringify(input);let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}
  return `${(a>>>0).toString(16)}${(b>>>0).toString(16)}`;
}
const checkView=(bounds:LocalBounds,width:number,detail:string)=>{
  if(!Number.isFinite(width)||width<=0)throw new RangeError('render width must be positive and finite');
  if(!Object.values(bounds).every(Number.isFinite)||bounds.max_x<=bounds.min_x||bounds.max_y<=bounds.min_y)throw new RangeError('render bounds must have positive finite dimensions');
  if(!['auto','full'].includes(detail))throw new RangeError('render detail must be auto or full');
};

/** Retain generation once; viewport, appearance and export requests never regenerate.
 * Sessions belong to one module/worker and should be discarded after replacement. */
export function createSettlementSession(input: AzgaarBurgInput, options: GenerateSettlementOptions | SettlementOptions = {}): SettlementSession {
  const started=performance.now();
  const physical='development' in options;
  const legacyOptions=options as GenerateSettlementOptions;
  const stages:GenerationStageTiming[]=[];
  const physicalOptions=options as SettlementOptions;
  const physicalModel=physical?createSettlementModel(input,{...physicalOptions,onStageTiming:timing=>{stages.push(timing);physicalOptions.onStageTiming?.(timing);}}):undefined;
  const legacy=physical?undefined:createLegacySettlementModel(input,legacyOptions);
  const modelDuration=performance.now()-started;
  const svgOptions=physical?{}:legacyOptions.svg??{};
  const skin=options.skin??svgOptions.skin;
  const skinBiome=svgOptions.skinBiome??input.biome;
  const base:AssembleOptions={...svgOptions,skin,skinBiome,
    palette:svgOptions.palette??(options.theme===undefined?undefined:paletteForTheme(options.theme)),
    theme:{...svgOptions.theme,...options.style}};
  const appearance=(change?:SessionAppearance):AssembleOptions=>({...base,
    ...(change&&Object.hasOwn(change,'theme')?{palette:change.theme==null?undefined:paletteForTheme(change.theme)}:{}),
    theme:{...base.theme,...change?.style}});
  const scene=physicalModel?.scene??(legacy?.kind==='settlement'?buildScene(legacy.model,{shift:legacy.originShift,padding:svgOptions.padding}):undefined);
  const index=scene?createSceneIndex(scene):undefined;
  const px=legacyOptions.village?.pxPerMetre??4;
  const frame=legacy?.kind==='village'?legacy.model.frame:undefined;
  const originalBounds=scene?{...scene.bounds}:{min_x:0,min_y:0,max_x:(frame!.maxX-frame!.minX)*px,max_y:(frame!.maxY-frame!.minY)*px};
  const metadata:SettlementSessionMetadata={kind:physical?'planned':legacy!.kind,
    sceneRevision:`${BUILD_INFO.revision}:${inputFingerprint({input,options})}:session:${++sessionSequence}`,
    engineVersion:BUILD_INFO.engineVersion,protocolVersion:BUILD_INFO.protocolVersion,buildRevision:BUILD_INFO.revision,
    ...(scene?{sceneVersion:scene.version}:{}),
    ...(physicalModel?{modelVersion:physicalModel.version,generatorRevision:physicalModel.generatorRevision}:{}),
    exportSchema:physicalModel?{name:'settlemaker/physical-plan',version:1}:{name:'settlemaker/local-geojson',version:GEOJSON_SCHEMA_VERSION},
    planner:physical?`physical-${(options as SettlementOptions).development.preset}`:legacy!.kind==='village'?'legacy-village':'legacy-city',
    seed:physicalModel?.seed??scene?.seed??options.seed??mapToGenerationParams(input).seed,
    coordinateSystem:physical?'local_metres_y_down':scene?'legacy_city_mesh_y_down':'legacy_village_svg_y_down',
    scaleProvenance:physical?'physical_layout_v1':scene?'legacy_city_estimate':'village_render_scale',
    metersPerUnit:scene?.metersPerUnit??1/px,originalBounds,supportsViewport:!!scene,
    ...(legacy?{originShift:{...legacy.originShift}}:{}),
    ...(frame?{villageTransform:{originX:frame.minX,originY:frame.minY,pixelsPerMetre:px}}:{}),
    diagnostics:physicalModel?[...physicalModel.diagnostics]:legacy!.kind==='village'?[...legacy!.model.diagnostics]:legacy!.degradedFlags.map(f=>`layout could not place ${f}`),
    degradedFlags:physicalModel?[...(physicalModel.degradedFlags??[])]:[...legacy!.degradedFlags],
    waterContextResult:physicalModel?.waterContextResult??legacy?.waterContextResult,
    ...(physicalModel?{residents:structuredClone(physicalModel.residents)}:{}),
    timings:[...stages,{stage:'model',durationMs:modelDuration},{stage:'scene-index',durationMs:performance.now()-started-modelDuration}],
  };
  const full=(change?:SessionAppearance):string=>{
    const a=appearance(change);
    if(physicalModel){
      const fullAppearance={...a,pixelsPerUnit:undefined,overviewRoadMinPixels:undefined};
      return renderPhysicalScene(index!.query(originalBounds,fullAppearance),fullAppearance);
    }
    if(scene)return assembleSvg(scene,{...a,pixelsPerUnit:undefined,overviewRoadMinPixels:undefined});
    const village=legacy!;
    if(village.kind!=='village')throw new Error('Unsupported retained model');
    return renderVillage(village.model,px,legacyOptions.village?.theme,{skin,skinBiome,palette:a.palette,style:a.theme});
  };
  return {metadata,scene,renderFull:full,
    renderView(view={}) {
      const bounds=view.bounds??originalBounds,width=view.width??1200,detail=view.detail??'auto';
      checkView(bounds,width,detail);
      const minimum=view.overviewRoadMinPixels??1.5;
      if(!Number.isFinite(minimum)||minimum<0)throw new RangeError('overviewRoadMinPixels must be nonnegative and finite');
      if(!scene)return full(view.appearance);
      const a={...appearance(view.appearance),preciseBounds:true,pixelsPerUnit:detail==='full'?undefined:width/(bounds.max_x-bounds.min_x),overviewRoadMinPixels:detail==='full'?undefined:minimum};
      const visible=index!.query(bounds,a);
      return physicalModel?renderPhysicalScene(visible,a):assembleSvg(visible,a);
    },
    exportGeoJson() {
      if(physicalModel)return exportSettlement(physicalModel);
      if(legacy!.kind==='village')return generateVillageGeoJson(legacy!.model);
      return generateGeoJson(legacy!.model,{...legacyOptions.geojson,shift:legacy!.originShift});
    }};
}
