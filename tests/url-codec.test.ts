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
