"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type ForceLink,
  type ForceX,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import type { NoteSummary } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { galaxyLayout, type GalaxyLayout } from "@/lib/graph-layout";
import { radialLayout } from "@/lib/graph-radial-layout";
import { nodeRadius, placementColor, sameGroup, type GraphPattern } from "@/features/graph/galaxy-style";
import { useGraphPattern } from "@/features/graph/use-graph-pattern";
import { GraphLegend } from "@/features/graph/components/GraphLegend";
import { GraphPatternSwitch } from "@/features/graph/components/GraphPatternSwitch";
import { useGraphViewport, type GraphBounds } from "@/features/graph/use-graph-viewport";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: string;
  folder: string;
}

type GraphLink = Omit<SimulationLinkDatum<GraphNode>, "source" | "target"> & {
  source: string | GraphNode;
  target: string | GraphNode;
};

interface GraphData {
  nodes: NoteSummary[];
  links: GraphLink[];
}

const ORPHAN_OPACITY = 0.15;
const HOVER_DIM = 0.25;
const LINK_OPACITY = 0.32;
// Links between galaxies (or radial clusters) would otherwise drown the pattern.
const CROSS_GROUP_OPACITY = 0.3;
// Pull toward each note's layout slot; links are weak so the pattern holds. Radial
// clusters need a firmer pull because their many cross-cluster links tug on hubs.
const SLOT_STRENGTH: Record<GraphPattern, number> = { galaxy: 0.3, radial: 0.6 };
// Divided by the larger endpoint degree so a hub's links together stay weaker than its slot pull.
const LINK_STRENGTH: Record<GraphPattern, number> = { galaxy: 0.08, radial: 0.04 };

function endpoints(link: GraphLink): [string, string] {
  return [typeof link.source === "object" ? link.source.id : link.source, typeof link.target === "object" ? link.target.id : link.target];
}

// Snap notes back to their layout slots and clear motion/pins (d3 mutates its node objects).
function seedSlots(nodes: GraphNode[], placements: GalaxyLayout["placements"]) {
  for (const node of nodes) {
    const slot = placements.get(node.id);
    node.x = slot?.x ?? 0;
    node.y = slot?.y ?? 0;
    node.vx = 0;
    node.vy = 0;
    node.fx = null;
    node.fy = null;
  }
}

export function GraphView() {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [folder, setFolder] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pattern, setPattern] = useGraphPattern();

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

  // Target slots for both patterns, computed from the id-only links before d3 rewrites them.
  const layouts = useMemo(() => {
    const plain = links.map((l) => ({ source: String(l.source), target: String(l.target) }));
    return { galaxy: galaxyLayout(nodes, plain), radial: radialLayout(nodes, plain) };
  }, [nodes, links]);
  const layout = layouts[pattern];
  const degree = layout.degree;
  const bounds = useMemo<GraphBounds | null>(() => {
    if (!layout.galaxies.length) return null;
    return {
      minX: Math.min(...layout.galaxies.map((g) => g.x - g.radius)),
      maxX: Math.max(...layout.galaxies.map((g) => g.x + g.radius)),
      minY: Math.min(...layout.galaxies.map((g) => g.y - g.radius)),
      maxY: Math.max(...layout.galaxies.map((g) => g.y + g.radius)),
    };
  }, [layout]);

  // Adjacency map: node id -> connected node ids (drives hover highlighting)
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      let s = m.get(a);
      if (!s) { s = new Set(); m.set(a, s); }
      s.add(b);
    };
    for (const l of links) {
      const [s, t] = endpoints(l);
      add(s, t);
      add(t, s);
    }
    return m;
  }, [links]);
  const orphanCount = useMemo(() => nodes.filter((n) => !(degree.get(n.id) ?? 0)).length, [nodes, degree]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const { transformRef, fit } = useGraphViewport(svgRef, gRef, size, bounds);

  // The simulation reads slots through this ref, so a pattern switch retargets it in place.
  const layoutRef = useRef(layout);
  const patternRef = useRef(pattern);
  const appliedLayoutRef = useRef<GalaxyLayout | null>(null);
  useEffect(() => {
    layoutRef.current = layout;
    patternRef.current = pattern;
  }, [layout, pattern]);

  // Filters and hover never rebuild the simulation, so they dim the graph in
  // place instead of scattering every node with a fresh simulation pulse.
  useEffect(() => {
    if (!nodes.length || !svgRef.current) return;
    const svg = svgRef.current;
    const radiusFor = (node: GraphNode) => nodeRadius(node.kind, degree.get(node.id) ?? 0);

    // Start every note in its slot so loading never explodes the layout.
    appliedLayoutRef.current = layoutRef.current;
    seedSlots(nodes, layoutRef.current.placements);
    const slotX = (node: GraphNode) => layoutRef.current.placements.get(node.id)?.x ?? 0;
    const slotY = (node: GraphNode) => layoutRef.current.placements.get(node.id)?.y ?? 0;

    const sim = forceSimulation(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).id((node) => node.id).distance(30).strength((link) => {
        const [s, t] = endpoints(link);
        return LINK_STRENGTH[patternRef.current] / Math.max(1, degree.get(s) ?? 1, degree.get(t) ?? 1);
      }))
      .force("collide", forceCollide<GraphNode>((node) => radiusFor(node) + 2.5))
      .force("slotX", forceX<GraphNode>(slotX).strength(SLOT_STRENGTH[patternRef.current]))
      .force("slotY", forceY<GraphNode>(slotY).strength(SLOT_STRENGTH[patternRef.current]))
      .alpha(0.25);
    simulationRef.current = sim;

    const root = select(svg).select<SVGGElement>("g.graph-root");
    const linkSel = root
      .append("g")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("class", "link");

    const nodeSel = root
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("class", "node")
      .attr("r", radiusFor)
      .attr("cursor", "grab")
      .on("mousedown", (event, d) => {
        event.stopPropagation();
        event.preventDefault();
        dragNode = d;
        moved = false;
        sx = event.clientX;
        sy = event.clientY;
        document.body.style.cursor = "grabbing";
        sim.alphaTarget(0.3).restart();
      })
      .on("mouseover", (_event, d) => { if (!dragNode) setHovered(d); })
      .on("mouseout", () => { if (!dragNode) setHovered(null); });

    // Labels stay hidden until the visual-state effect reveals index notes or a hover neighborhood.
    const labelSel = root
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes)
      .join("text")
      .attr("class", "label")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(radiusFor(d) + 5))
      .attr("pointer-events", "none")
      .text((d) => d.title);

    // Drag a node: pin it under the cursor (fx/fy) while the simulation keeps
    // running, so linked nodes trail with a springy follow. On release the pin
    // is lifted and the node springs back into its slot. A press that never
    // moved is treated as a click and opens the note.
    let dragNode: GraphNode | null = null;
    let moved = false;
    let sx = 0;
    let sy = 0;

    function toGraph(clientX: number, clientY: number) {
      const rect = svg.getBoundingClientRect();
      const { x, y, k } = transformRef.current;
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
        .attr("x1", (link) => (typeof link.source === "string" ? nodesById.get(link.source)?.x : link.source.x) ?? 0)
        .attr("y1", (link) => (typeof link.source === "string" ? nodesById.get(link.source)?.y : link.source.y) ?? 0)
        .attr("x2", (link) => (typeof link.target === "string" ? nodesById.get(link.target)?.x : link.target.x) ?? 0)
        .attr("y2", (link) => (typeof link.target === "string" ? nodesById.get(link.target)?.y : link.target.y) ?? 0);
      nodeSel.attr("cx", (node) => node.x ?? 0).attr("cy", (node) => node.y ?? 0);
      labelSel.attr("x", (node) => node.x ?? 0).attr("y", (node) => node.y ?? 0);
    });

    return () => {
      sim.stop();
      if (simulationRef.current === sim) simulationRef.current = null;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("mouseleave", onDragEnd);
      root.selectAll("*").remove();
    };
  }, [nodes, links, degree, nodesById, router, transformRef]);

  // Switching pattern retargets the running simulation so notes glide to their new slots.
  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim || appliedLayoutRef.current === layout) return;
    appliedLayoutRef.current = layout;
    // d3 caches accessor results at initialize(); re-setting each accessor refreshes them.
    for (const name of ["slotX", "slotY"]) {
      const force = sim.force(name) as ForceX<GraphNode> | undefined;
      force?.x(force.x()).strength(SLOT_STRENGTH[pattern]);
    }
    const link = sim.force("link") as ForceLink<GraphNode, GraphLink> | undefined;
    link?.strength(link.strength());
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) seedSlots(nodes, layout.placements);
    sim.alpha(0.8).restart();
  }, [layout, nodes, pattern]);

  function resetView() {
    seedSlots(nodes, layout.placements);
    simulationRef.current?.alpha(0.3).restart();
    if (bounds) fit(bounds);
  }

  // Visual state: orphan/folder filtering + hover neighborhood highlighting,
  // applied as style updates on the existing DOM (no simulation restarts).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const root = select(svg).select<SVGGElement>("g.graph-root");

    const baseOpacity = (d: GraphNode) => {
      let o = 1;
      if (orphansOnly && !(degree.get(d.id) ?? 0)) o = ORPHAN_OPACITY;
      if (folder && d.folder !== folder) o = Math.min(o, ORPHAN_OPACITY);
      return o;
    };
    const related = (id: string) => hovered && (id === hovered.id || neighbors.get(hovered.id)?.has(id));
    const touchesHovered = (d: GraphLink) => {
      const [s, t] = endpoints(d);
      return !!hovered && (s === hovered.id || t === hovered.id);
    };

    const nodeOpacity = (d: GraphNode) => {
      const base = baseOpacity(d);
      if (!hovered) return base;
      return related(d.id) ? Math.max(base, 0.95) : Math.min(base, HOVER_DIM);
    };
    // Labels: index notes always, everyone else only inside the hovered neighborhood.
    const labelOpacity = (d: GraphNode) => {
      if (hovered) return related(d.id) ? nodeOpacity(d) : 0;
      return d.kind === "index" ? baseOpacity(d) : 0;
    };

    root.selectAll<SVGCircleElement, GraphNode>("circle.node")
      .attr("fill", (d) => placementColor(pattern, layout.placements.get(d.id)))
      .attr("opacity", nodeOpacity);
    root.selectAll<SVGTextElement, GraphNode>("text.label")
      .attr("opacity", labelOpacity)
      .attr("font-weight", (d) => (related(d.id) ? 600 : 400));

    root.selectAll<SVGLineElement, GraphLink>("line.link")
      .attr("stroke", (d) => placementColor(pattern, layout.placements.get(endpoints(d)[0])))
      .attr("stroke-opacity", (d) => {
        const [s, t] = endpoints(d);
        const so = nodesById.get(s);
        const to = nodesById.get(t);
        const inGroup = sameGroup(pattern, layout.placements.get(s), layout.placements.get(t));
        const base =
          Math.min(so ? baseOpacity(so) : ORPHAN_OPACITY, to ? baseOpacity(to) : ORPHAN_OPACITY) *
          LINK_OPACITY *
          (inGroup ? 1 : CROSS_GROUP_OPACITY);
        if (!hovered) return base;
        return touchesHovered(d) ? 0.95 : Math.min(base, 0.05);
      })
      .attr("stroke-width", (d) => (touchesHovered(d) ? 0.9 : 0.5));
  }, [hovered, orphansOnly, folder, nodes, links, neighbors, degree, nodesById, layout, pattern]);

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
        <GraphPatternSwitch value={pattern} onChange={setPattern} />
        <button
          className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          onClick={resetView}
          title="Reset zoom, pan, and layout"
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
        <g ref={gRef}>
          <g className="graph-root" />
        </g>
      </svg>
      {nodes.length > 0 && <GraphLegend pattern={pattern} />}
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
