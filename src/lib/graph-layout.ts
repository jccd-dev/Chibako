export interface GraphLayoutNode {
  id: string;
  kind: string;
}

export interface GraphLayoutLink {
  source: string;
  target: string;
}

export interface GalaxyPlacement {
  x: number;
  y: number;
  galaxy: number;
  /** 0 at the galaxy core, 1 at the rim. */
  radius01: number;
  /** Radial pattern only: 0 is the center cluster, 1+ are hub clusters, -1 is an orphan. */
  cluster?: number;
}

export interface Galaxy {
  index: number;
  x: number;
  y: number;
  /** Every placed node of this galaxy lies within this distance of (x, y). */
  radius: number;
  count: number;
  core: string;
}

export interface GalaxyLayout {
  placements: Map<string, GalaxyPlacement>;
  galaxies: Galaxy[];
  degree: Map<string, number>;
}

/**
 * Nodes per galaxy. At ~200 a galaxy is ~650px across (about 45px per node),
 * which keeps 6-10px nodes legible and still fits a laptop viewport at fit zoom.
 */
export const GALAXY_CAPACITY = 200;

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CIRCLE_GAP = 60;
const CORE_R01 = 0.06;
const SPIRAL_TIGHTNESS = 2.8;

export type Compare = (a: string, b: string) => number;

/** One laid-out circle (galaxy or radial) centered at its own origin. */
export interface CircleLayout {
  core: string;
  /** Every placed node lies within this distance of the origin. */
  extent: number;
  positions: Map<string, Omit<GalaxyPlacement, "galaxy">>;
}

interface Component {
  /** BFS order from the highest-priority node. */
  order: string[];
  depth: Map<string, number>;
  /** Subtree root under the component root; the root itself is -1. */
  branch: Map<string, number>;
}

interface Unit {
  ids: string[];
  orphan: boolean;
  /** Added to graph depth so secondary components start outside the core. */
  levelBase: number;
}

export function hash01(id: string, salt: number): number {
  let h = Math.imul(2166136261 ^ salt, 16777619);
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Triangular jitter in [-1, 1], denser near zero so arms read as a ridge. */
function jitter(id: string, salt: number): number {
  return hash01(id, salt) + hash01(id, salt + 1) - 1;
}

function galaxyRadius(count: number): number {
  return 40 + 20 * Math.sqrt(count);
}

export function buildAdjacency(nodes: GraphLayoutNode[], links: GraphLayoutLink[]): Map<string, string[]> {
  const sets = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const l of links) {
    if (l.source === l.target) continue;
    const a = sets.get(l.source);
    const b = sets.get(l.target);
    if (!a || !b) continue;
    a.add(l.target);
    b.add(l.source);
  }
  return new Map([...sets].map(([id, s]) => [id, [...s]]));
}

export function connectedComponents(members: string[], adj: Map<string, string[]>, compare: Compare): Component[] {
  const inSet = new Set(members);
  const seen = new Set<string>();
  const out: Component[] = [];
  for (const root of [...members].sort(compare)) {
    if (seen.has(root)) continue;
    seen.add(root);
    const order = [root];
    const depth = new Map([[root, 0]]);
    const branch = new Map([[root, -1]]);
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const next = (adj.get(id) ?? []).filter((n) => inSet.has(n) && !seen.has(n)).sort(compare);
      for (const n of next) {
        seen.add(n);
        order.push(n);
        depth.set(n, (depth.get(id) ?? 0) + 1);
        branch.set(n, i === 0 ? order.length - 1 : (branch.get(id) ?? -1));
      }
    }
    out.push({ order, depth, branch });
  }
  return out.sort((a, b) => b.order.length - a.order.length || compare(a.order[0], b.order[0]));
}

/** First-fit-decreasing: whole components stay together; oversized ones split in BFS order. */
export function partitionGalaxies(ids: string[], adj: Map<string, string[]>, compare: Compare, capacity: number): string[][] {
  const pieces: string[][] = [];
  for (const c of connectedComponents(ids, adj, compare)) {
    for (let i = 0; i < c.order.length; i += capacity) pieces.push(c.order.slice(i, i + capacity));
  }
  pieces.sort((a, b) => b.length - a.length);
  const bins: string[][] = [];
  for (const piece of pieces) {
    const bin = bins.find((b) => b.length + piece.length <= capacity);
    if (bin) bin.push(...piece);
    else bins.push([...piece]);
  }
  return bins.sort((a, b) => b.length - a.length);
}

/** Groups a galaxy's non-core nodes into units that travel along one arm together. */
function buildUnits(members: string[], core: string, adj: Map<string, string[]>, compare: Compare, armCount: number): Unit[] {
  const fair = Math.max(1, Math.ceil((members.length - 1) / armCount));
  const connected: Unit[] = [];
  const orphans: Unit[] = [];
  for (const c of connectedComponents(members, adj, compare)) {
    const isCore = c.order[0] === core;
    if (c.order.length === 1) {
      if (!isCore) orphans.push({ ids: c.order, orphan: true, levelBase: 1 });
      continue;
    }
    const groups = new Map<number, string[]>();
    for (const id of c.order) {
      if (isCore && id === core) continue;
      // The root of a secondary component rides with its first branch.
      const key = c.branch.get(id) === -1 ? (c.branch.get(c.order[1]) ?? -1) : (c.branch.get(id) ?? -1);
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    for (const ids of groups.values()) {
      for (let i = 0; i < ids.length; i += fair) {
        connected.push({ ids: ids.slice(i, i + fair), orphan: false, levelBase: isCore ? 0 : 1 });
      }
    }
  }
  connected.sort((a, b) => b.ids.length - a.ids.length);
  return [...connected, ...orphans];
}

function layoutGalaxy(members: string[], adj: Map<string, string[]>, compare: Compare) {
  const core = [...members].sort(compare)[0];
  const radius = galaxyRadius(members.length);
  const positions = new Map<string, { x: number; y: number; radius01: number }>([
    [core, { x: 0, y: 0, radius01: 0 }],
  ]);
  const rest = members.length - 1;
  if (rest === 0) return { core, radius, positions };

  const armCount = Math.min(4, Math.max(2, Math.ceil(rest / 20)));
  const depthOf = new Map<string, number>();
  for (const c of connectedComponents(members, adj, compare)) {
    for (const [id, d] of c.depth) depthOf.set(id, d);
  }

  const arms: Array<Array<{ id: string; orphan: boolean; level: number; seq: number }>> = Array.from(
    { length: armCount },
    () => []
  );
  const load = new Array<number>(armCount).fill(0);
  let seq = 0;
  for (const unit of buildUnits(members, core, adj, compare, armCount)) {
    // Greedy balance: least-loaded arm, lowest index on ties.
    let arm = 0;
    for (let a = 1; a < armCount; a++) if (load[a] < load[arm]) arm = a;
    load[arm] += unit.ids.length;
    for (const id of unit.ids) {
      arms[arm].push({ id, orphan: unit.orphan, level: (depthOf.get(id) ?? 0) + unit.levelBase, seq: seq++ });
    }
  }

  arms.forEach((arm, armIndex) => {
    arm.sort((a, b) => Number(a.orphan) - Number(b.orphan) || a.level - b.level || a.seq - b.seq);
    arm.forEach((item, rank) => {
      const u = (rank + 0.5) / arm.length;
      // Exponent > 0.5 packs more nodes toward the center, giving the core bulge.
      const base = CORE_R01 + (1 - CORE_R01) * Math.pow(u, 0.6);
      const r01 = Math.min(1, Math.max(0.03, base + jitter(item.id, 1) * (item.orphan ? 0.06 : 0.012)));
      const theta =
        (2 * Math.PI * armIndex) / armCount +
        SPIRAL_TIGHTNESS * Math.log(Math.max(r01, CORE_R01) / CORE_R01) +
        jitter(item.id, 3) * (item.orphan ? 0.9 : 0.12);
      positions.set(item.id, { x: radius * r01 * Math.cos(theta), y: radius * r01 * Math.sin(theta), radius01: r01 });
    });
  });

  return { core, radius, positions };
}

/** Adjacency, degree, and the shared priority order: index notes, then most connected, then id. */
export function prepareGraph(nodes: GraphLayoutNode[], links: GraphLayoutLink[]) {
  const adj = buildAdjacency(nodes, links);
  const degree = new Map([...adj].map(([id, list]) => [id, list.length]));
  const isIndex = new Map(nodes.map((n) => [n.id, n.kind === "index"]));
  const compare: Compare = (a, b) =>
    Number(isIndex.get(b)) - Number(isIndex.get(a)) ||
    (degree.get(b) ?? 0) - (degree.get(a) ?? 0) ||
    (a < b ? -1 : a > b ? 1 : 0);
  return { adj, degree, compare };
}

/** Places the largest circle at the origin and each overflow circle beside it without overlap. */
export function assembleLayout(circles: CircleLayout[], degree: Map<string, number>): GalaxyLayout {
  const extent = circles.map((c) => c.extent);
  const centers: Array<{ x: number; y: number }> = [];
  circles.forEach((_, j) => {
    for (let k = 0; ; k++) {
      const angle = k * GOLDEN_ANGLE;
      const dist = j === 0 ? 0 : extent[0] + extent[j] + CIRCLE_GAP + k * 24;
      const c = { x: dist * Math.cos(angle), y: dist * Math.sin(angle) };
      if (centers.every((o, i) => Math.hypot(c.x - o.x, c.y - o.y) >= extent[i] + extent[j] + CIRCLE_GAP)) {
        centers.push(c);
        return;
      }
    }
  });

  const placements = new Map<string, GalaxyPlacement>();
  const galaxies: Galaxy[] = circles.map((g, index) => {
    for (const [id, p] of g.positions) {
      placements.set(id, { ...p, x: centers[index].x + p.x, y: centers[index].y + p.y, galaxy: index });
    }
    return { index, x: centers[index].x, y: centers[index].y, radius: extent[index], count: g.positions.size, core: g.core };
  });

  return { placements, galaxies, degree };
}

/**
 * Deterministic spiral-galaxy layout. Connected notes share a galaxy and an arm
 * where they fit; orphans form the outer halo; overflow starts another galaxy.
 */
export function galaxyLayout(
  nodes: GraphLayoutNode[],
  links: GraphLayoutLink[],
  opts: { capacity?: number } = {}
): GalaxyLayout {
  const capacity = Math.max(1, Math.floor(opts.capacity ?? GALAXY_CAPACITY));
  const { adj, degree, compare } = prepareGraph(nodes, links);
  const groups = partitionGalaxies(nodes.map((n) => n.id), adj, compare, capacity);
  const circles = groups.map((members) => {
    const g = layoutGalaxy(members, adj, compare);
    return { core: g.core, extent: g.radius * 1.12 + 12, positions: g.positions };
  });
  return assembleLayout(circles, degree);
}
