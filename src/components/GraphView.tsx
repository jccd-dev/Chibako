"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
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
  source: string | SimulationNodeDatum;
  target: string | SimulationNodeDatum;
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

const ORPHAN_OPACITY = 0.15;
const HOVER_DIM = 0.25;

export function GraphView() {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const tRef = useRef(t);
  tRef.current = t;
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

  // Adjacency map: node id -> connected node ids (drives degree, orphan count, hover highlighting)
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      let s = m.get(a);
      if (!s) { s = new Set(); m.set(a, s); }
      s.add(b);
    };
    for (const l of links) {
      const s = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
      const t = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
      add(s, t);
      add(t, s);
    }
    return m;
  }, [links]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const [id, set] of neighbors) d.set(id, set.size);
    return d;
  }, [neighbors]);
  const orphanCount = useMemo(() => nodes.filter((n) => !(degree.get(n.id) ?? 0)).length, [nodes, degree]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // apply pan/zoom transform
  useEffect(() => {
    if (gRef.current) gRef.current.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  }, [t]);

  // Simulation: built ONLY when the data changes. Filters and hover never
  // rebuild it, so toggling "Orphans" or picking a folder dims the graph in
  // place instead of scattering every node with a fresh simulation pulse.
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

    // Orphan nodes have no link force, so every simulation pulse (e.g. a drag
    // re-heating alpha) pushes them further out and nothing pulls them back.
    // Once the layout settles, tether each node with a weak spring to its
    // settled spot: drags perturb the graph and it relaxes back instead of
    // accumulating drift.
    function settleHomes() {
      for (const n of nodes as any) {
        n.homeX = n.x;
        n.homeY = n.y;
      }
      if (!sim.force("homeX")) {
        sim
          .force("homeX", forceX<SimulationNodeDatum>((d: any) => d.homeX).strength(0.05))
          .force("homeY", forceY<SimulationNodeDatum>((d: any) => d.homeY).strength(0.05));
      }
    }
    sim.on("end", settleHomes);

    const root = select(svg).select("g.graph-root");
    const linkSel = root
      .append("g")
      .selectAll("line")
      .data(links as any)
      .join("line")
      .attr("class", "link");

    const nodeSel = root
      .append("g")
      .selectAll("circle")
      .data(nodes as any)
      .join("circle")
      .attr("class", "node")
      .attr("r", (d: any) => (d.kind === "index" ? 11 : d.kind === "wiki" ? 8 : 6))
      .attr("fill", (d: any) => KIND_COLOR[d.kind] ?? "var(--primary)")
      .attr("stroke", "var(--popover)")
      .attr("stroke-width", 2)
      .attr("cursor", "grab")
      .on("mousedown", (event: any, d: any) => {
        event.stopPropagation();
        event.preventDefault();
        dragNode = d;
        moved = false;
        sx = event.clientX;
        sy = event.clientY;
        document.body.style.cursor = "grabbing";
        sim.alphaTarget(0.3).restart();
      })
      .on("mouseover", (_e: any, d: any) => { if (!dragNode) setHovered(d); })
      .on("mouseout", () => { if (!dragNode) setHovered(null); });

    const labelSel = root
      .append("g")
      .selectAll("text")
      .data(nodes as any)
      .join("text")
      .attr("class", "label")
      .attr("text-anchor", "middle")
      .attr("dy", -14)
      .attr("font-size", 10)
      .attr("fill", "var(--muted-foreground)")
      .attr("pointer-events", "none")
      .text((d: any) => d.title);

    // Drag a node: pin it under the cursor (fx/fy) while the simulation keeps
    // running, so linked nodes trail with a springy follow. On release the pin
    // is lifted and the node springs back into the layout. A press that never
    // moved is treated as a click and opens the note.
    let dragNode: GraphNode | null = null;
    let moved = false;
    let sx = 0;
    let sy = 0;

    function toGraph(clientX: number, clientY: number) {
      const rect = svg.getBoundingClientRect();
      const { x, y, k } = tRef.current;
      return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
    }
    function onDragMove(e: MouseEvent) {
      if (!dragNode) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 3) moved = true;
      const p = toGraph(e.clientX, e.clientY);
      dragNode.fx = p.x;
      dragNode.fy = p.y;
    }
    function onDragEnd() {
      if (!dragNode) return;
      if (!moved) router.push(`/app/note/${dragNode.id}`);
      dragNode.fx = null;
      dragNode.fy = null;
      dragNode = null;
      document.body.style.cursor = "";
      sim.alphaTarget(0);
    }
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("mouseleave", onDragEnd);

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
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("mouseleave", onDragEnd);
      root.selectAll("*").remove();
    };
  }, [nodes, links, router]);

  // Visual state: orphan/folder filtering + hover neighborhood highlighting,
  // applied as style updates on the existing DOM (no simulation restarts).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const root = select(svg).select("g.graph-root");

    const baseOpacity = (d: GraphNode) => {
      let o = 1;
      if (orphansOnly && !(degree.get(d.id) ?? 0)) o = ORPHAN_OPACITY;
      if (folder && d.folder !== folder) o = Math.min(o, ORPHAN_OPACITY);
      return o;
    };
    const related = (id: string) => hovered && (id === hovered.id || neighbors.get(hovered.id)?.has(id));

    const nodeOpacity = (d: GraphNode) => {
      const base = baseOpacity(d);
      if (!hovered) return base;
      return related(d.id) ? Math.max(base, 0.95) : Math.min(base, HOVER_DIM);
    };

    root.selectAll<SVGCircleElement, GraphNode>("circle.node")
      .attr("opacity", nodeOpacity)
      .attr("stroke", (d) => (related(d.id) ? "var(--primary)" : "var(--popover)"));
    root.selectAll<SVGTextElement, GraphNode>("text.label")
      .attr("opacity", nodeOpacity)
      .attr("font-weight", (d) => (related(d.id) ? 600 : 400));

    root.selectAll<SVGLineElement, GraphLink>("line.link")
      .attr("stroke", (d) => {
        const s = typeof d.source === "object" ? (d.source as GraphNode).id : d.source;
        const t = typeof d.target === "object" ? (d.target as GraphNode).id : d.target;
        return hovered && (s === hovered.id || t === hovered.id) ? "var(--primary)" : "var(--border)";
      })
      .attr("stroke-opacity", (d) => {
        const s = typeof d.source === "object" ? (d.source as GraphNode).id : d.source;
        const t = typeof d.target === "object" ? (d.target as GraphNode).id : d.target;
        const so = nodesById.get(s);
        const to = nodesById.get(t);
        const base = Math.min(so ? baseOpacity(so) : ORPHAN_OPACITY, to ? baseOpacity(to) : ORPHAN_OPACITY);
        if (!hovered) return base;
        return s === hovered.id || t === hovered.id ? 1 : Math.min(base, 0.06);
      })
      .attr("stroke-width", (d) => {
        if (!hovered) return 1;
        const s = typeof d.source === "object" ? (d.source as GraphNode).id : d.source;
        const t = typeof d.target === "object" ? (d.target as GraphNode).id : d.target;
        return s === hovered.id || t === hovered.id ? 1.6 : 1;
      });
  }, [hovered, orphansOnly, folder, nodes, links, neighbors, degree, nodesById]);

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
      <svg ref={svgRef} className="h-full w-full cursor-grab select-none active:cursor-grabbing fade-in">
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
