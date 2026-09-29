import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { ScanIcon } from "lucide-react";
import {
  fitTransform,
  labelAlpha,
  nodeAt,
  type Point,
  toWorld,
  type ViewTransform,
  zoomAt,
} from "@/lib/vault/graph-view";

export interface GraphNodeInput {
  id: string;
  label: string;
  color: string;
  /** The note the graph is about, drawn larger and always labelled. */
  centre?: boolean;
  /** Steps away from the centre; farther rings are drawn fainter. */
  ring?: number;
}

export interface GraphLinkInput {
  source: string;
  target: string;
}

interface GNode extends SimulationNodeDatum {
  id: string;
  label: string;
  color: string;
  centre: boolean;
  ring: number;
  r: number;
  x: number;
  y: number;
}

type GLink = SimulationLinkDatum<GNode> & { source: GNode; target: GNode };

const DRAG_THRESHOLD = 3;
/** Above this many notes, labels wait until you zoom in. */
const CROWDED = 20;

function palette() {
  const dark = document.documentElement.classList.contains("dark");
  return dark
    ? { link: "148,163,184", text: "226,232,240" }
    : { link: "100,116,139", text: "30,41,59" };
}

/**
 * The vault's links as a living graph, the way Obsidian draws them: nodes
 * repel, links pull, and the whole thing settles and wiggles when disturbed.
 * Drag nodes, drag the background to pan, scroll or pinch to zoom, hover to
 * light up a note and its neighbours, click to open. Labels fade in as you
 * zoom, so a crowded network stays readable.
 */
export function VaultGraph({
  nodes: nodeInput,
  links: linkInput,
  height,
  highlight,
  onOpen,
}: {
  nodes: GraphNodeInput[];
  links: GraphLinkInput[];
  height: number;
  /** Ids to bring forward (e.g. search matches); others dim. */
  highlight?: Set<string> | null;
  onOpen: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const neighboursRef = useRef(new Map<string, Set<string>>());
  const viewRef = useRef<ViewTransform>({ k: 1, x: 0, y: 0 });
  const sizeRef = useRef({ w: 300, h: height });
  const hoverRef = useRef<string | null>(null);
  const highlightRef = useRef<Set<string> | null>(null);
  const fittedRef = useRef(false);
  /** Zoom that fitted the whole graph, for when labels show. */
  const fitKRef = useRef(1);
  const frameRef = useRef<number | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  highlightRef.current = highlight ?? null;
  const [cursor, setCursor] = useState("grab");

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = viewRef.current;
    const colors = palette();
    const hover = hoverRef.current;
    const lit = hover
      ? new Set([hover, ...(neighboursRef.current.get(hover) ?? [])])
      : highlightRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

    // Links first, beneath the nodes.
    for (const l of linksRef.current) {
      const on = lit ? lit.has(l.source.id) && lit.has(l.target.id) : true;
      const touchesHover =
        hover && (l.source.id === hover || l.target.id === hover);
      ctx.strokeStyle = `rgba(${colors.link},${touchesHover ? 0.9 : on ? 0.35 : 0.07})`;
      ctx.lineWidth = (touchesHover ? 1.6 : 1) / t.k;
      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    }

    const baseLabel = labelAlpha(
      t.k,
      fitKRef.current,
      nodesRef.current.length > CROWDED,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of nodesRef.current) {
      const on = lit ? lit.has(n.id) : true;
      const faint = n.ring >= 2 && !lit;
      ctx.globalAlpha = on ? (faint ? 0.6 : 1) : 0.15;
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (n.id === hover || n.centre) {
        ctx.strokeStyle = `rgba(${colors.text},0.7)`;
        ctx.lineWidth = 1.5 / t.k;
        ctx.stroke();
      }
      const alpha =
        n.id === hover || n.centre || lit?.has(n.id) ? 1 : lit ? 0 : baseLabel;
      if (alpha > 0.02) {
        ctx.globalAlpha = alpha * (on ? 1 : 0.3);
        ctx.fillStyle = `rgb(${colors.text})`;
        // On screen, text grows a little as you zoom in but never shrinks
        // below readable; the canvas is in world units, hence the / t.k.
        const screenPx = 11 * Math.min(Math.max(t.k, 0.9), 1.4);
        const weight = n.id === hover || n.centre ? "600 " : "";
        ctx.font = `${weight}${screenPx / t.k}px ui-sans-serif, system-ui, sans-serif`;
        const label =
          n.label.length > 32 ? `${n.label.slice(0, 31)}…` : n.label;
        ctx.fillText(label, n.x, n.y + n.r + 3 / t.k);
      }
    }
    ctx.globalAlpha = 1;
  }, []);

  const redraw = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(draw);
    }
  }, [draw]);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    viewRef.current = fitTransform(nodesRef.current, w, h, 30);
    fitKRef.current = viewRef.current.k;
    redraw();
  }, [redraw]);

  // Size the canvas to its box, sharp on retina screens.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const w = wrap.clientWidth || 300;
      const h = height;
      const dpr = window.devicePixelRatio || 1;
      const first = sizeRef.current.w === 300 && !fittedRef.current;
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (first) viewRef.current = { k: 1, x: w / 2, y: h / 2 };
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [height, redraw]);

  // (Re)build the simulation when the graph changes, keeping known positions.
  // The vault is reread every so often; if nothing about the graph changed,
  // only refresh labels and colours rather than shaking it up again.
  const shapeRef = useRef("");
  useEffect(() => {
    const shape = `${nodeInput.map((n) => n.id).join("\u0000")}\u0001${linkInput
      .map((l) => `${l.source}\u0002${l.target}`)
      .join("\u0000")}`;
    if (shape === shapeRef.current) {
      const input = new Map(nodeInput.map((n) => [n.id, n]));
      for (const n of nodesRef.current) {
        const next = input.get(n.id);
        if (next) {
          n.label = next.label;
          n.color = next.color;
        }
      }
      redraw();
      return;
    }
    const known = shapeRef.current !== "";
    shapeRef.current = shape;
    const old = new Map(nodesRef.current.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    for (const l of linkInput) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    const nodes: GNode[] = nodeInput.map((n, i) => {
      const prev = old.get(n.id);
      const angle = (i / Math.max(nodeInput.length, 1)) * Math.PI * 2;
      return {
        id: n.id,
        label: n.label,
        color: n.color,
        centre: Boolean(n.centre),
        ring: n.ring ?? 1,
        r:
          (n.centre ? 7 : 4) +
          Math.min(6, Math.sqrt(degree.get(n.id) ?? 0) * 1.3),
        x: prev?.x ?? (n.centre ? 0 : Math.cos(angle) * 60),
        y: prev?.y ?? (n.centre ? 0 : Math.sin(angle) * 60),
        vx: prev?.vx,
        vy: prev?.vy,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = linkInput
      .map((l) => ({ source: byId.get(l.source), target: byId.get(l.target) }))
      .filter((l): l is GLink => Boolean(l.source && l.target));
    const neighbours = new Map<string, Set<string>>();
    for (const l of links) {
      if (!neighbours.has(l.source.id)) neighbours.set(l.source.id, new Set());
      if (!neighbours.has(l.target.id)) neighbours.set(l.target.id, new Set());
      neighbours.get(l.source.id)?.add(l.target.id);
      neighbours.get(l.target.id)?.add(l.source.id);
    }
    nodesRef.current = nodes;
    linksRef.current = links;
    neighboursRef.current = neighbours;
    fittedRef.current = false;

    simRef.current?.stop();
    let ticks = 0;
    const sim = forceSimulation<GNode, GLink>(nodes)
      // Nodes already placed only need to make room for the new ones.
      .alpha(known ? 0.35 : 1)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((n) => n.id)
          .distance(50)
          .strength(0.4),
      )
      .force("charge", forceManyBody<GNode>().strength(-140).distanceMax(400))
      .force(
        "collide",
        forceCollide<GNode>().radius((n) => n.r + 4),
      )
      // Gentle pull to the middle keeps loose notes from drifting away.
      .force("x", forceX<GNode>(0).strength(0.04))
      .force("y", forceY<GNode>(0).strength(0.04))
      .on("tick", () => {
        ticks++;
        // Frame the graph once it has spread out, then leave the view alone.
        if (!fittedRef.current && (ticks > 60 || sim.alpha() < 0.2)) {
          fittedRef.current = true;
          fit();
        }
        redraw();
      });
    simRef.current = sim;
  }, [nodeInput, linkInput, fit, redraw]);

  useEffect(
    () => () => {
      simRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    redraw();
  }, [highlight, redraw]);

  // Pointer: drag a node, or pan the view; a press without moving is a click.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let press: {
      start: Point;
      last: Point;
      node: GNode | null;
      moved: boolean;
    } | null = null;

    const local = (e: PointerEvent | WheelEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = local(e);
      const node = nodeAt(nodesRef.current, viewRef.current, p);
      press = { start: p, last: p, node, moved: false };
      canvas.setPointerCapture(e.pointerId);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.3).restart();
      }
      setCursor("grabbing");
    };

    const move = (e: PointerEvent) => {
      const p = local(e);
      if (!press) {
        const node = nodeAt(nodesRef.current, viewRef.current, p);
        const id = node?.id ?? null;
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          setCursor(id ? "pointer" : "grab");
          redraw();
        }
        return;
      }
      if (
        Math.hypot(p.x - press.start.x, p.y - press.start.y) > DRAG_THRESHOLD
      ) {
        press.moved = true;
      }
      if (press.node) {
        const w = toWorld(viewRef.current, p);
        press.node.fx = w.x;
        press.node.fy = w.y;
      } else {
        const t = viewRef.current;
        viewRef.current = {
          ...t,
          x: t.x + p.x - press.last.x,
          y: t.y + p.y - press.last.y,
        };
        redraw();
      }
      press.last = p;
    };

    const up = (e: PointerEvent) => {
      if (!press) return;
      const { node, moved } = press;
      press = null;
      canvas.releasePointerCapture(e.pointerId);
      if (node) {
        node.fx = null;
        node.fy = null;
        simRef.current?.alphaTarget(0);
        if (!moved) onOpenRef.current(node.id);
      }
      setCursor(hoverRef.current ? "pointer" : "grab");
    };

    const leave = () => {
      if (!press && hoverRef.current) {
        hoverRef.current = null;
        redraw();
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // Pinch arrives as ctrl+wheel with small deltas; scale it up to match.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      viewRef.current = zoomAt(viewRef.current, local(e), factor);
      redraw();
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", fit);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", fit);
    };
  }, [fit, redraw]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-md border border-border bg-muted/20"
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        className="block touch-none"
        style={{ cursor }}
        role="img"
        aria-label="Map of linked notes. Drag to pan, scroll to zoom, click a note to open it."
      />
      <button
        type="button"
        onClick={fit}
        className="absolute right-1.5 bottom-1.5 flex size-6 items-center justify-center rounded bg-background/80 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        title="Fit to view (or double-click)"
        aria-label="Fit to view"
      >
        <ScanIcon className="size-3.5" />
      </button>
    </div>
  );
}
