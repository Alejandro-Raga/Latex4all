import { type ReactNode, useState } from "react";
import { FileTextIcon, LightbulbIcon, Link2Icon, TagIcon } from "lucide-react";
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
import { noteFromHref } from "@/lib/vault/render";
import {
  findNote,
  type VaultIndex,
  type VaultNote,
} from "@/lib/vault/vault-index";
import { filedToast, GroupPicker } from "./preview/group-picker";

const PDF_LINK =
  /open-pdf\/library\/items\/([A-Z0-9]{8})\?(?:page=(\d+)&)?annotation=([A-Z0-9]{8})/;
const ANNOTATION = /annotation=([A-Z0-9]{8})/g;

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
    } else {
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

/** What a quote is, when it's a Zotero highlight. */
export function highlightOf(node: QuoteNode | undefined) {
  if (!node) return null;
  const { links, text } = read(node);
  for (const l of links) {
    const m = PDF_LINK.exec(l.href);
    if (!m) continue;
    const page = links.map((x) => /p\. (\S+)/.exec(x.text)?.[1]).find(Boolean);
    return {
      href: l.href,
      attachmentKey: m[1],
      pageIndex: m[2] ? Number(m[2]) - 1 : undefined,
      annotationKey: m[3],
      pageLabel: page,
      // The paper it's from, when the quote names it ([[Paper#^…]]).
      paperName:
        links.map((x) => noteFromHref(x.href)).find((n) => n !== null) ?? null,
      text: text.replace(/\s*—[\s·]*$/, "").trim(),
    };
  }
  return null;
}

/**
 * A highlight quoted in a note: right-click to file it under an idea or a
 * topic, or open it in the PDF; the other notes quoting it are listed under
 * it. Any other quote is shown as it is.
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
          <blockquote
            onContextMenu={(e) => setAt({ left: e.clientX, top: e.clientY })}
          >
            {children}
          </blockquote>
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
      {others.length > 0 && (
        <div className="-mt-1 mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-3 text-muted-foreground text-xs">
          <Link2Icon className="size-3 shrink-0" />
          {others.map((n) => (
            <button
              key={n.path}
              type="button"
              onClick={() => onOpen(n.name)}
              className="hover:text-foreground hover:underline"
            >
              {n.name}
            </button>
          ))}
        </div>
      )}
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
