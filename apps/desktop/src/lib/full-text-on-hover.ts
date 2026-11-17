/**
 * Text cut short with "…" (a long project or file name, say) shows in full
 * when the pointer rests on it, everywhere in the app: the element gets the
 * whole text as its tooltip while it's cut short, and loses it when it isn't.
 */
const MARK = "fullTextTitle";

function clipped(el: HTMLElement) {
  return el.scrollWidth > el.clientWidth + 1;
}

/** The nearest element (up to three levels) whose text overflows. */
function cutShort(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : null;
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") {
      return el;
    }
  }
  return null;
}

export function installFullTextOnHover(): void {
  document.addEventListener(
    "mouseover",
    (e) => {
      const el = cutShort(e.target);
      if (!el) return;
      const ours = el.dataset[MARK] === "1";
      // A title someone set on purpose stays.
      if (el.title && !ours) return;
      const text = el.textContent?.trim() ?? "";
      if (text && (clipped(el) || el.scrollHeight > el.clientHeight + 1)) {
        el.title = text;
        el.dataset[MARK] = "1";
      } else if (ours) {
        el.removeAttribute("title");
        delete el.dataset[MARK];
      }
    },
    { passive: true },
  );
}
