import { describe, expect, it } from 'vitest';
import { fitInscribedRectangle } from '../src/geom/inscribed-rectangle.js';
import { Polygon } from '../src/geom/polygon.js';
import { Point } from '../src/types/point.js';
import { segmentInside } from '../src/generator/city-frontage.js';

const polygon = (coordinates: number[][]) => new Polygon(coordinates.map(([x,y]) => new Point(x,y)));
function corners(fit: NonNullable<ReturnType<typeof fitInscribedRectangle>>, width: number, height: number, rotation: number) {
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
    const dx=x*width*fit.scale/2,dy=y*height*fit.scale/2;
    return new Point(fit.center.x+dx*Math.cos(rotation)-dy*Math.sin(rotation),fit.center.y+dx*Math.sin(rotation)+dy*Math.cos(rotation));
  });
}

describe('translated contained rectangles', () => {
  it('recovers useful space at the broad end of a taper without crossing its boundary', () => {
    const site=polygon([[0,0],[12,0],[3,12],[0,12]]);
    const fit=fitInscribedRectangle(site,1,1,0,Infinity,0)!;
    expect(fit.scale).toBeCloseTo(48/7,8);
    expect(fit.center.x).toBeCloseTo(24/7,8);
    expect(fit.center.y).toBeCloseTo(24/7,8);
    const ring=corners(fit,1,1,0);
    for(let i=0;i<4;i++)expect(segmentInside(ring[i],ring[(i+1)%4],site)).toBe(true);
  });

  it('keeps a physically capped fit at the original centre when possible', () => {
    const site=polygon([[0,0],[20,0],[20,12],[0,12]]);
    const fit=fitInscribedRectangle(site,4,6,0,1.35)!;
    expect(fit.scale).toBeCloseTo(1.35,10);
    expect(fit.center).toEqual(site.centroid);
    expect(fitInscribedRectangle(site,4,6,0,1.35)).toEqual(fit);
  });

  it('handles rotated reversed rings and large world coordinates', () => {
    const rotation=.72, ox=700000,oy=-300000;
    const site=polygon([[0,0],[12,0],[12,8],[0,8]].reverse().map(([x,y])=>[ox+x*Math.cos(rotation)-y*Math.sin(rotation),oy+x*Math.sin(rotation)+y*Math.cos(rotation)]));
    const fit=fitInscribedRectangle(site,6,4,rotation)!;
    expect(fit.scale).toBeCloseTo(1.999,5);
    const ring=corners(fit,6,4,rotation);
    for(let i=0;i<4;i++)expect(segmentInside(ring[i],ring[(i+1)%4],site)).toBe(true);
  });

  it('uses the concave kernel rather than bridging a notch', () => {
    const site=polygon([[0,0],[10,0],[10,4],[4,4],[4,10],[0,10]]);
    const fit=fitInscribedRectangle(site,1,1,0)!;
    expect(fit.scale).toBeCloseTo(3.996,8);
    const ring=corners(fit,1,1,0);
    for(let i=0;i<4;i++)expect(segmentInside(ring[i],ring[(i+1)%4],site)).toBe(true);
    const u=polygon([[0,0],[10,0],[10,10],[7,10],[7,3],[3,3],[3,10],[0,10]]);
    expect(fitInscribedRectangle(u,1,1,0)).toBeNull();
  });

  it('rejects degenerate or invalid dimensions without nonfinite geometry', () => {
    expect(fitInscribedRectangle(polygon([[0,0],[1,1],[2,2]]),1,1,0)).toBeNull();
    expect(fitInscribedRectangle(polygon([[0,0],[1,0],[0,1]]),0,1,0)).toBeNull();
    expect(fitInscribedRectangle(polygon([[0,0],[1,0],[0,1]]),1,1,0,NaN)).toBeNull();
  });
});
