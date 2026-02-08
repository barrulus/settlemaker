/**
 * Graph + A* pathfinding — port of Graph.hx
 */
export class Node {
  links: Map<Node, number> = new Map();

  link(node: Node, price: number = 1, symmetrical: boolean = true): void {
    this.links.set(node, price);
    if (symmetrical) {
      node.links.set(this, price);
    }
  }

  unlink(node: Node, symmetrical: boolean = true): void {
    this.links.delete(node);
    if (symmetrical) {
      node.links.delete(this);
    }
  }

  unlinkAll(): void {
    for (const node of this.links.keys()) {
      this.unlink(node);
    }
  }
}

export class Graph {
  nodes: Node[] = [];

  add(node?: Node): Node {
    if (!node) node = new Node();
    this.nodes.push(node);
    return node;
  }

  remove(node: Node): void {
    node.unlinkAll();
    const idx = this.nodes.indexOf(node);
    if (idx !== -1) this.nodes.splice(idx, 1);
  }

  aStar(start: Node, goal: Node, exclude?: Node[]): Node[] | null {
    const closedSet: Node[] = exclude ? exclude.slice() : [];
    const openSet: Node[] = [start];
    const cameFrom = new Map<Node, Node>();
    const gScore = new Map<Node, number>();
    gScore.set(start, 0);

    while (openSet.length > 0) {
      const current = openSet.shift()!;
      if (current === goal) {
        return this.buildPath(cameFrom, current);
      }

      closedSet.push(current);

      const curScore = gScore.get(current)!;
      for (const [neighbour, cost] of current.links) {
        if (closedSet.includes(neighbour)) continue;

        const score = curScore + cost;
        if (!openSet.includes(neighbour)) {
          openSet.push(neighbour);
        } else if (score >= (gScore.get(neighbour) ?? Infinity)) {
          continue;
        }

        cameFrom.set(neighbour, current);
        gScore.set(neighbour, score);
      }
    }

    return null;
  }

  private buildPath(cameFrom: Map<Node, Node>, current: Node): Node[] {
    const path = [current];
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!;
      path.push(current);
    }
    return path;
  }
}
