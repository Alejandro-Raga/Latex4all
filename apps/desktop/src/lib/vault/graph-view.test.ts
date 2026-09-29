import { describe, expect, it } from "vitest";
import {
  fitTransform,
  labelAlpha,
  nodeAt,
  toWorld,
  zoomAt,
} from "./graph-view";

describe("graph view maths", () => {
  it("zooms around the pointer, keeping what's under it still", () => {
    const t = { k: 1, x: 10, y: 20 };
    const p = { x: 110, y: 70 };
    const before = toWorld(t, p);
    const z = zoomAt(t, p, 2);
    expect(z.k).toBe(2);
    expect(toWorld(z, p)).toEqual(before);
  });

  it("caps the zoom", () => {
    expect(zoomAt({ k: 5, x: 0, y: 0 }, { x: 0, y: 0 }, 10).k).toBe(6);
    expect(zoomAt({ k: 0.2, x: 0, y: 0 }, { x: 0, y: 0 }, 0.01).k).toBe(0.15);
  });

  it("fits every node in view", () => {
    const pts = [
      { x: -100, y: -50 },
      { x: 100, y: 50 },
    ];
    const t = fitTransform(pts, 440, 240, 20);
    for (const p of pts) {
      const sx = p.x * t.k + t.x;
      const sy = p.y * t.k + t.y;
      expect(sx).toBeGreaterThanOrEqual(19.9);
      expect(sx).toBeLessThanOrEqual(420.1);
      expect(sy).toBeGreaterThanOrEqual(19.9);
      expect(sy).toBeLessThanOrEqual(220.1);
    }
  });

  it("finds the node under the pointer, nearest first", () => {
    const nodes = [
      { id: "a", x: 0, y: 0, r: 5 },
      { id: "b", x: 8, y: 0, r: 5 },
    ];
    const t = { k: 2, x: 100, y: 100 };
    expect(nodeAt(nodes, t, { x: 100, y: 100 })?.id).toBe("a");
    expect(nodeAt(nodes, t, { x: 117, y: 100 })?.id).toBe("b");
    expect(nodeAt(nodes, t, { x: 300, y: 300 })).toBeNull();
  });

  it("fades labels in as you zoom", () => {
    expect(labelAlpha(0.5)).toBe(0);
    expect(labelAlpha(1.2)).toBe(1);
    expect(labelAlpha(0.95)).toBeCloseTo(0.5);
  });

  it("keeps a crowded graph's labels hidden until zoomed well in", () => {
    expect(labelAlpha(1.3, 1.3, true)).toBe(0);
    expect(labelAlpha(1.3 * 1.8, 1.3, true)).toBeCloseTo(0.5);
    expect(labelAlpha(1.3 * 2.2, 1.3, true)).toBe(1);
  });
});
