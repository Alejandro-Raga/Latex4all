import { useLayoutEffect, useRef, useState } from "react";

const VIEWPORT_MARGIN = 8;

/**
 * Positions a portaled floating element (popover, toolbar, ...) near a
 * viewport-relative anchor point, clamped to the actual window bounds —
 * not just whatever ancestor it happens to render inside. Re-measures via
 * ResizeObserver so the position stays correct as content grows (e.g. a
 * loading state resolving into a taller result).
 *
 * Render the returned `ref` on a `position: fixed` element inside a portal
 * to `document.body`; use `coords` for `top`/`left` once available, and
 * `anchor` as the pre-measurement fallback (kept `visibility: hidden` until
 * `coords` is set, to avoid a flash at the unclamped position).
 */
export function useViewportAnchoredPosition(anchor: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reposition = () => {
      const rect = el.getBoundingClientRect();

      let left = Math.min(
        anchor.x,
        window.innerWidth - rect.width - VIEWPORT_MARGIN,
      );
      left = Math.max(VIEWPORT_MARGIN, left);

      let top = anchor.y + VIEWPORT_MARGIN;
      if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
        const above = anchor.y - rect.height - VIEWPORT_MARGIN;
        top =
          above >= VIEWPORT_MARGIN
            ? above
            : Math.max(
                VIEWPORT_MARGIN,
                window.innerHeight - rect.height - VIEWPORT_MARGIN,
              );
      }

      setCoords({ top, left });
    };

    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor.x, anchor.y]);

  return { ref, coords };
}
