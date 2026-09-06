import { requireAuth } from "@/lib/auth";
import { GraphView } from "@/components/GraphView";

export default async function GraphPage() {
  await requireAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Graph view</h1>
          <p className="text-xs text-muted-foreground">Every note is a node; every [[wikilink]] is an edge. Click a node to open it.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> note</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> wiki</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> index</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <GraphView />
      </div>
    </div>
  );
}