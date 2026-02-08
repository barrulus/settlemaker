import { Point } from '../types/point.js';
import { Graph, Node } from '../geom/graph.js';
import { addUnique, difference } from '../utils/array-utils.js';
import type { Model } from './model.js';

/**
 * Street topology graph — port of Topology.hx.
 * Builds a graph from patch vertices for A* pathfinding.
 */
export class Topology {
  private model: Model;
  private graph: Graph;

  pt2node: Map<Point, Node> = new Map();
  node2pt: Map<Node, Point> = new Map();

  private blocked: Point[];

  inner: Node[] = [];
  outer: Node[] = [];

  constructor(model: Model) {
    this.model = model;
    this.graph = new Graph();

    // Build blocked list: citadel vertices + wall vertices, minus gates
    let blocked: Point[] = [];
    if (model.citadel) {
      blocked = blocked.concat(model.citadel.shape.vertices);
    }
    if (model.wall) {
      blocked = blocked.concat(model.wall.shape.vertices);
    }
    this.blocked = difference(blocked, model.gates);

    const border = model.border!.shape;

    for (const p of model.patches) {
      const withinCity = p.withinCity;
      const shape = p.shape;

      let v1 = shape.last();
      let n1 = this.processPoint(v1);

      for (let i = 0; i < shape.length; i++) {
        const v0 = v1;
        v1 = shape.vertices[i];
        const n0 = n1;
        n1 = this.processPoint(v1);

        if (n0 !== null && !border.contains(v0)) {
          if (withinCity) addUnique(this.inner, n0);
          else addUnique(this.outer, n0);
        }
        if (n1 !== null && !border.contains(v1)) {
          if (withinCity) addUnique(this.inner, n1);
          else addUnique(this.outer, n1);
        }

        if (n0 !== null && n1 !== null) {
          n0.link(n1, Point.distance(v0, v1));
        }
      }
    }
  }

  private processPoint(v: Point): Node | null {
    let n: Node;
    if (this.pt2node.has(v)) {
      n = this.pt2node.get(v)!;
    } else {
      n = this.graph.add();
      this.pt2node.set(v, n);
      this.node2pt.set(n, v);
    }
    return this.blocked.includes(v) ? null : n;
  }

  buildPath(from: Point, to: Point, exclude?: Node[]): Point[] | null {
    const fromNode = this.pt2node.get(from);
    const toNode = this.pt2node.get(to);
    if (!fromNode || !toNode) return null;

    const path = this.graph.aStar(fromNode, toNode, exclude);
    return path ? path.map(n => this.node2pt.get(n)!) : null;
  }
}
