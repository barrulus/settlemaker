import { describe, it, expect } from 'vitest';
import {
  encodeBurgParam, decodeBurgParam, encodeJsonParam, decodeJsonParam,
  UrlCodecError, URL_PAYLOAD_VERSION,
} from '../src/url/codec.js';
import { toprak } from './fixtures/toprak.js';

describe('url codec', () => {
  it('round-trips a full burg with coastline geometry and seed', async () => {
    const param = await encodeBurgParam(toprak, 1234);
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet, no padding
    const out = await decodeBurgParam(param);
    expect(out.burg).toEqual(toprak);
    expect(out.seed).toBe(1234);
  });

  it('omits seed cleanly', async () => {
    const out = await decodeBurgParam(await encodeBurgParam(toprak));
    expect(out.seed).toBeUndefined();
  });

  it('expands compact water coordinates before validating their associations and widths', async () => {
    const burg = { ...toprak, waterfront: { riverId: 'r', shoreKind: 'ocean', shoreFeatureId: 'sea' },
      coastlineGeometry: [[[500, -3000], [3000, -3000], [3000, 3000], [500, 3000]]],
      rivers: [{ id: 'r', centreline: [[-100, -3000], [-100, 3000]], widthM: 20, widthsM: [20, 25] }],
      waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres',
        surveyRadiusM: 3000, geometryErrorM: .5, bodies: [{ kind: 'ocean', featureId: 'sea',
          distanceM: 500, bearingDeg: 90, polygonIndices: [0] }] } };
    const out = await decodeBurgParam(await encodeJsonParam({ v: 1, geometryEncoding: 'xy-tuples', burg, seed: 7 }));
    expect(out.burg.coastlineGeometry?.[0][0]).toEqual({ x: 500, y: -3000 });
    expect(out.burg.rivers?.[0].centreline[1]).toEqual({ x: -100, y: 3000 });
    expect(out.burg.rivers?.[0].widthsM).toEqual([20, 25]);
    expect(out.burg.waterfront).toEqual(burg.waterfront);
    expect(out.seed).toBe(7);
  });

  it.each([[[1]], [[1, 2, 3]], [[1, '2']], [{ x: 1, y: 2 }]])('rejects malformed compact points %j', async centreline => {
    await expect(decodeBurgParam(await encodeJsonParam({ v: 1, geometryEncoding: 'xy-tuples',
      burg: { ...toprak, rivers: [{ centreline, widthM: 20 }] } }))).rejects.toThrow(UrlCodecError);
  });

  it('compresses (coastline burg param is much smaller than raw JSON)', async () => {
    const param = await encodeBurgParam(toprak);
    expect(param.length).toBeLessThan(JSON.stringify(toprak).length);
  });

  it('generic JSON params round-trip (style overrides)', async () => {
    const style = { buildingFill: '#123456', water: '#7aa' };
    expect(await decodeJsonParam(await encodeJsonParam(style))).toEqual(style);
  });

  it.each([
    ['not base64url!!', ['base64', 'inflate']],
    ['AAAA', ['inflate']],
  ])('rejects garbage %s with a transport-layer reason', async (value, reasons) => {
    const err = await decodeBurgParam(value).catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect(reasons).toContain((err as UrlCodecError).reason);
  });

  it('rejects a wrong-version envelope', async () => {
    const param = await encodeJsonParam({ v: URL_PAYLOAD_VERSION + 1, burg: toprak });
    const err = await decodeBurgParam(param).catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect((err as UrlCodecError).reason).toBe('version');
  });

  it('rejects an envelope without a plausible burg', async () => {
    const param = await encodeJsonParam({ v: URL_PAYLOAD_VERSION, burg: { nope: true } });
    const err = await decodeBurgParam(param).catch(e => e);
    expect(err).toBeInstanceOf(UrlCodecError);
    expect((err as UrlCodecError).reason).toBe('shape');
  });
});
