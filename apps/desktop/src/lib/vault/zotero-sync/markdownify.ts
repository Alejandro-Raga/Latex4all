/**
 * HTML to Markdown as Python's markdownify (1.2, heading_style="ATX",
 * bullets="-") writes it, for the Zotero notes the sync copies into paper
 * notes: the same text, so a note written here and one written by the Python
 * sync are the same file. The tags Zotero's note editor makes are covered.
 */

const BLOCK_INSIDE = new Set([
  "p",
  "blockquote",
  "article",
  "div",
  "section",
  "ol",
  "ul",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
]);
const HEADING = /^h[1-6]$/;

const nameOf = (n: Node | null) =>
  n && n.nodeType === Node.ELEMENT_NODE
    ? (n as Element).tagName.toLowerCase()
    : null;

function removeInside(n: Node | null): boolean {
  const name = nameOf(n);
  return name !== null && (HEADING.test(name) || BLOCK_INSIDE.has(name));
}
function removeOutside(n: Node | null): boolean {
  return removeInside(n) || nameOf(n) === "pre";
}

function escapeMarkdown(text: string): string {
  return text.replace(/\*/g, "\\*").replace(/_/g, "\\_");
}

function chomp(text: string): [string, string, string] {
  const prefix = text.startsWith(" ") ? " " : "";
  const suffix = text.endsWith(" ") ? " " : "";
  return [prefix, suffix, text.trim()];
}

const stripWs = (t: string) => t.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

function processText(node: Node, tags: Set<string>): string {
  let text = node.textContent ?? "";
  if (!tags.has("_noformat")) text = escapeMarkdown(text);
  if (!tags.has("pre")) {
    text = text.replace(/[\t \r\n]*[\r\n][\t \r\n]*/g, "\n");
    text = text.replace(/[\t ]+/g, " ");
  }
  const parent = node.parentNode;
  if (
    removeOutside(node.previousSibling) ||
    (removeInside(parent) && !node.previousSibling)
  ) {
    text = text.replace(/^[ \t\r\n]+/, "");
  }
  if (
    removeOutside(node.nextSibling) ||
    (removeInside(parent) && !node.nextSibling)
  ) {
    text = text.replace(/\s+$/, "");
  }
  return text;
}

function canIgnore(n: Node, insideRemoves: boolean): boolean {
  if (n.nodeType === Node.ELEMENT_NODE) return false;
  if (n.nodeType !== Node.TEXT_NODE) return true;
  if ((n.textContent ?? "").trim() !== "") return false;
  if (insideRemoves && (!n.previousSibling || !n.nextSibling)) return true;
  return removeOutside(n.previousSibling) || removeOutside(n.nextSibling);
}

function processElement(n: Node, tags: Set<string>): string {
  return n.nodeType === Node.ELEMENT_NODE
    ? processTag(n as Element, tags)
    : n.nodeType === Node.TEXT_NODE
      ? processText(n, tags)
      : "";
}

function processTag(
  node: Element | DocumentFragment,
  tags: Set<string>,
): string {
  const name = node instanceof Element ? node.tagName.toLowerCase() : "";
  const insideRemoves = node instanceof Element && removeInside(node);
  const kids = [...node.childNodes].filter((c) => !canIgnore(c, insideRemoves));
  const childTags = new Set(tags);
  if (name) childTags.add(name);
  if (HEADING.test(name) || name === "td" || name === "th")
    childTags.add("_inline");
  if (["pre", "code", "kbd", "samp"].includes(name)) childTags.add("_noformat");
  let strings = kids.map((c) => processElement(c, childTags)).filter(Boolean);
  if (name !== "pre" && !tags.has("pre")) {
    const out = [""];
    for (const s of strings) {
      const m = /^(\n*)((?:[\s\S]*[^\n])?)(\n*)$/.exec(s) as RegExpExecArray;
      let [, lead, content, trail] = m;
      if (out[out.length - 1] && lead) {
        const prev = out.pop() as string;
        lead = "\n".repeat(Math.min(2, Math.max(prev.length, lead.length)));
      }
      out.push(lead, content, trail);
    }
    strings = out;
  }
  const text = strings.join("");
  return name ? convert(node as Element, name, text, tags) : text;
}

const inline = (markup: string) => (text: string, tags: Set<string>) => {
  if (tags.has("_noformat")) return text;
  const [prefix, suffix, t] = chomp(text);
  return t ? `${prefix}${markup}${t}${markup}${suffix}` : "";
};

function nextBlockSibling(el: Element): Element | null {
  let n = el.nextSibling;
  while (n) {
    if (n.nodeType === Node.ELEMENT_NODE) return n as Element;
    if ((n.textContent ?? "").trim()) return null;
    n = n.nextSibling;
  }
  return null;
}

function convert(
  el: Element,
  name: string,
  text: string,
  tags: Set<string>,
): string {
  if (HEADING.test(name)) {
    if (tags.has("_inline")) return text;
    const t = text.trim().replace(/[\t \r\n]+/g, " ");
    return `\n\n${"#".repeat(Number(name[1]))} ${t}\n\n`;
  }
  switch (name) {
    case "p":
    case "div":
    case "article":
    case "section": {
      if (tags.has("_inline")) return ` ${stripWs(text)} `;
      const t = stripWs(text);
      return t ? `\n\n${t}\n\n` : "";
    }
    case "b":
    case "strong":
      return inline("**")(text, tags);
    case "i":
    case "em":
      return inline("*")(text, tags);
    case "sub":
    case "sup":
      return inline("")(text, tags);
    case "code":
    case "kbd":
    case "samp":
      return inline("`")(text, tags);
    case "pre":
      return text
        ? `\n\n\`\`\`\n${text.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n\n`
        : "";
    case "hr":
      return "\n\n---\n\n";
    case "table":
      return `\n\n${text.trim()}\n\n`;
    case "caption":
      return `${text.trim()}\n\n`;
    case "td":
    case "th":
      return ` ${text.trim().replace(/\n/g, " ")}${" |".repeat(colspan(el))}`;
    case "tr":
      return tableRow(el, text);
    case "br":
      return tags.has("_inline") ? " " : "  \n";
    case "a": {
      const [prefix, suffix, t] = chomp(text);
      if (!t) return "";
      const href = el.getAttribute("href") ?? "";
      const title = el.getAttribute("title");
      return `${prefix}[${t}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})${suffix}`;
    }
    case "blockquote": {
      if (tags.has("_inline")) return ` ${text.trim()} `;
      const t = stripWs(text);
      if (!t) return "\n";
      return `\n${t.replace(/^(.*)/gm, (_, line: string) => (line ? `> ${line}` : ">"))}\n\n`;
    }
    case "ul":
    case "ol": {
      const next = nextBlockSibling(el);
      const beforeParagraph = Boolean(
        next && !["ul", "ol"].includes(nameOf(next) as string),
      );
      if (tags.has("li")) return `\n${text.replace(/\s+$/, "")}`;
      return `\n\n${text}${beforeParagraph ? "\n" : ""}`;
    }
    case "li": {
      const t = (text ?? "").trim();
      if (!t) return "\n";
      const parent = el.parentElement;
      let bullet: string;
      if (nameOf(parent) === "ol") {
        const start = Number(parent?.getAttribute("start"));
        let before = 0;
        for (
          let s = el.previousElementSibling;
          s;
          s = s.previousElementSibling
        ) {
          if (nameOf(s) === "li") before++;
        }
        bullet = `${(Number.isInteger(start) && start > 0 ? start : 1) + before}.`;
      } else {
        bullet = "-";
      }
      bullet += " ";
      const indent = " ".repeat(bullet.length);
      const indented = t.replace(/^(.*)/gm, (_, line: string) =>
        line ? indent + line : "",
      );
      return `${bullet}${indented.slice(bullet.length)}\n`;
    }
    default:
      return text;
  }
}

function colspan(el: Element): number {
  const span = el.getAttribute("colspan") ?? "";
  return /^[0-9]+$/.test(span) ? Math.max(1, Math.min(1000, Number(span))) : 1;
}

/** A table row, with the header rule markdownify draws under the first. */
function tableRow(el: Element, text: string): string {
  const cells = [...el.querySelectorAll("td, th")];
  const parent = el.parentElement as Element;
  const parentName = nameOf(parent);
  const firstRow = !el.previousElementSibling;
  const headRow =
    cells.every((c) => nameOf(c) === "th") ||
    (parentName === "thead" && parent.querySelectorAll("tr").length === 1);
  const headMissing =
    (firstRow && parentName !== "tbody") ||
    (firstRow &&
      parentName === "tbody" &&
      !parent.parentElement?.querySelector(":scope > thead"));
  const width = cells.reduce((n, c) => n + colspan(c), 0);
  const rule = `| ${Array(width).fill("---").join(" | ")} |\n`;
  let over = "";
  let under = "";
  if (headRow && firstRow) under = rule;
  else if (
    headMissing ||
    (firstRow &&
      (parentName === "table" ||
        (parentName === "tbody" && !parent.previousElementSibling)))
  )
    over = `| ${Array(width).fill("").join(" | ")} |\n${rule}`;
  return `${over}|${text}\n${under}`;
}

/** A Zotero note's HTML as Markdown, as the Python sync writes it. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(
    `<body>${html ?? ""}</body>`,
    "text/html",
  );
  const fragment = document.createDocumentFragment();
  for (const n of [...doc.body.childNodes]) fragment.appendChild(n);
  const md = processTag(fragment, new Set()).replace(/^\n+|\n+$/g, "");
  return md.replace(/\n{3,}/g, "\n\n").trim();
}
