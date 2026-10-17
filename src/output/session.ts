import { createSettlementModel, type SettlementOptions } from '../settlement/generate.js';
import { renderPhysicalScene, exportSettlement, type SettlementGeoJson } from '../settlement/output.js';
import type { SettlementModel } from '../settlement/model.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { paletteForTheme, type ThemeName } from './palette.js';
import type { RenderTheme } from './render-theme.js';
import type { AssembleOptions } from './assemble-svg.js';
import { createSceneIndex } from '../scene/spatial-index.js';
import { SCENE_VERSION, type Scene } from '../scene/scene.js';
import { SETTLEMAKER_VERSION } from '../version.js';
import type { LocalBounds } from '../generator/bounds.js';
import type { WaterContextResult } from '../input/water-context.js';
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
  kind: 'planned';
  sceneRevision: string;
  engineVersion: string;
  protocolVersion: number;
  buildRevision: string;
  sceneVersion: number;
  modelVersion: number;
  generatorRevision?: string;
  exportSchema: {name:'settlemaker/physical-plan';version:1};
  planner: 'physical-city' | 'physical-village';
  seed: number;
  coordinateSystem: 'local_metres_y_down';
  scaleProvenance: 'physical_layout_v1';
  metersPerUnit: 1;
  originalBounds: LocalBounds;
  /** Valid geographic coverage, centred on the unchanged burg origin. */
  surveyRadiusM?: number;
  supportsViewport: true;
  diagnostics: string[];
  degradedFlags: string[];
  waterContextResult?: WaterContextResult;
  placement?: SettlementModel['placement'];
  residents: SettlementModel['residents'];
  timings: GenerationStageTiming[];
}
export interface SettlementSession {
  readonly metadata: SettlementSessionMetadata;
  /** Treat as immutable; model mutations invalidate spatial indexes. */
  readonly scene: Scene;
  renderView(options?: SessionViewOptions): string;
  renderFull(appearance?: SessionAppearance): string;
  exportGeoJson(): SettlementGeoJson;
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
export function createSettlementSession(input: AzgaarBurgInput, options: SettlementOptions = {}): SettlementSession {
  const started=performance.now();
  const stages:GenerationStageTiming[]=[];
  const model=createSettlementModel(input,{...options,onStageTiming:timing=>{stages.push(timing);options.onStageTiming?.(timing);}});
  const modelDuration=performance.now()-started;
  const base:AssembleOptions={skin:options.skin,skinBiome:input.biome,
    palette:options.theme===undefined?undefined:paletteForTheme(options.theme),
    theme:options.style};
  const appearance=(change?:SessionAppearance):AssembleOptions=>({...base,
    ...(change&&Object.hasOwn(change,'theme')?{palette:change.theme==null?undefined:paletteForTheme(change.theme)}:{}),
    theme:{...base.theme,...change?.style}});
  const scene=model.scene;
  const index=createSceneIndex(scene);
  const originalBounds={...scene.bounds};
  const metadata:SettlementSessionMetadata={kind:'planned',
    sceneRevision:`${BUILD_INFO.revision}:${inputFingerprint({input,options})}:session:${++sessionSequence}`,
    engineVersion:BUILD_INFO.engineVersion,protocolVersion:BUILD_INFO.protocolVersion,buildRevision:BUILD_INFO.revision,
    sceneVersion:scene.version,modelVersion:model.version,generatorRevision:model.generatorRevision,
    exportSchema:{name:'settlemaker/physical-plan',version:1},
    planner:`physical-${model.development.preset}`,
    seed:model.seed,coordinateSystem:'local_metres_y_down',scaleProvenance:'physical_layout_v1',
    metersPerUnit:1,originalBounds,supportsViewport:true,
    ...(input.waterContext?.status === 'measured' ? { surveyRadiusM: input.waterContext.surveyRadiusM } : {}),
    diagnostics:[...model.diagnostics],degradedFlags:[...(model.degradedFlags??[])],
    waterContextResult:model.waterContextResult,residents:structuredClone(model.residents),
    ...(model.placement ? { placement: structuredClone(model.placement) } : {}),
    timings:[...stages,{stage:'model',durationMs:modelDuration},{stage:'scene-index',durationMs:performance.now()-started-modelDuration}],
  };
  const full=(change?:SessionAppearance):string=>{
    const a={...appearance(change),pixelsPerUnit:undefined,overviewRoadMinPixels:undefined};
    return renderPhysicalScene(index.query(originalBounds,a),a);
  };
  return {metadata,scene,renderFull:full,
    renderView(view={}) {
      const bounds=view.bounds??options.render?.bounds??originalBounds;
      const width=view.width??options.render?.width??1200,detail=view.detail??options.render?.detail??'auto';
      checkView(bounds,width,detail);
      const minimum=view.overviewRoadMinPixels??1.5;
      if(!Number.isFinite(minimum)||minimum<0)throw new RangeError('overviewRoadMinPixels must be nonnegative and finite');
      const a={...appearance(view.appearance),preciseBounds:true,cullOffscreenArtwork:true,pixelsPerUnit:detail==='full'?undefined:width/(bounds.max_x-bounds.min_x),overviewRoadMinPixels:detail==='full'?undefined:minimum};
      return renderPhysicalScene(index.query(bounds,a),a);
    },
    exportGeoJson() { return exportSettlement(model); }};
}
