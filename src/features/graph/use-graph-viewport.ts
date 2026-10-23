"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const FIT_PADDING = 48;
const MAX_FIT_ZOOM = 1.6;

/**
 * Pan/zoom for the graph SVG: wheel zoom, background drag pan, and fit-to-bounds.
 * Applies the transform to `groupRef` and exposes the live value for drag math.
 */
export function useGraphViewport(
  svgRef: RefObject<SVGSVGElement | null>,
  groupRef: RefObject<SVGGElement | null>,
  size: { width: number; height: number },
  bounds: GraphBounds | null
) {
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const transformRef = useRef(t);
  const sizeRef = useRef(size);

  useEffect(() => {
    transformRef.current = t;
    const g = groupRef.current;
    if (!g) return;
    g.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
    g.style.setProperty("--graph-k", String(t.k));
  }, [t, groupRef]);

  const fit = useCallback((b: GraphBounds) => {
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const k = Math.min(
      MAX_FIT_ZOOM,
      Math.max(MIN_ZOOM, Math.min((width - FIT_PADDING * 2) / bw, (height - FIT_PADDING * 2) / bh))
    );
    setT({ k, x: width / 2 - ((b.minX + b.maxX) / 2) * k, y: height / 2 - ((b.minY + b.maxY) / 2) * k });
  }, []);

  // Refit when the layout changes or the container first gets a real size; a
  // later resize keeps the user's pan and zoom.
  const sized = size.width > 0 && size.height > 0;
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    if (sized && bounds) fit(bounds);
  }, [bounds, sized, fit]);

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
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
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
  }, [svgRef]);

  return { transformRef, fit };
}
