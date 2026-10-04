/**
 * Strips that scroll sideways (the editor's ribbon, chat and PDF tabs) with
 * a plain mouse wheel too, not only a trackpad's sideways swipe: mark one
 * with `data-scroll-sideways` and the wheel moves it left and right.
 */
export const SCROLL_SIDEWAYS_ATTR = "data-scroll-sideways";

let installed = false;

export function installWheelSideways(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) return;
      // A sideways swipe already scrolls it; only turn up/down into sideways.
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const strip = (event.target as Element | null)?.closest?.(
        `[${SCROLL_SIDEWAYS_ATTR}]`,
      ) as HTMLElement | null;
      if (!strip || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      // Lines (a mouse with notches) are worth more than pixels.
      const step = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY;
      strip.scrollLeft += step;
    },
    { passive: false },
  );
}
