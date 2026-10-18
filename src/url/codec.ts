import { resolveSettlementEngine } from '../input/settlement-engine.js';
import { validateWaterContext } from '../input/water-context.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';

/**
 * URL payload codec — the FMG integration channel. Encode: JSON → UTF-8 →
 * deflate-raw → base64url. Uses only web-platform globals so the exact same
 * code runs in browsers and Node 18+; FMG's adapter can copy it verbatim.
 * Envelope: { v: URL_PAYLOAD_VERSION, burg, seed? }. Additive evolution;
 * bump the version on breaking change.
 */
export const URL_PAYLOAD_VERSION = 1;

export type UrlCodecFailure = 'base64' | 'inflate' | 'json' | 'version' | 'shape' | 'villageTheme' | 'roads' | 'engine';

export class UrlCodecError extends Error {
  constructor(readonly reason: UrlCodecFailure, message: string) {
    super(message);
    this.name = 'UrlCodecError';
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new UrlCodecError('base64', 'parameter is not valid base64url');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Generic layer: any JSON value → compressed base64url param. */
export async function encodeJsonParam(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

/** Generic layer: compressed base64url param → JSON value. */
export async function decodeJsonParam(value: string): Promise<unknown> {
  const packed = fromBase64Url(value);
  let bytes: Uint8Array;
  try {
    bytes = await pipe(packed, new DecompressionStream('deflate-raw'));
  } catch {
    throw new UrlCodecError('inflate', 'parameter is not valid deflate-raw data');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UrlCodecError('json', 'decompressed payload is not valid JSON');
  }
}

/** Primary channel: burg (+ optional explicit seed) → `i=` parameter value. */
export async function encodeBurgParam(burg: AzgaarBurgInput, seed?: number): Promise<string> {
  return encodeJsonParam({ v: URL_PAYLOAD_VERSION, burg, ...(seed !== undefined ? { seed } : {}) });
}

/** Primary channel: `i=` parameter value → burg (+ optional seed). Throws UrlCodecError. */
export async function decodeBurgParam(value: string): Promise<{ burg: AzgaarBurgInput; seed?: number }> {
  const payload = await decodeJsonParam(value);
  if (typeof payload !== 'object' || payload === null) {
    throw new UrlCodecError('shape', 'payload is not an object');
  }
  const env = payload as { v?: unknown; burg?: unknown; seed?: unknown; geometryEncoding?: unknown };
  if (env.v !== URL_PAYLOAD_VERSION) {
    throw new UrlCodecError('version', `unsupported payload version ${String(env.v)} (expected ${URL_PAYLOAD_VERSION})`);
  }
  const burg = env.burg as AzgaarBurgInput | undefined;
  if (typeof burg !== 'object' || burg === null ||
      typeof burg.name !== 'string' || typeof burg.population !== 'number') {
    throw new UrlCodecError('shape', 'payload has no plausible burg (name + population required)');
  }
  if (env.geometryEncoding !== undefined) {
    if (env.geometryEncoding !== 'xy-tuples') throw new UrlCodecError('shape', 'unsupported geometry encoding');
    const points = (value: unknown): Array<{ x: number; y: number }> => {
      if (!Array.isArray(value)) throw new UrlCodecError('shape', 'compact geometry must be an array');
      return value.map(p => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(n => typeof n === 'number' && Number.isFinite(n)))
          throw new UrlCodecError('shape', 'compact points must contain two finite coordinates');
        return { x: p[0], y: p[1] };
      });
    };
    if (burg.coastlineGeometry !== undefined) {
      if (!Array.isArray(burg.coastlineGeometry)) throw new UrlCodecError('shape', 'compact coast must be an array');
      burg.coastlineGeometry = burg.coastlineGeometry.map(points);
    }
    if (burg.rivers !== undefined) {
      if (!Array.isArray(burg.rivers)) throw new UrlCodecError('shape', 'compact rivers must be an array');
      burg.rivers = burg.rivers.map(r => {
        if (!r || typeof r !== 'object') throw new UrlCodecError('shape', 'invalid compact river');
        return { ...r, centreline: points(r.centreline) };
      });
    }
  }
  try { resolveSettlementEngine(burg.population, burg.engine); }
  catch (error) { throw new UrlCodecError('engine', (error as Error).message); }
  validateWaterContext(burg);
  return { burg, ...(typeof env.seed === 'number' ? { seed: env.seed } : {}) };
}
