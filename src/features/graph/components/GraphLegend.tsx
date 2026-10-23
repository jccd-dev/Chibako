import { CLUSTER_COLORS, type GraphPattern } from "@/features/graph/galaxy-style";

export function GraphLegend({ pattern }: { pattern: GraphPattern }) {
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground">
      {pattern === "galaxy" ? (
        <>
          <span>core</span>
          <span
            className="h-2 w-24 rounded-full"
            style={{ background: "linear-gradient(to right, var(--galaxy-0), var(--galaxy-1), var(--galaxy-2), var(--galaxy-3), var(--galaxy-4))" }}
          />
          <span>rim</span>
        </>
      ) : (
        <>
          <span>hub clusters</span>
          {Array.from({ length: CLUSTER_COLORS }, (_, i) => (
            <span key={i} className="h-2 w-2 rounded-full" style={{ background: `var(--graph-cluster-${i})` }} />
          ))}
        </>
      )}
    </div>
  );
}
