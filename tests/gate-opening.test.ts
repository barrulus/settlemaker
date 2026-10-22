import { describe, expect, it } from 'vitest';
import { gateOpeningHalfWidth } from '../src/scene/gate-opening.js';
import { wallGateReach } from '../src/assets/fortification-dimensions.js';
import { generateSettlement } from '../src/index.js';
import type { RoadFeature } from '../src/scene/scene.js';
import { wall } from '../src/assets/infrastructure-art.js';

describe('city gate openings', () => {
  it.each([0,30])('opens two full-length timber leaves alongside a road at %s degrees', angle => {
    const rad=angle*Math.PI/180,direction=[Math.sin(rad),Math.cos(rad)];
    const art=wall([[0,0],[100,0]],{gates:[{at:50,width:36,direction}]});
    expect(art.gateLeaves).toHaveLength(2);
    expect(art.body.match(/data-gate="leaf"/g)).toHaveLength(2);
    const [left,right]=art.gateLeaves;
    const opening=Math.hypot(right.hinge[0]-left.hinge[0],right.hinge[1]-left.hinge[1]);
    expect(left.length+right.length).toBeCloseTo(opening,8);
    for(const leaf of art.gateLeaves) {
      const dx=leaf.tip[0]-leaf.hinge[0],dy=leaf.tip[1]-leaf.hinge[1];
      expect(dx*direction[1]-dy*direction[0]).toBeCloseTo(0,8);
      expect(Math.hypot(dx,dy)).toBeCloseTo(leaf.length,8);
      // Doors hinge at the outer mouth and run along the passage inside it.
      expect(leaf.hinge[1]).toBeLessThan(-12);
      expect(leaf.tip[1]).toBeGreaterThan(0);
      expect(leaf.tip[1]).toBeLessThan(art.viewBox[1]+art.viewBox[3]);
    }
  });

  it('keeps one closable pair for merged cuts and gates spanning the closing vertex', () => {
    const ordinary=wall([[0,0],[100,0]],{gates:[{at:45,width:20},{at:55,width:20}]});
    expect(ordinary.gateLeaves).toHaveLength(2);
    expect(ordinary.gateLeaves[0].length).toBeCloseTo(15,8);
    const corner=wall([[0,0],[100,0],[100,100],[0,100],[0,0]],{gates:[{at:0,width:20},{at:400,width:20}]});
    expect(corner.gateLeaves).toHaveLength(2);
    const [a,b]=corner.gateLeaves;
    expect(a.length+b.length).toBeCloseTo(Math.hypot(a.hinge[0]-b.hinge[0],a.hinge[1]-b.hinge[1]),8);
  });

  it.each([0,25,50])('clears a road crossing at %s degrees throughout the tower depth, independently of layout scale', tilt => {
    const a=tilt*Math.PI/180, width=3.6;
    const results=[];
    for(const units of [1,3,7]) {
      const roads:RoadFeature[]=[{kind:'road',width:width/units,path:[
        {x:-20*Math.sin(a)/units,y:-20*Math.cos(a)/units},
        {x:20*Math.sin(a)/units,y:20*Math.cos(a)/units}]}];
      const half=gateOpeningHalfWidth({x:0,y:0},[{x:-50/units,y:0},{x:50/units,y:0}],roads,units,false)*units;
      results.push(half);
      // At either face of the towers, even the road edge plus clearance fits.
      for(const y of [-wallGateReach(false),wallGateReach(false)])
        expect(half).toBeGreaterThanOrEqual(Math.abs(y*Math.tan(a))+(width/2+.399)/Math.cos(a));
    }
    for(const half of results)expect(half).toBeCloseTo(results[0],10);
  });

  it('exports compact road-sized entrances in a physical city scene', () => {
    const input={name:'Gate review',population:2500,biome:'temperate' as const,engine:'city' as const,
      walls:true,plaza:true,temple:true,port:false,citadel:false,capital:false,shanty:false,roadBearings:[18,142,267]};
    const scene=generateSettlement(input,{seed:2}).model.scene;
    const gates=scene.layers.walls[0].gates;
    expect(gates).toHaveLength(3);
    for(const gate of gates) {
      const width=Math.hypot(gate.p2.x-gate.p1.x,gate.p2.y-gate.p1.y);
      expect(width).toBeGreaterThanOrEqual(4.4-1e-6);
      expect(width).toBeLessThan(9);
    }
  });
});
