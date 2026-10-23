import { requireAuth } from "@/lib/auth";
import { GraphView } from "@/features/graph/components/GraphView";

export default async function GraphPage() {
  await requireAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Graph view</h1>
          <p className="text-xs text-muted-foreground">Every note is a node; every [[wikilink]] is an edge. Click a node to open it.</p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <GraphView />
      </div>
    </div>
  );
}