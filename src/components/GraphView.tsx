"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import type { NoteSummary } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: string;
  folder: string;
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphData {
  nodes: NoteSummary[];
  links: GraphLink[];
}

const KIND_COLOR: Record<string, string> = {
  note: "var(--primary)",
  wiki: "var(--graph-wiki)",
  index: "var(--graph-index)",
};

export function GraphView() {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [folder, setFolder] = useState("");

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const nodes = useMemo<GraphNode[]>(
    () => (data?.nodes ?? []).map((n) => ({ id: n.id, title: n.title, kind: n.kind, folder: n.folder })),
    [data]
  );
  const links = useMemo(() => (data?.links ?? []).map((l) => ({ source: l.source, target: l.target })), [data]);
  const folders = useMemo(() => [...new Set(nodes.map((n) => n.folder).filter(Boolean))].sort(), [nodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const l of links) {
      d.set(l.source, (d.get(l.source) ?? 0) + 1);
      d.set(l.target, (d.get(l.target) ?? 0) + 1);
    }
    return d;
  }, [links]);
  const orphanCount = useMemo(() => nodes.filter((n) => !(degree.get(n.id) ?? 0)).length, [nodes, degree]);

  // apply pan/zoom transform
  useEffect(() => {
    if (gRef.current) gRef.current.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  }, [t]);

  useEffect(() => {
    if (!nodes.length || !svgRef.current || !wrapRef.current) return;
    const svg = svgRef.current;
    const width = wrapRef.current.clientWidth || 800;
    const height = wrapRef.current.clientHeight || 600;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const sim = forceSimulation(nodes as SimulationNodeDatum[])
      .force("link", forceLink(links as any).id((d: any) => d.id).distance(90).strength(0.5))
      .force("charge", forceManyBody().strength(-280))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(26));

    const root = select(svg).select("g.graph-root");
    const linkSel = root
      .append("g")
      .selectAll("line")
      .data(links as any)
      .join("line")
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 1);

    const dim = (d: any) => {
      const isOrphan = !(degree.get(d.id) ?? 0);
      if (orphansOnly && !isOrphan) return 0.15;
      if (folder && d.folder !== folder) return 0.15;
      return 1;
    };

    const nodeSel = root
      .append("g")
      .selectAll("circle")
      .data(nodes as any)
      .join("circle")
      .attr("r", (d: any) => (d.kind === "index" ? 11 : d.kind === "wiki" ? 8 : 6))
      .attr("fill", (d: any) => KIND_COLOR[d.kind] ?? "var(--primary)")
      .attr("stroke", "var(--popover)")
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .attr("opacity", dim)
      .on("click", (_e: any, d: any) => {
        router.push(`/app/note/${d.id}`);
      })
      .on("mouseover", (_e: any, d: any) => setHovered(d))
      .on("mouseout", () => setHovered(null));

    const labelSel = root
      .append("g")
      .selectAll("text")
      .data(nodes as any)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", -14)
      .attr("font-size", 10)
      .attr("fill", "var(--muted-foreground)")
      .attr("opacity", dim)
      .text((d: any) => d.title);

    sim.on("tick", () => {
      linkSel
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      nodeSel.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
      labelSel.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    return () => {
      sim.stop();
      root.selectAll("*").remove();
    };
  }, [nodes, links, router, orphansOnly, folder, degree]);

  // wheel zoom + background drag pan (nodes stay clickable)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setT((prev) => {
        const k = Math.min(2.5, Math.max(0.4, prev.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const s = k / prev.k;
        return { k, x: mx - (mx - prev.x) * s, y: my - (my - prev.y) * s };
      });
    }
    let dragging = false;
    let lx = 0;
    let ly = 0;
    function onDown(e: MouseEvent) {
      if ((e.target as Element).tagName === "circle") return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    }
    function onMove(e: MouseEvent) {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      setT((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    }
    function onUp() {
      dragging = false;
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <Select
          items={{ "": "All folders", ...Object.fromEntries(folders.map((f) => [f, f])) }}
          value={folder}
          onValueChange={(value) => {
            if (value !== null) setFolder(value);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Filter by folder"
            className="h-auto! rounded-lg border-border bg-popover px-2.5! py-1.5! text-xs text-muted-foreground shadow-none! hover:text-foreground dark:bg-popover dark:hover:bg-popover"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All folders</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          className={cn(
            "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
            orphansOnly
              ? "border-primary bg-primary/12 text-primary"
              : "border-border bg-popover text-muted-foreground"
          )}
          onClick={() => setOrphansOnly((v) => !v)}
          title="Highlight notes with no links"
          aria-pressed={orphansOnly}
        >
          Orphans ({orphanCount})
        </button>
        <button
          className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          onClick={() => setT({ x: 0, y: 0, k: 1 })}
          title="Reset zoom and pan"
        >
          Reset view
        </button>
      </div>
      {!nodes.length && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No notes yet — create a note to start the graph.
        </div>
      )}
      <svg ref={svgRef} className="h-full w-full cursor-grab active:cursor-grabbing">
        <g ref={gRef} className="graph-root" />
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs shadow-lg fade-in">
          <span className="font-medium">{hovered.title}</span>
          <span className="ml-2 capitalize text-muted-foreground">{hovered.kind}</span>
          {(degree.get(hovered.id) ?? 0) === 0 && <span className="ml-2 text-muted-foreground">· orphan</span>}
        </div>
      )}
    </div>
  );
}
