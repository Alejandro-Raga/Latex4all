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
  type Force,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { ImageDownIcon, ScanIcon } from "lucide-react";
import { APP_THEMES } from "@/lib/app-themes";
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

/**
 * The forces that shape the map.
 *
 * Radial: the centre note pinned in the middle, each step out on a ring
 * around it (sized to hold its notes with room for their labels), and a
 * note's own links pulling its neighbours to its side of the next ring, so
 * the map reads as a tree.
 *
 * Force: notes repel (more gently the more there are), links pull (longer
 * around hubs, so they don't bunch up), every note keeps clear of the
 * others, and unlinked notes gather at the edge instead of crowding in.
 */
function graphLayout(
  layout: "radial" | "force",
  nodes: GNode[],
  links: GLink[],
  degree: Map<string, number>,
): [string, Force<GNode, GLink>][] {
  const deg = (n: GNode) => degree.get(n.id) ?? 0;
  if (layout === "radial") {
    const perRing = new Map<number, number>();
    for (const n of nodes) {
      if (n.centre) {
        n.fx = 0;
        n.fy = 0;
      } else {
        perRing.set(n.ring, (perRing.get(n.ring) ?? 0) + 1);
      }
    }
    // Each ring holds its notes ~34px apart, and sits past the one inside.
    const radius = new Map<number, number>();
    let inner = 0;
    for (const ring of [...perRing.keys()].sort((a, b) => a - b)) {
      const around = ((perRing.get(ring) ?? 0) * 34) / (2 * Math.PI);
      inner = Math.max(inner + 90, around, 90 * ring);
      radius.set(ring, inner);
    }
    return [
      [
        "link",
        forceLink<GNode, GLink>(links)
          .id((n) => n.id)
          .distance(
            (l) =>
              Math.abs(
                (radius.get(l.source.ring) ?? 0) -
                  (radius.get(l.target.ring) ?? 0),
              ) || 40,
          )
          .strength((l) => (l.source.ring === l.target.ring ? 0.02 : 0.25)),
      ],
      [
        "ring",
        forceRadial<GNode>(
          (n) => (n.centre ? 0 : (radius.get(n.ring) ?? 90)),
          0,
          0,
        ).strength((n) => (n.centre ? 0 : 0.9)),
      ],
      ["charge", forceManyBody<GNode>().strength(-60).distanceMax(160)],
      [
        "collide",
        forceCollide<GNode>()
          .radius((n) => n.r + 9)
          .strength(0.9),
      ],
    ];
  }
  const count = Math.max(nodes.length, 1);
  return [
    [
      "link",
      forceLink<GNode, GLink>(links)
        .id((n) => n.id)
        .distance(
          (l) => 36 + 7 * (Math.sqrt(deg(l.source)) + Math.sqrt(deg(l.target))),
        )
        .strength((l) => 0.7 / Math.min(deg(l.source), deg(l.target)) || 0.4),
    ],
    [
      "charge",
      forceManyBody<GNode>()
        // Gentler in big vaults; capped in small ones, or a few notes
        // (one type shown) fly apart and the fitted view shrinks them.
        .strength(-Math.min(140, Math.max(70, 260 / Math.sqrt(count / 20))))
        .distanceMax(500),
    ],
    [
      "collide",
      forceCollide<GNode>()
        .radius((n) => n.r + 8)
        .strength(0.9),
    ],
    // A gentle pull to the middle; loose notes pulled less, so they ring
    // the network rather than land on it.
    // With few links left (a type hidden), loose notes are most of the map:
    // pulled in harder then, so they don't drift off.
    ...(["x", "y"] as const).map((axis): [string, Force<GNode, GLink>] => {
      const loose = links.length < nodes.length / 2 ? 0.04 : 0.015;
      const f = axis === "x" ? forceX<GNode>(0) : forceY<GNode>(0);
      return [axis, f.strength((n) => (deg(n) ? 0.05 : loose))];
    }),
  ];
}

const DRAG_THRESHOLD = 3;
/** A node's smallest size on screen, in pixels. */
const MIN_NODE_PX = 3.5;
/** Above this many notes, labels wait until you zoom in. */
const CROWDED = 20;

function palette() {
  const root = document.documentElement.classList;
  const dark = APP_THEMES.some((t) => t.dark && root.contains(t.id));
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
  layout = "force",
  onSaveImage,
  onNodeMenu,
}: {
  /** Told which note a right-click landed on (null: none), before the menu opens. */
  onNodeMenu?: (id: string | null) => void;
  /** Where "Save as image" puts the JPEG's bytes; no button without it. */
  onSaveImage?: (jpeg: Uint8Array) => Promise<void> | void;
  nodes: GraphNodeInput[];
  links: GraphLinkInput[];
  height: number;
  /**
   * "radial" for a note's neighbourhood: the note in the middle, each step
   * out on a ring around it. "force" for a whole network.
   */
  layout?: "radial" | "force";
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
  const onSaveImageRef = useRef(onSaveImage);
  onSaveImageRef.current = onSaveImage;
  const onNodeMenuRef = useRef(onNodeMenu);
  onNodeMenuRef.current = onNodeMenu;
  highlightRef.current = highlight ?? null;
  const [cursor, setCursor] = useState("grab");

  /**
   * Draws the map into a canvas: the one on screen, or (`still`) an image
   * of the whole map, every label that fits shown and nothing hovered.
   */
  const paint = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      dpr: number,
      t: ViewTransform,
      still?: { background: string },
    ) => {
      const colors = palette();
      const hover = still ? null : hoverRef.current;
      const lit = still
        ? null
        : hover
          ? new Set([hover, ...(neighboursRef.current.get(hover) ?? [])])
          : highlightRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (still) {
        ctx.fillStyle = still.background;
        ctx.fillRect(0, 0, w, h);
      }
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

      const baseLabel = still
        ? 1
        : labelAlpha(t.k, fitKRef.current, nodesRef.current.length > CROWDED);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const labels: {
        n: (typeof nodesRef.current)[number];
        alpha: number;
        on: boolean;
        rank: number;
      }[] = [];
      for (const n of nodesRef.current) {
        const on = lit ? lit.has(n.id) : true;
        const faint = n.ring >= 2 && !lit;
        ctx.globalAlpha = on ? (faint ? 0.6 : 1) : 0.15;
        ctx.fillStyle = n.color;
        ctx.beginPath();
        // Never smaller than a few pixels, however far out the view is.
        ctx.arc(n.x, n.y, Math.max(n.r, MIN_NODE_PX / t.k), 0, Math.PI * 2);
        ctx.fill();
        if (n.id === hover || n.centre) {
          ctx.strokeStyle = `rgba(${colors.text},0.7)`;
          ctx.lineWidth = 1.5 / t.k;
          ctx.stroke();
        }
        const alpha =
          n.id === hover || n.centre || lit?.has(n.id)
            ? 1
            : lit
              ? 0
              : baseLabel;
        if (alpha > 0.02) {
          const rank =
            n.id === hover
              ? 0
              : n.centre
                ? 1
                : lit?.has(n.id)
                  ? 2
                  : 3 - n.r / 100;
          labels.push({ n, alpha, on, rank });
        }
      }

      // Labels after every dot, most important first, and none on top of
      // another: a label that would overlap one already drawn waits until you
      // zoom in or hover. On screen, text grows a little as you zoom in but
      // never shrinks below readable; the canvas is in world units (/ t.k).
      labels.sort((a, b) => a.rank - b.rank);
      const screenPx = 9.5 * Math.min(Math.max(t.k, 0.9), 1.3);
      const lineH = (screenPx * 1.25) / t.k;
      const placed: [number, number, number, number][] = [];
      for (const { n, alpha, on, rank } of labels) {
        const weight = rank < 2 ? "600 " : "";
        ctx.font = `${weight}${screenPx / t.k}px ui-sans-serif, system-ui, sans-serif`;
        const label =
          n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        const w = ctx.measureText(label).width;
        const x1 = n.x - w / 2;
        const y1 = n.y + n.r + 2.5 / t.k;
        const box: [number, number, number, number] = [
          x1,
          y1,
          x1 + w,
          y1 + lineH,
        ];
        if (
          rank >= 2 &&
          placed.some(
            ([a1, b1, a2, b2]) =>
              box[0] < a2 && box[2] > a1 && box[1] < b2 && box[3] > b1,
          )
        ) {
          continue;
        }
        placed.push(box);
        ctx.globalAlpha = alpha * (on ? 1 : 0.3);
        ctx.fillStyle = `rgb(${colors.text})`;
        ctx.fillText(label, n.x, y1);
      }
      ctx.globalAlpha = 1;
    },
    [],
  );

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    paint(ctx, w, h, window.devicePixelRatio || 1, viewRef.current);
  }, [paint]);

  /** The whole map as a JPEG, framed and at print size, on the page's colour. */
  const saveImage = useCallback(async () => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;
    // Framed to the map's own shape, 2400 px on its long side.
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const spanX = Math.max(...xs) - Math.min(...xs) + 160;
    const spanY = Math.max(...ys) - Math.min(...ys) + 160;
    const long = 1200;
    const w = spanX >= spanY ? long : Math.max(600, (long * spanX) / spanY);
    const h = spanX >= spanY ? Math.max(600, (long * spanY) / spanX) : long;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * 2);
    canvas.height = Math.round(h * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const background =
      getComputedStyle(wrapRef.current ?? document.body).backgroundColor ||
      "#ffffff";
    paint(ctx, w, h, 2, fitTransform(nodes, w, h, 60), {
      background:
        background === "rgba(0, 0, 0, 0)"
          ? getComputedStyle(document.body).backgroundColor
          : background,
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (blob)
      await onSaveImageRef.current?.(new Uint8Array(await blob.arrayBuffer()));
  }, [paint]);

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
    const shape = `${layout}\u0003${nodeInput.map((n) => n.id).join("\u0000")}\u0001${linkInput
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
    // Many notes gone at once (a type hidden): settle afresh, or the rest
    // keep the spread the whole vault needed.
    const before = new Set(nodesRef.current.map((o) => o.id));
    const kept = nodeInput.filter((n) => before.has(n.id)).length;
    const shrank =
      nodesRef.current.length > 0 && kept < nodesRef.current.length * 0.7;
    const known = shapeRef.current !== "" && !shrank;
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
    const forces = graphLayout(layout, nodes, links, degree);
    const sim = forceSimulation<GNode, GLink>(nodes)
      // Nodes already placed only need to make room for the new ones.
      .alpha(known ? 0.35 : 1);
    for (const [name, force] of forces) sim.force(name, force);
    sim.on("tick", () => {
      ticks++;
      // Frame the graph once it has spread out, then leave the view alone.
      if (!fittedRef.current && (ticks > 60 || sim.alpha() < 0.2)) {
        fittedRef.current = true;
        fit();
      }
      redraw();
    });
    simRef.current = sim;
  }, [nodeInput, linkInput, layout, fit, redraw]);

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
      // Ctrl-click is a right-click on a Mac: it opens the menu instead.
      if (e.button !== 0 || e.ctrlKey) return;
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
    const menu = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = nodeAt(nodesRef.current, viewRef.current, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      onNodeMenuRef.current?.(node?.id ?? null);
    };
    canvas.addEventListener("contextmenu", menu);
    return () => {
      canvas.removeEventListener("contextmenu", menu);
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
      {onSaveImage && (
        <button
          type="button"
          onClick={() => void saveImage()}
          className="absolute right-9 bottom-1.5 flex size-6 items-center justify-center rounded bg-background/80 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          title="Save as image"
          aria-label="Save map as image"
        >
          <ImageDownIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
