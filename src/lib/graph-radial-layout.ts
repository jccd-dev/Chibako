import {
  GALAXY_CAPACITY,
  GOLDEN_ANGLE,
  assembleLayout,
  hash01,
  partitionGalaxies,
  prepareGraph,
  type CircleLayout,
  type Compare,
  type GalaxyLayout,
  type GraphLayoutLink,
  type GraphLayoutNode,
} from "./graph-layout";

const TAU = 2 * Math.PI;
// Ring spacing inside a hub's burst, and the arc room each note needs on a ring.
const FIRST_RING = 17;
const RING_STEP = 16;
const NODE_GAP = 15;
const HUB_CORE = 14;
const BURST_PAD = 9;
const HUB_GAP = 12;
const ORPHAN_GAP = 26;
const MIN_HUB_DEGREE = 3;
const NOTES_PER_HUB = 7;

interface Burst {
  hub: string;
  /** Children ordered by priority; inner rings take the most connected. */
  children: string[];
  /** Disc radius that holds the hub and all of its children. */
  radius: number;
}

interface Slot {
  x: number;
  y: number;
  cluster: number;
}

/** Splits `count` notes over the fewest rings that hold them, in proportion to ring length. */
function ringPlan(count: number, firstRadius: number, step: number, gap: number): Array<{ r: number; count: number }> {
  const radii: number[] = [];
  let capacity = 0;
  for (let k = 0; capacity < count; k++) {
    radii.push(firstRadius + k * step);
    capacity += Math.max(4, Math.floor((TAU * radii[k]) / gap));
  }
  const total = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.floor((count * r) / total));
  // Rounding remainder goes to the outer rings, which have the most room.
  for (let k = radii.length - 1, left = count - counts.reduce((a, b) => a + b, 0); left > 0; left--) {
    counts[k]++;
    k = k === 0 ? radii.length - 1 : k - 1;
  }
  return radii.map((r, k) => ({ r, count: counts[k] })).filter((ring) => ring.count > 0);
}

function placeOnRings(
  ids: string[],
  plan: Array<{ r: number; count: number }>,
  center: { x: number; y: number },
  salt: string,
  cluster: number,
  out: Map<string, Slot>
) {
  let next = 0;
  plan.forEach((ring, k) => {
    const phase = hash01(salt, k + 11) * TAU;
    for (let i = 0; i < ring.count; i++) {
      const angle = phase + (TAU * i) / ring.count;
      out.set(ids[next++], { x: center.x + ring.r * Math.cos(angle), y: center.y + ring.r * Math.sin(angle), cluster });
    }
  });
}

function burstOf(hub: string, children: string[]): Burst {
  const plan = ringPlan(children.length, FIRST_RING, RING_STEP, NODE_GAP);
  const reach = plan.length ? plan[plan.length - 1].r : HUB_CORE;
  return { hub, children, radius: reach + BURST_PAD };
}

/**
 * Hubs claim notes layer by layer from their own links; a note linked to several
 * hubs joins the least-loaded one. Components without a hub promote their top note.
 */
function assignClusters(members: string[], hubs: string[], adj: Map<string, string[]>, compare: Compare): Map<string, string> {
  const inSet = new Set(members);
  const owner = new Map(hubs.map((h) => [h, h]));
  const load = new Map(hubs.map((h) => [h, 0]));
  const rank = new Map(hubs.map((h, i) => [h, i]));
  const connected = [...members].sort(compare).filter((id) => (adj.get(id) ?? []).some((n) => inSet.has(n)));

  let frontier = [...hubs];
  for (;;) {
    while (frontier.length) {
      const claims = new Map<string, Set<string>>();
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (!inSet.has(n) || owner.has(n)) continue;
          claims.set(n, (claims.get(n) ?? new Set()).add(owner.get(id) as string));
        }
      }
      const layer = [...claims.keys()].sort(compare);
      for (const n of layer) {
        const [pick] = [...(claims.get(n) as Set<string>)].sort(
          (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0)
        );
        owner.set(n, pick);
        load.set(pick, (load.get(pick) ?? 0) + 1);
      }
      frontier = layer;
    }
    const stray = connected.find((id) => !owner.has(id));
    if (!stray) return owner;
    owner.set(stray, stray);
    load.set(stray, 0);
    rank.set(stray, rank.size);
    frontier = [stray];
  }
}

/** Packs hub bursts onto concentric rings, biggest innermost, spread evenly by angle. */
function placeHubRings(bursts: Burst[], innerExtent: number): { centers: Map<string, { x: number; y: number }>; extent: number } {
  const centers = new Map<string, { x: number; y: number }>();
  let extent = innerExtent;
  for (let ring = 0, rest = bursts; rest.length; ring++) {
    const r = extent + rest[0].radius + HUB_GAP;
    // Angular width a burst needs on this ring; sized so unequal neighbours cannot overlap.
    const width = (b: Burst) => 2 * Math.asin(Math.min(1, (b.radius + HUB_GAP / 2) / r));
    let total = 0;
    let take = 0;
    while (take < rest.length && (take === 0 || total + width(rest[take]) <= TAU)) total += width(rest[take++]);

    const phase = ring * GOLDEN_ANGLE;
    const scale = TAU / total;
    let used = 0;
    for (const b of rest.slice(0, take)) {
      const angle = phase + (used + width(b) / 2) * scale;
      used += width(b);
      centers.set(b.hub, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
      extent = Math.max(extent, r + b.radius);
    }
    rest = rest.slice(take);
  }
  return { centers, extent };
}

function layoutRadial(members: string[], adj: Map<string, string[]>, compare: Compare): CircleLayout {
  const inSet = new Set(members);
  const localDegree = (id: string) => (adj.get(id) ?? []).filter((n) => inSet.has(n)).length;
  const sorted = [...members].sort(compare);
  const core = sorted[0];

  const candidates = sorted.slice(1).filter((id) => localDegree(id) >= MIN_HUB_DEGREE);
  const hubCount = Math.min(candidates.length, Math.ceil(members.length / NOTES_PER_HUB));
  const owner = assignClusters(members, [core, ...candidates.slice(0, hubCount)], adj, compare);

  const childrenOf = new Map<string, string[]>();
  for (const id of sorted) {
    const o = owner.get(id);
    if (o === undefined || o === id) continue;
    childrenOf.set(o, [...(childrenOf.get(o) ?? []), id]);
  }
  const hubIds = [...new Set(owner.values())].filter((id) => id !== core);
  const rankOf = new Map(sorted.map((id, i) => [id, i]));
  const bursts = hubIds
    .map((hub) => burstOf(hub, childrenOf.get(hub) ?? []))
    .sort((a, b) => b.radius - a.radius || (rankOf.get(a.hub) ?? 0) - (rankOf.get(b.hub) ?? 0));

  const slots = new Map<string, Slot>([[core, { x: 0, y: 0, cluster: 0 }]]);
  const origin = { x: 0, y: 0 };
  const centerBurst = burstOf(core, childrenOf.get(core) ?? []);
  placeOnRings(centerBurst.children, ringPlan(centerBurst.children.length, FIRST_RING, RING_STEP, NODE_GAP), origin, core, 0, slots);

  const { centers, extent: hubExtent } = placeHubRings(bursts, centerBurst.radius);
  bursts.forEach((b, i) => {
    const at = centers.get(b.hub) as { x: number; y: number };
    slots.set(b.hub, { ...at, cluster: i + 1 });
    placeOnRings(b.children, ringPlan(b.children.length, FIRST_RING, RING_STEP, NODE_GAP), at, b.hub, i + 1, slots);
  });

  const orphans = sorted.filter((id) => !slots.has(id));
  let extent = Math.max(hubExtent, centerBurst.radius);
  if (orphans.length) {
    const plan = ringPlan(orphans.length, extent + ORPHAN_GAP, NODE_GAP, NODE_GAP);
    placeOnRings(orphans, plan, origin, core + "#orphans", -1, slots);
    extent = plan[plan.length - 1].r;
  }
  extent += BURST_PAD;

  const positions: CircleLayout["positions"] = new Map();
  for (const [id, s] of slots) positions.set(id, { x: s.x, y: s.y, cluster: s.cluster, radius01: Math.min(1, Math.hypot(s.x, s.y) / extent) });
  return { core, extent, positions };
}

/**
 * Deterministic hub-and-spoke layout: the top note at the center, major hubs on
 * concentric rings, each hub's notes in a small ring burst around it, orphans on
 * the outer ring. Overflow starts another circle beside the first.
 */
export function radialLayout(
  nodes: GraphLayoutNode[],
  links: GraphLayoutLink[],
  opts: { capacity?: number } = {}
): GalaxyLayout {
  const capacity = Math.max(1, Math.floor(opts.capacity ?? GALAXY_CAPACITY));
  const { adj, degree, compare } = prepareGraph(nodes, links);
  const groups = partitionGalaxies(nodes.map((n) => n.id), adj, compare, capacity);
  return assembleLayout(groups.map((members) => layoutRadial(members, adj, compare)), degree);
}
