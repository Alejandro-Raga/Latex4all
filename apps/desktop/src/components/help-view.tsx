import { useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRightIcon, SearchIcon } from "lucide-react";
import { create } from "zustand";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import helpText from "@/content/help.md?raw";
import { cn } from "@/lib/utils";
import { useDockStore } from "@/stores/dock-store";
import {
  type SettingsSection,
  useSettingsWindow,
} from "@/stores/settings-window-store";

export interface HelpSection {
  id: string;
  title: string;
  body: string;
}

/** The manual (content/help.md), one section per "## " heading. */
export function helpSections(text: string = helpText): HelpSection[] {
  return text
    .split(/^## /m)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const newline = part.indexOf("\n");
      const title = (newline < 0 ? part : part.slice(0, newline)).trim();
      return {
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title,
        body: newline < 0 ? "" : part.slice(newline + 1).trim(),
      };
    });
}

/** Sections with every word of the search, in the title or the text. */
export function searchHelp(sections: HelpSection[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  return sections.filter((s) => {
    const text = `${s.title}\n${s.body}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Where an "app:" link in the manual goes. */
export type HelpTarget =
  | { kind: "projects" }
  | { kind: "library" }
  | { kind: "settings"; section: SettingsSection };

export function targetOf(href: string): HelpTarget | null {
  const [, place, section] = href.match(/^app:([a-z]+)(?:\/([a-z-]+))?$/) ?? [];
  if (place === "projects") return { kind: "projects" };
  if (place === "library") return { kind: "library" };
  if (place === "settings" && section) {
    return { kind: "settings", section: section as SettingsSection };
  }
  return null;
}

/** The manual: its sections down the side, the text, and a search. */
export function HelpView({
  onNavigate,
  canNavigate = () => true,
  className,
}: {
  /** Follows an "app:" link. */
  onNavigate: (target: HelpTarget) => void;
  /** Whether a link has somewhere to go here; one that hasn't isn't shown. */
  canNavigate?: (target: HelpTarget) => boolean;
  className?: string;
}) {
  const sections = useMemo(() => helpSections(), []);
  const [query, setQuery] = useState("");
  const shown = searchHelp(sections, query);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <nav className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-border border-r p-3 sm:flex">
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help"
            aria-label="Search help"
            className="h-8 pl-7 text-sm"
          />
        </div>
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() =>
              scrollRef.current
                ?.querySelector(`#help-${s.id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="rounded-md px-2 py-1 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
          >
            {s.title}
          </button>
        ))}
      </nav>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {shown.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing in the help mentions that.
            </p>
          )}
          {shown.map((s) => (
            <section key={s.id} id={`help-${s.id}`} className="mb-10">
              <h2 className="mb-3 font-semibold text-lg">{s.title}</h2>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) =>
                  url.startsWith("app:") ? url : defaultUrlTransform(url)
                }
                components={{
                  p: ({ children }) => (
                    <p className="mb-3 text-sm leading-relaxed">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                      {children}
                    </ul>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                      {children}
                    </code>
                  ),
                  table: ({ children }) => (
                    <table className="mb-3 w-full text-sm">{children}</table>
                  ),
                  th: ({ children }) => (
                    <th className="border-border border-b py-1.5 pr-4 text-left font-medium text-muted-foreground">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border-border/60 border-b py-1.5 pr-4 align-top">
                      {children}
                    </td>
                  ),
                  a: ({ href, children }) => {
                    const target = href ? targetOf(href) : null;
                    if (target && !canNavigate(target)) return null;
                    if (target) {
                      return (
                        <button
                          type="button"
                          onClick={() => onNavigate(target)}
                          className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
                        >
                          {children}
                          <ArrowRightIcon className="size-3.5" />
                        </button>
                      );
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {s.body}
              </ReactMarkdown>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The help over a project, from ⌘K or the sidebar. */
export const useHelp = create<{
  open: boolean;
  show: () => void;
  close: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function HelpDialog() {
  const open = useHelp((s) => s.open);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && useHelp.getState().close()}>
      <DialogContent className="flex h-[85vh] max-w-[min(92vw,960px)] flex-col gap-0 p-0 sm:max-w-[min(92vw,960px)]">
        <DialogTitle className="border-border border-b px-5 py-3 font-semibold text-base">
          Help
        </DialogTitle>
        <HelpView
          canNavigate={(target) => target.kind !== "projects"}
          onNavigate={(target) => {
            useHelp.getState().close();
            if (target.kind === "settings") {
              useSettingsWindow.getState().show(target.section);
            } else {
              useDockStore.getState().setOpen("reference", true);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
