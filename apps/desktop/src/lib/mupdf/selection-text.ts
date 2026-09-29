/** Where `offset` inside `node` falls in the text of `el`, which contains it. */
function offsetIn(el: Element, node: Node, offset: number): number {
  if (node.nodeType === Node.TEXT_NODE) {
    let before = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t && t !== node; t = walker.nextNode()) {
      before += t.textContent?.length ?? 0;
    }
    return before + offset;
  }
  // An element boundary: count the text of the children before it.
  let before = 0;
  node.childNodes.forEach((child, i) => {
    if (i < offset) before += child.textContent?.length ?? 0;
  });
  return before;
}

/**
 * The text selected in a PDF's text layers, readable when pasted: lines of
 * one paragraph joined with spaces (rejoining words hyphenated across a line
 * end), paragraphs on lines of their own. The browser's own copy runs the
 * lines together, since each is a separate SVG <text>.
 */
export function pdfSelectionText(container: Element): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return "";
  }
  const range = selection.getRangeAt(0);
  const pieces: { text: string; block: string }[] = [];
  for (const el of container.querySelectorAll(".mupdf-text-layer text")) {
    if (!range.intersectsNode(el)) continue;
    const full = el.textContent ?? "";
    const start = el.contains(range.startContainer)
      ? offsetIn(el, range.startContainer, range.startOffset)
      : 0;
    const end = el.contains(range.endContainer)
      ? offsetIn(el, range.endContainer, range.endOffset)
      : full.length;
    const text = full.slice(start, end).trim();
    if (text) pieces.push({ text, block: el.getAttribute("data-block") ?? "" });
  }

  let out = "";
  pieces.forEach(({ text, block }, i) => {
    if (i === 0) {
      out = text;
    } else if (block !== pieces[i - 1].block) {
      out += `\n${text}`;
    } else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(text)) {
      out = out.slice(0, -1) + text;
    } else {
      out += ` ${text}`;
    }
  });
  return out;
}
