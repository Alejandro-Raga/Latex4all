import { type ReactNode, useState } from "react";
import {
  FileTextIcon,
  LightbulbIcon,
  Link2Icon,
  MessageSquareTextIcon,
  TagIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openZoteroPdf, zoteroPdfTarget } from "@/components/zotero-pdf-dialog";
import { addPassage, type PassageGroup } from "@/lib/vault/add-passage";
import { COLOR_HREF, FADED_HREF, noteFromHref } from "@/lib/vault/render";
import {
  findNote,
  type VaultIndex,
  type VaultNote,
} from "@/lib/vault/vault-index";
import { useDockStore } from "@/stores/dock-store";
import { useVaultStore } from "@/stores/vault-store";
import { filedToast, GroupPicker } from "./preview/group-picker";

const PDF_LINK =
  /open-pdf\/library\/items\/([A-Z0-9]{8})\?(?:page=(\d+)&)?annotation=([A-Z0-9]{8})/;
const ANNOTATION = /annotation=([A-Z0-9]{8})/g;

/** Zotero's highlight colours, by the names the sync writes (`#hl/yellow`). */
export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#ffd400",
  red: "#ff6666",
  green: "#5fb236",
  blue: "#2ea8e5",
  purple: "#a28ae5",
  magenta: "#e56eee",
  orange: "#f19837",
  gray: "#aaaaaa",
};

/** Every note quoting each highlight, by the highlight's Zotero key. */
export function notesByHighlight(
  index: VaultIndex | null,
): Map<string, VaultNote[]> {
  const out = new Map<string, VaultNote[]>();
  for (const n of index?.list ?? []) {
    for (const m of new Set(
      [...n.body.matchAll(ANNOTATION)].map((x) => x[1]),
    )) {
      out.set(m, [...(out.get(m) ?? []), n]);
    }
  }
  return out;
}

/** Opens a vault note in the vault panel, showing the panel. */
export function openInVault(name: string) {
  useDockStore.getState().setOpen("vault", true);
  useVaultStore.getState().open(name);
}

/** The notes something is in, one click each. */
export function AlsoIn({
  notes,
  onOpen,
  className,
}: {
  notes: VaultNote[];
  onOpen: (name: string) => void;
  className?: string;
}) {
  if (notes.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-1 text-xs ${className ?? ""}`}
    >
      <Link2Icon className="size-3 shrink-0 text-muted-foreground" />
      {notes.map((n) => (
        <button
          key={n.path}
          type="button"
          onClick={() => onOpen(n.name)}
          title={`Open ${n.name}`}
          className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        >
          {n.kind === "idea" ? "💡 " : ""}
          {n.name}
        </button>
      ))}
    </div>
  );
}

/** A node of the rendered Markdown (hast), as far as it's read here. */
export interface QuoteNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: QuoteNode[];
}

interface Found {
  links: { href: string; text: string }[];
  text: string;
}

/** The links in a quote, and its words outside them. */
function read(node: QuoteNode, found: Found = { links: [], text: "" }) {
  if (node.type === "text") found.text += node.value ?? "";
  else if (node.type === "element") {
    if (node.tagName === "a") {
      const text = textOf(node);
      found.links.push({ href: String(node.properties?.href ?? ""), text });
    } else if (!node.properties?.dataComment) {
      for (const c of node.children ?? []) read(c, found);
      if (node.tagName === "p") found.text += "\n";
    }
  }
  return found;
}
const textOf = (node: QuoteNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");

const hasLink = (node: QuoteNode, test: (href: string) => boolean): boolean =>
  (node.tagName === "a" && test(String(node.properties?.href ?? ""))) ||
  (node.children ?? []).some((c) => hasLink(c, test));

/** What a quote is, when it's a Zotero highlight. */
export function highlightOf(node: QuoteNode | undefined) {
  if (!node) return null;
  const { links, text } = read(node);
  for (const l of links) {
    const m = PDF_LINK.exec(l.href);
    if (!m) continue;
    const page = links.map((x) => /p\. (\S+)/.exec(x.text)?.[1]).find(Boolean);
    const color = links
      .find((x) => x.href.startsWith(COLOR_HREF))
      ?.href.slice(COLOR_HREF.length);
    return {
      href: l.href,
      attachmentKey: m[1],
      pageIndex: m[2] ? Number(m[2]) - 1 : undefined,
      annotationKey: m[3],
      pageLabel: page,
      color: color ? HIGHLIGHT_COLORS[color] : undefined,
      // The paper it's from, when the quote names it ([[Paper#^…]]).
      paperName:
        links.map((x) => noteFromHref(x.href)).find((n) => n !== null) ?? null,
      text: text.replace(/\s*—[\s·]*$/, "").trim(),
    };
  }
  return null;
}

/**
 * A rehype step: the comment the sync writes under a highlight (faded, in
 * its own paragraph) and the idea made from it (💡) go inside the
 * highlight's quote, so both show as one card, the comment marked as such.
 */
export function attachComments() {
  const walk = (node: QuoteNode) => {
    const kids = node.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.type !== "element") continue;
      if (k.tagName !== "blockquote" || !highlightOf(k)) {
        walk(k);
        continue;
      }
      for (;;) {
        let j = i + 1;
        while (
          j < kids.length &&
          kids[j].type === "text" &&
          !(kids[j].value ?? "").trim()
        )
          j++;
        const next = kids[j];
        if (next?.type !== "element" || next.tagName !== "p") break;
        const comment = hasLink(next, (h) => h === FADED_HREF);
        const idea = textOf(next).trimStart().startsWith("💡");
        if (!comment && !idea) break;
        next.properties = {
          ...next.properties,
          dataComment: comment ? "comment" : "idea",
        };
        k.children = [...(k.children ?? []), next];
        kids.splice(i + 1, j - i);
      }
    }
  };
  return (tree: QuoteNode) => walk(tree);
}

/** A comment or idea placed in a highlight's card by attachComments. */
export function HighlightComment({
  kind,
  children,
}: {
  kind: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        kind === "comment"
          ? "-mx-3 mt-2 -mb-2 flex gap-2 border-border/60 border-t bg-muted/50 px-3 py-2 text-[13px] text-foreground/85 leading-snug [&_em]:not-italic [&_em]:opacity-100"
          : "-mx-3 mt-2 -mb-2 border-border/60 border-t px-3 py-1.5 text-xs"
      }
    >
      {kind === "comment" && (
        <MessageSquareTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A highlight quoted in a note, as a card: the passage, its page, and the
 * comment under it. Right-click to file it under an idea or a topic, or
 * open it in the PDF; the other notes quoting it are listed under it. Any
 * other quote is shown as it is.
 */
export function HighlightQuote({
  node,
  children,
  index,
  current,
  quotedIn,
  title,
  onOpen,
}: {
  node: QuoteNode | undefined;
  children: ReactNode;
  index: VaultIndex | null;
  /** The note shown. */
  current: VaultNote | null;
  quotedIn: Map<string, VaultNote[]>;
  title: string;
  onOpen: (name: string) => void;
}) {
  const [picking, setPicking] = useState<{
    group: PassageGroup;
    at: { left: number; top: number };
  } | null>(null);
  const [at, setAt] = useState({ left: 0, top: 0 });
  const h = highlightOf(node);
  if (!h) return <blockquote>{children}</blockquote>;

  const paper =
    (h.paperName && index ? findNote(index, h.paperName) : undefined) ??
    (current?.kind === "paper" ? current : undefined);
  const others = (quotedIn.get(h.annotationKey) ?? []).filter(
    (n) => n.path !== current?.path,
  );

  const file = async (group: PassageGroup, name: string) => {
    if (!paper?.zoteroKey) {
      toast.error("This highlight's paper isn't in the vault.");
      return;
    }
    try {
      const note = await addPassage(group, name, {
        itemKey: paper.zoteroKey,
        attachmentKey: h.attachmentKey,
        annotationKey: h.annotationKey,
        text: h.text,
        pageLabel: h.pageLabel,
        pageIndex: h.pageIndex,
      });
      filedToast(group, note);
    } catch (err) {
      toast.error(
        `Couldn't add it to the ${group}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <figure
            onContextMenu={(e) => setAt({ left: e.clientX, top: e.clientY })}
            className="my-3 overflow-hidden rounded-md border border-border/70 bg-background"
          >
            <div
              className="border-l-[3px] px-3 py-2 text-[13.5px] text-foreground leading-relaxed [&>p]:my-0"
              style={{ borderLeftColor: h.color ?? HIGHLIGHT_COLORS.yellow }}
            >
              {children}
            </div>
            {others.length > 0 && (
              <AlsoIn
                notes={others}
                onOpen={onOpen}
                className="border-border/60 border-t px-3 py-1.5"
              />
            )}
          </figure>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={() => setPicking({ group: "idea", at })}>
            <LightbulbIcon className="size-4" />
            Add to idea…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setPicking({ group: "topic", at })}>
            <TagIcon className="size-4" />
            Add to topic…
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const pdf = zoteroPdfTarget(h.href, paper?.title ?? title);
              if (pdf) void openZoteroPdf(pdf);
            }}
          >
            <FileTextIcon className="size-4" />
            Open in the PDF
          </ContextMenuItem>
          {others.length > 0 && (
            <>
              <ContextMenuSeparator />
              <div className="px-2 py-1 text-muted-foreground text-xs">
                Also in
              </div>
              {others.map((n) => (
                <ContextMenuItem key={n.path} onSelect={() => onOpen(n.name)}>
                  <Link2Icon className="size-4" />
                  <span className="truncate">{n.name}</span>
                </ContextMenuItem>
              ))}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {picking && (
        <GroupPicker
          group={picking.group}
          anchor={picking.at}
          onCancel={() => setPicking(null)}
          onPick={async (name) => {
            await file(picking.group, name);
            setPicking(null);
          }}
        />
      )}
    </>
  );
}
