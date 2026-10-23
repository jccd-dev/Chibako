import type { GalaxyPlacement } from "@/lib/graph-layout";

export type GraphPattern = "galaxy" | "radial";

export const CLUSTER_COLORS = 6;

const RAMP_STOPS = 5;

/** Core-to-rim color along the theme's --galaxy-0..4 stops. */
export function rampColor(radius01: number): string {
  const pos = Math.min(1, Math.max(0, radius01)) * (RAMP_STOPS - 1);
  const i = Math.min(RAMP_STOPS - 2, Math.floor(pos));
  const mix = Math.round((pos - i) * 100);
  if (mix === 0) return `var(--galaxy-${i})`;
  return `color-mix(in oklab, var(--galaxy-${i + 1}) ${mix}%, var(--galaxy-${i}))`;
}

export function nodeRadius(kind: string, degree: number): number {
  if (kind === "index") return 10 + Math.min(3, degree * 0.15);
  return 3.5 + Math.min(4.5, Math.sqrt(degree) * 1.1);
}

/** Radial pattern: each hub burst gets a palette color; the center cluster and orphans stay neutral. */
function clusterColor(cluster: number): string {
  if (cluster < 0) return "var(--graph-cluster-orphan)";
  if (cluster === 0) return "var(--graph-cluster-center)";
  return `var(--graph-cluster-${(cluster - 1) % CLUSTER_COLORS})`;
}

export function placementColor(pattern: GraphPattern, p: GalaxyPlacement | undefined): string {
  if (!p) return "var(--graph-cluster-orphan)";
  return pattern === "radial" ? clusterColor(p.cluster ?? -1) : rampColor(p.radius01);
}

/** Notes only link visibly within their own galaxy (or radial cluster); the rest fades back. */
export function sameGroup(pattern: GraphPattern, a: GalaxyPlacement | undefined, b: GalaxyPlacement | undefined): boolean {
  if (!a || !b || a.galaxy !== b.galaxy) return false;
  return pattern === "galaxy" || a.cluster === b.cluster;
}
